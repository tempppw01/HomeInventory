// 极端输入与安全测试:注入载荷是否被转义、超范围数值、日期边界、搜索特殊字符。
import { launchChromiumOrNull } from "./lib/browser.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const results = [];
const record = (area, name, ok, detail) => {
  results.push({ area, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${area}] ${name}${ok ? "" : "  → " + detail}`);
};

// 登录限速 12 次/分钟/IP:遇到 429 按 Retry-After 等待重试。
async function fetchWithRetry(url, init) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await globalThis.fetch(url, init);
    if (response.status !== 429) return response;
    const wait = Number(response.headers.get("retry-after") ?? 5);
    console.log("      限速中,等待 " + wait + " 秒后重试");
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
  }
  throw new Error("still rate limited");
}

const loginResponse = await fetchWithRetry(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: process.env.PROBE_USER || "bgs", password: process.env.PROBE_PASS }),
});
if (!loginResponse.ok) throw new Error("login failed " + loginResponse.status);
const cookie = loginResponse.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");

const call = async (method, path, body) => {
  const response = await fetchWithRetry(BASE + path, {
    method,
    headers: body !== undefined ? { cookie, "content-type": "application/json" } : { cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 100) }; }
  return { status: response.status, body: json, setCookie: response.headers.getSetCookie() };
};

const base = { category: "日用", type: "CONSUMABLE", quantity: 1, minQuantity: 0, remainingPercent: 100, unit: "件", price: null, purchaseDate: null, expiryDate: null, locationId: null, notes: null, imageUrl: null, recordPurchase: false, purchaseStore: null };
const created = [];

// ============ 1. 注入载荷 ============
const payloads = [
  ["script 标签", '<script>window.__xss = 1</script>'],
  ["img onerror", '"><img src=x onerror="window.__xss=2">'],
  ["SVG onload", '<svg onload="window.__xss=3">'],
  ["模板注入", "${7*7}{{7*7}}"],
  ["SQL 注入式", "' OR 1=1--"],
];
let firstInjectedId = null;
for (const [label, payload] of payloads) {
  const r = await call("POST", "/api/items", { ...base, name: `X-${label}`, notes: payload });
  if (r.body?.id) {
    created.push(r.body.id);
    if (!firstInjectedId) firstInjectedId = r.body.id;
  }
  record("注入", `创建含「${label}」备注的物品`, r.status === 201 || r.status === 200, `status=${r.status} ${JSON.stringify(r.body).slice(0, 90)}`);
}

// ============ 2. 超范围数值 ============
{
  const cases = {
    huge: { ...base, name: "X-超大数量", quantity: 999999999 },
    infinity: { ...base, name: "X-Infinity", quantity: 1e309 },
    decimalKg: { ...base, name: "X-kg小数", unit: "kg", quantity: 12345.6789 },
    tinyKg: { ...base, name: "X-kg极小", unit: "kg", quantity: 0.001 },
    negRemaining: { ...base, name: "X-负剩余", remainingPercent: -10 },
  };
  const out = {};
  for (const [key, body] of Object.entries(cases)) {
    const r = await call("POST", "/api/items", body);
    out[key] = { status: r.status, quantity: r.body?.quantity, remaining: r.body?.remainingPercent, id: r.body?.id };
    if (r.body?.id) created.push(r.body.id);
  }
  record("数值", "超大数量 999999999 不应 500", out.huge.status < 500, JSON.stringify(out.huge));
  record("数值", "quantity=1e309 不应入库为 Infinity", out.infinity.status >= 400 || Number.isFinite(out.infinity.quantity), JSON.stringify(out.infinity));
  record("数值", "kg 保留 4 位小数", out.decimalKg.status >= 400 || out.decimalKg.quantity === 12345.6789, JSON.stringify(out.decimalKg));
  record("数值", "kg 接受 0.001", out.tinyKg.status >= 400 || out.tinyKg.quantity === 0.001, JSON.stringify(out.tinyKg));
  record("数值", "remainingPercent 负数应被拒绝或夹到 0", out.negRemaining.status >= 400 || out.negRemaining.remaining >= 0, JSON.stringify(out.negRemaining));
}

// ============ 3. 日期边界 ============
{
  const iso = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
  const foodBase = { ...base, category: "食品", unit: "盒" };
  const cases = {
    yesterday: { ...foodBase, name: "X-昨到期", expiryDate: iso(-1), purchaseDate: iso(-10) },
    today: { ...foodBase, name: "X-今到期", expiryDate: iso(0), purchaseDate: iso(-10) },
    tomorrow: { ...foodBase, name: "X-明到期", expiryDate: iso(1), purchaseDate: iso(-10) },
    leap: { ...foodBase, name: "X-闰日", expiryDate: "2028-02-29", purchaseDate: "2026-01-01" },
    badLeap: { ...foodBase, name: "X-非闰日", expiryDate: "2027-02-29", purchaseDate: "2026-01-01" },
  };
  const out = {};
  for (const [key, body] of Object.entries(cases)) {
    const r = await call("POST", "/api/items", body);
    out[key] = { status: r.status, expiry: r.body?.expiryDate, id: r.body?.id };
    if (r.body?.id) created.push(r.body.id);
  }
  record("日期", "昨天到期可创建", out.yesterday.status < 400, JSON.stringify(out.yesterday));
  record("日期", "今天到期可创建", out.today.status < 400, JSON.stringify(out.today));
  record("日期", "明天到期可创建", out.tomorrow.status < 400, JSON.stringify(out.tomorrow));
  record("日期", "闰年 2/29 可创建", out.leap.status < 400, JSON.stringify(out.leap));
  record("日期", "非闰年 2/29 应被拒绝", out.badLeap.status >= 400, JSON.stringify(out.badLeap));
}

// ============ 4. 搜索特殊字符 ============
{
  const searches = { empty: "", spaces: "   ", regex: ".*", paren: "(", long: "测".repeat(300), mixed: "洗衣液 ABC 123" };
  const out = {};
  for (const [key, query] of Object.entries(searches)) {
    const r = await call("GET", `/api/items?q=${encodeURIComponent(query)}`);
    out[key] = { status: r.status, count: Array.isArray(r.body) ? r.body.length : (r.body?.items?.length ?? null) };
  }
  for (const key of Object.keys(searches)) {
    record("搜索", `特殊查询「${key}」不报错`, out[key].status === 200, JSON.stringify(out[key]));
  }
}

// ============ 5. 渲染层:注入是否被转义 ============
{
  // CI 上可能没装 Chromium:这种情况跳过渲染层检查,而不是把整套用例判失败。
  const browser = await launchChromiumOrNull();
  if (!browser) {
    console.log("      渲染层注入检查已跳过(当前环境没有可用的 Chromium)");
  } else {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(cookie.split("; ").map((pair) => {
    const index = pair.indexOf("=");
    return { name: pair.slice(0, index), value: pair.slice(index + 1), domain: "127.0.0.1", path: "/" };
  }));
  const page = await context.newPage();
  const dialogs = [];
  page.on("dialog", async (dialog) => { dialogs.push(dialog.message().slice(0, 40)); await dialog.dismiss(); });

  if (firstInjectedId) {
    await page.goto(`${BASE}/items/${firstInjectedId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const state = await page.evaluate(() => ({
      xss: window.__xss ?? null,
      imgX: document.querySelectorAll("img[src='x'], img[src='x/']").length,
      svgOnload: document.querySelectorAll("svg[onload]").length,
      text: document.body.innerText.slice(0, 6000),
    }));
    record("注入", "详情页未执行注入脚本", state.xss === null, `__xss=${state.xss}`);
    record("注入", "详情页 DOM 无注入标签", state.imgX === 0 && state.svgOnload === 0, JSON.stringify({ imgX: state.imgX, svgOnload: state.svgOnload }));
    record("注入", "注入载荷以纯文本呈现", state.text.includes("onerror=") || state.text.includes("<script>"), `text 命中=${state.text.includes("onerror=") || state.text.includes("<script>")}`);
  }

  // 列表页也不应执行
  await page.goto(`${BASE}/items`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  const listState = await page.evaluate(() => ({ xss: window.__xss ?? null, imgX: document.querySelectorAll("img[src='x'], img[src='x/']").length }));
  record("注入", "列表页未执行注入脚本", listState.xss === null && listState.imgX === 0, JSON.stringify(listState));
  record("注入", "全程未弹 alert/confirm", dialogs.length === 0, `dialogs=${dialogs.join("|")}`);

    await browser.close();
  }
}

// ---- 清理 ----
for (const id of created) await call("DELETE", `/api/items/${id}`);
console.log(`\n清理 ${created.length} 件测试物品`);
const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log("\n=== 失败项 ===");
  for (const row of failed) console.log(`[${row.area}] ${row.name} → ${row.detail}`);
}
process.exit(failed.length ? 1 : 0);