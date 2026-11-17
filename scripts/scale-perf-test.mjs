// 规模与性能测试:分批造 N 件物品,测列表/搜索/仪表盘耗时与劣化曲线。
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const EXECUTABLE = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`;
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`); };

async function fetchWithRetry(url, init) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await globalThis.fetch(url, init);
    if (response.status !== 429) return response;
    const wait = Number(response.headers.get("retry-after") ?? 5);
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
  }
  throw new Error("still rate limited");
}

const login = await fetchWithRetry(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.PROBE_USER || "bgs", password: process.env.PROBE_PASS }) });
if (!login.ok) throw new Error("login failed " + login.status);
const cookieHeader = login.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");

const api = async (method, path, body) => {
  const response = await fetchWithRetry(BASE + path, { method, headers: body !== undefined ? { cookie: cookieHeader, "content-type": "application/json" } : { cookie: cookieHeader }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, body: json };
};

const CATEGORIES = ["日用", "食品", "清洁", "家电", "数码", "衣物"];
const locations = [];
for (const name of ["S-客厅", "S-厨房", "S-卧室"]) {
  const r = await api("POST", "/api/locations", { name, icon: "Package", parentId: null });
  if (r.body?.id) locations.push(r.body.id);
}

const TARGET = Number(process.env.SCALE_TARGET || 500);
const batchSize = 25;
let created = 0;
const startedAt = Date.now();
for (let index = 0; index < TARGET; index += batchSize) {
  const batch = [];
  for (let k = 0; k < batchSize && index + k < TARGET; k += 1) {
    const n = index + k;
    batch.push(api("POST", "/api/items", {
      name: `S-物品${String(n).padStart(3, "0")}`,
      category: CATEGORIES[n % CATEGORIES.length],
      type: n % 3 === 0 ? "DURABLE" : "CONSUMABLE",
      quantity: (n % 7) + 1,
      minQuantity: n % 5 === 0 ? 2 : 0,
      remainingPercent: (n * 7) % 101,
      unit: n % 11 === 0 ? "kg" : "件",
      price: n % 4 === 0 ? 19.9 + n : null,
      purchaseDate: "2026-10-01",
      expiryDate: n % 6 === 0 ? "2026-12-01" : null,
      locationId: locations[n % locations.length] ?? null,
      notes: n % 9 === 0 ? "批量测试备注" : null,
      imageUrl: null,
      recordPurchase: false,
      purchaseStore: null,
    }));
  }
  const settled = await Promise.all(batch);
  created += settled.filter((r) => r.status === 201 || r.status === 200).length;
}
const seedMs = Date.now() - startedAt;
console.log(`      造数据:${created} 件,用时 ${seedMs}ms(平均 ${(seedMs / Math.max(created, 1)).toFixed(1)}ms/件)`);
record(`批量创建 ${TARGET} 件物品无 5xx`, created === TARGET, `成功=${created}/${TARGET} 用时=${seedMs}ms`);

// ---- API 响应时间 ----
const time = async (label, path) => {
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    const started = Date.now();
    const r = await api("GET", path);
    samples.push(Date.now() - started);
    if (index === 0 && r.status !== 200) return { label, status: r.status, samples };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { label, status: 200, median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1], samples };
};

const listTiming = await time("物品列表", "/api/items");
const dashTiming = await time("仪表盘", "/api/dashboard");
const searchTiming = await time("搜索(物品)", "/api/items?q=S-物品05");
const searchBroad = await time("搜索(宽匹配)", "/api/items?q=物品");
console.log("      API 中位耗时:", JSON.stringify({ list: listTiming.median, dash: dashTiming.median, search: searchTiming.median, broad: searchBroad.median }));

record(`物品列表 API 中位耗时 < 800ms(N=${TARGET})`, listTiming.median < 800, `median=${listTiming.median}ms max=${listTiming.max}ms`);
record(`仪表盘中位耗时 < 1000ms(N=${TARGET})`, dashTiming.median < 1000, `median=${dashTiming.median}ms max=${dashTiming.max}ms`);
record(`搜索中位耗时 < 800ms(N=${TARGET})`, searchTiming.median < 800, `median=${searchTiming.median}ms`);
record("宽匹配搜索不超时", searchBroad.status === 200, `status=${searchBroad.status} median=${searchBroad.median}ms`);

// ---- 前端渲染耗时 ----
{
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(cookieHeader.split("; ").map((pair) => { const index = pair.indexOf("="); return { name: pair.slice(0, index), value: pair.slice(index + 1), domain: "127.0.0.1", path: "/" }; }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 120)));

  const started = Date.now();
  await page.goto(`${BASE}/items`, { waitUntil: "domcontentloaded" });
  const domReady = Date.now() - started;
  await page.waitForSelector(".browse-rail-item", { timeout: 30000 });
  const railReady = Date.now() - started;
  await page.waitForTimeout(1500);
  const cards = await page.evaluate(() => document.querySelectorAll("main .group").length);
  const listScroll = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(`      物品页:DOMContentLoaded ${domReady}ms / 分类轨就绪 ${railReady}ms / 卡片 ${cards} / 页面高 ${listScroll}px`);
  record("物品页可交互 < 6s(500 件)", railReady < 6000, `${railReady}ms`);
  record("物品页无 JS 运行错误", errors.length === 0, errors.join(" | "));

  // 搜索交互延迟
  await page.locator("#global-search").click().catch(() => {});
  const searchStart = Date.now();
  await page.keyboard.type("S-物品123", { delay: 30 });
  await page.waitForTimeout(900);
  const searchElapsed = Date.now() - searchStart;
  const resultsShown = await page.evaluate(() => (document.body.innerText.match(/S-物品123/g) ?? []).length);
  console.log(`      搜索交互:${searchElapsed}ms,命中文本 ${resultsShown} 处`);
  record("搜索交互 1.5s 内有结果(含防抖)", searchElapsed < 2500 && resultsShown > 0, `${searchElapsed}ms 命中=${resultsShown}`);

  // 滚动流畅度
  const frameStats = await page.evaluate(async () => {
    const frames = [];
    let last = performance.now();
    return await new Promise((resolve) => {
      let count = 0;
      const step = () => {
        const now = performance.now();
        frames.push(now - last);
        last = now;
        window.scrollBy(0, 120);
        count += 1;
        if (count >= 40) {
          const sorted = frames.slice(1).sort((a, b) => a - b);
          resolve({ median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted[sorted.length - 1] });
        } else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  });
  console.log("      滚动帧间隔(ms):", JSON.stringify(frameStats));
  record("滚动中位帧间隔 < 25ms(≈40fps)", frameStats.median < 25, JSON.stringify(frameStats));

  await browser.close();
}

// ---- 清理 ----
const all = await api("GET", "/api/items?includeDeleted=1");
const rows = Array.isArray(all.body) ? all.body : (all.body?.items ?? []);
let removed = 0;
for (const row of rows.filter((entry) => String(entry.name).startsWith("S-"))) {
  const r = await api("DELETE", `/api/items/${row.id}`);
  if (r.status < 400) removed += 1;
}
for (const id of locations) await api("DELETE", `/api/locations/${id}`);
console.log(`\n清理:软删除 ${removed} 件物品、${locations.length} 个空间(硬清除见 purge-test-data.mjs)`);

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) { console.log("\n=== 失败项 ==="); for (const row of failed) console.log(`${row.name} → ${row.detail}`); }
process.exit(failed.length ? 1 : 0);