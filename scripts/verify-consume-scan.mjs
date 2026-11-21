// 「扫码消耗」验收(/consume/[id])。
//
// 这是打印在物品标签上的二维码的主要用途:扫一下 → 页面打开 → 自动消耗 1 件。
// 此前只被顺带验过「深色模式 + 有返回入口」,真正的消耗行为没验过 ——
// 而它是**无需登录**的写操作,出错就是静默少一件。
//
// 覆盖:
//   · 打开页面消耗**正好 1 件**(不是 2 件 —— React 严格模式下 effect 会双跑,靠 requestId 兜住)
//   · 再次打开(相当于第二天再扫一次)再消耗 1 件 —— 这是设计语义,钉住它
//   · 接口层幂等:同一个 requestId 重复提交只减 1 次
//   · 液体物品走「余量」而不是数量
//   · 不存在的编号 → 404 页面
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-consume-scan.mjs

import { randomUUID } from "node:crypto";
import { launchChromium } from "./lib/browser.mjs";
import { loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

const finish = async (code) => {
  await context.close();
  await browser.close();
  process.exit(code);
};

const auth = await loginAndConfirm(page, BASE, USER, PASS);
check("已登录(否则测的是登录页)", auth.ok, auth.detail);
if (!auth.ok) await finish(1);

const api = async (method, endpoint, body) => {
  const response = await page.evaluate(async ({ method, endpoint, body }) => {
    const res = await fetch(endpoint, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: res.status, body: parsed };
  }, { method, endpoint, body });
  return response;
};

const makeItem = async (body) => (await api("POST", "/api/items", body)).body;
const readItem = async (id) => (await api("GET", `/api/items/${id}`)).body;
const dropItem = async (id) => {
  await api("DELETE", `/api/items/${id}`, {});
  await api("DELETE", `/api/items/${id}`, { permanent: true });
};

// ---------- ① 打开页面:消耗正好 1 件 ----------
{
  const item = await makeItem({ name: "扫码消耗验收品", category: "日用", type: "CONSUMABLE", unit: "包", quantity: 3 });
  check("创建探针物品(数量 3)", item?.quantity === 3, JSON.stringify(item).slice(0, 120));

  if (item?.id) {
    await page.goto(`${BASE}/consume/${item.itemCode || item.id}`);
    await page.waitForTimeout(2800);
    const text = await page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\n+/g, " | "));
    check("扫码页认出了物品", text.includes("扫码消耗") && text.includes("扫码消耗验收品"), text.slice(0, 160));
    check("页面给出了消耗结果提示", /已消耗 1/.test(text), text.slice(0, 160));

    const after = await readItem(item.id);
    check("打开一次只消耗 1 件(不是 2 件)", Number(after?.quantity) === 2, `实际=${after?.quantity}`);

    // ---------- ② 再打开一次(相当于第二天再扫一次)再消耗 1 件 ----------
    await page.goto(`${BASE}/consume/${item.itemCode || item.id}`);
    await page.waitForTimeout(2600);
    const second = await readItem(item.id);
    check("再次扫码再消耗 1 件(设计语义)", Number(second?.quantity) === 1, `实际=${second?.quantity}`);

    await dropItem(item.id);
  }
}

// ---------- ③ 接口层幂等:同一个 requestId 只减一次 ----------
{
  const item = await makeItem({ name: "幂等验收品", category: "日用", type: "CONSUMABLE", unit: "包", quantity: 2 });
  if (item?.id) {
    const requestId = randomUUID();
    const first = await api("POST", "/api/public/consume", { itemId: item.id, requestId });
    const second = await api("POST", "/api/public/consume", { itemId: item.id, requestId });
    const after = await readItem(item.id);

    check("首次提交成功", first.status === 200, `status=${first.status}`);
    check("重复提交同样返回成功(幂等)", second.status === 200, `status=${second.status}`);
    check("同一个 requestId 只减 1 次", Number(after?.quantity) === 1, `实际=${after?.quantity}`);

    await dropItem(item.id);
  }
}

// ---------- ④ 液体走余量 ----------
{
  const item = await makeItem({ name: "扫码液体验收品", category: "饮品", type: "CONSUMABLE", unit: "瓶", quantity: 2, remainingPercent: 100 });
  if (item?.id) {
    await page.goto(`${BASE}/consume/${item.itemCode || item.id}`);
    await page.waitForTimeout(2600);
    const after = await readItem(item.id);
    const pageText = await page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\n+/g, " | "));

    // 液体在这里**不该**被扣件数:余量要在应用的刻度里记录,扫码页只负责说明。
    // (我第一次把断言写成了「余量应当下降」—— 那是我猜的语义,不是产品的。)
    check("液体不按件数扣(数量不变)", Number(after?.quantity) === 2, `数量=${after?.quantity}`);
    check("液体不会被悄悄改余量", Number(after?.remainingPercent) === 100, `余量=${after?.remainingPercent}%`);
    check("页面明确告诉用户液体该怎么记", /余量刻度/.test(pageText), pageText.slice(0, 160));
    await dropItem(item.id);
  }
}

// ---------- ⑤ 不存在的编号 → 404 ----------
{
  const response = await page.goto(`${BASE}/consume/INV-20260101-ZZZZZZ`, { waitUntil: "domcontentloaded" }).catch(() => null);
  await page.waitForTimeout(1200);
  const text = await page.evaluate(() => (document.querySelector("main")?.innerText || document.body.innerText || "").replace(/\n+/g, " | "));
  check("不存在的编号给出 404 页面", response?.status() === 404 || /404|没有找到|不存在/.test(text), `status=${response?.status() ?? "?"} text=${text.slice(0, 100)}`);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
await finish(failed.length ? 1 : 0);