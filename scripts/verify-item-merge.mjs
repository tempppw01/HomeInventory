// 物品合并的端到端验收。
//
// 合并是**会改数据**的操作:合计数量、保留最早保质期、其余移入回收站(可恢复),
// 单位不一致时必须拒绝而不是硬加。逻辑层(planMerge)已有单测,
// 但「界面上真点一次会怎样」此前没有覆盖。
//
// 入口在概览页的「可能有重复录入」区,只在有疑似重复时才出现。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-item-merge.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const BASE_NAME = "合并验收洗衣液";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const auth = await loginAndConfirm(page, BASE, USER, PASS);
check("已登录(否则测的是登录页)", auth.ok, auth.detail);
if (!auth.ok) {
  await context.close();
  await browser.close();
  process.exit(1);
}

const createItem = (body) => page.evaluate(async (payload) => {
  const response = await fetch("/api/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  return { id: json.id, status: response.status, quantity: json.quantity, expiryDate: json.expiryDate };
}, body);

const getItem = (id) => page.evaluate(async (itemId) => {
  const response = await fetch(`/api/items/${itemId}`, { cache: "no-store" });
  return response.ok ? await response.json() : null;
}, id);

const activeIds = () => page.evaluate(async () => {
  const response = await fetch("/api/items", { cache: "no-store" });
  const body = await response.json();
  const rows = Array.isArray(body) ? body : (body.items ?? []);
  return rows.map((row) => row.id);
});

/** 在概览页找到包含指定文字的「重复录入」行并点它的「合并」按钮 */
const clickMergeFor = async (text) => {
  await page.goto(BASE);
  await page.waitForTimeout(2800);
  await dismissBlockingDialogs(page);

  // 概览里可能有多个重复组,必须点到**我们那一条**:
  // 先按行文本算出目标按钮的序号,再按序号点击。
  const targetIndex = await page.evaluate((needle) => {
    const section = Array.from(document.querySelectorAll("main section")).find((node) => (node.textContent || "").includes("可能有重复录入"));
    if (!section) return -1;
    const buttons = Array.from(section.querySelectorAll("button")).filter((button) => (button.textContent || "").trim() === "合并");
    return buttons.findIndex((button) => {
      const row = button.closest("li, div[class*='surface'], div");
      return (row?.textContent || "").includes(needle);
    });
  }, text);

  if (targetIndex < 0) return { found: false };

  // 这些按钮在首屏以下,Playwright 的可操作性等待会一直等到超时;
  // 直接在页面内触发点击(React 的 onClick 一样会执行),再等确认框出现。
  const clicked = await page.evaluate((index) => {
    const section = Array.from(document.querySelectorAll("main section")).find((node) => (node.textContent || "").includes("可能有重复录入"));
    if (!section) return false;
    const buttons = Array.from(section.querySelectorAll("button")).filter((button) => (button.textContent || "").trim() === "合并");
    if (buttons.length <= index) return false;
    buttons[index].click();
    return true;
  }, targetIndex);

  if (!clicked) return { found: false };
  await page.waitForTimeout(1000);
  return { found: true };
};

/** 确认框:标题「合并重复物品」 */
const confirmMerge = async () => {
  const dialog = page.locator('[role="dialog"]:has-text("合并重复物品")').first();
  if ((await dialog.count()) === 0) return { confirmed: false, text: "" };
  const text = (await dialog.innerText()).replace(/\n+/g, " | ").slice(0, 160);
  const button = dialog.locator('button:has-text("确定"), button:has-text("确认"), button:has-text("继续")').first();
  if ((await button.count()) === 0) return { confirmed: false, text };
  await button.click();
  await page.waitForTimeout(2600);
  return { confirmed: true, text };
};

// ============ 场景一:同名物品合并 ============
// 先清掉历史残留:同名老数据会被一起合并,导致数量对不上(踩过)。
await page.evaluate(async (prefix) => {
  const response = await fetch('/api/items?includeDeleted=1', { cache: 'no-store' });
  const body = await response.json();
  const rows = (Array.isArray(body) ? body : (body.items ?? [])).filter((row) => (row.name || '').includes(prefix));
  for (const row of rows) {
    await fetch(`/api/items/${row.id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ permanent: true }) });
  }
}, BASE_NAME);

const main = await createItem({ name: BASE_NAME, category: "日用", type: "CONSUMABLE", unit: "瓶", quantity: 5, expiryDate: "2027-06-30" });
const extra = await createItem({ name: `${BASE_NAME} 补充装`, category: "日用", type: "CONSUMABLE", unit: "瓶", quantity: 2, expiryDate: "2027-03-15" });
check("造出两条疑似重复的物品", Boolean(main.id && extra.id), `main=${main.status} extra=${extra.status}`);

if (main.id && extra.id) {
  const opened = await clickMergeFor(BASE_NAME);
  check("概览页出现「可能有重复录入」并可点合并", opened.found, "没有找到合并入口");

  if (opened.found) {
    const confirmed = await confirmMerge();
    check("合并前有二次确认,且说明合计与去向", confirmed.confirmed && /合计|回收站/.test(confirmed.text), confirmed.text);

    const kept = await getItem(main.id);
    const actives = await activeIds();
    // 单个物品接口会把已删除的过滤掉(404),所以「是否进了回收站」要看回收站列表。
    const recycled = await page.evaluate(async (needle) => {
      const response = await fetch("/api/items?includeDeleted=1", { cache: "no-store" });
      const body = await response.json();
      const rows = Array.isArray(body) ? body : (body.items ?? []);
      return rows.filter((row) => (row.name || "").includes(needle)).map((row) => ({ id: row.id, deletedAt: row.deletedAt }));
    }, BASE_NAME);
    const merged = recycled.find((row) => row.id === extra.id) ?? null;

    // 「保留数量最多的那条」:main(5) 应被保留,extra(2) 被软删除
    check("数量最多的一条被保留", kept && Number(kept.quantity) === 7, `数量=${kept?.quantity}(期望 5+2=7)`);
    // 按本地日历日比较:库里存的是本地零点,用 UTC 串会差一天(这个坑前面踩过)
    const localDay = (value) => {
      if (!value) return null;
      const date = new Date(value);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };
    check("保留最早的有效期", localDay(kept?.expiryDate) === "2027-03-15", `实际=${localDay(kept?.expiryDate)}`);
    check("另一条已从列表消失", !actives.includes(extra.id), "仍出现在列表里");
    check("另一条进入回收站(可恢复,不是硬删)", Boolean(merged?.deletedAt), `deletedAt=${merged?.deletedAt ?? "空"}`);

    const activity = await page.evaluate(async () => {
      const response = await fetch("/api/activity", { cache: "no-store" });
      const body = await response.json();
      return Array.isArray(body) ? body : (body.items ?? []);
    });
    check("变更记录里留有合并记录", activity.some((row) => row.action === "MERGE"), `最近动作=${activity.slice(0, 3).map((row) => row.action).join(",")}`);
  }
}

// ============ 场景二:单位不一致必须拒绝 ============
const unitA = await createItem({ name: `${BASE_NAME}单位`, category: "日用", type: "CONSUMABLE", unit: "瓶", quantity: 3 });
const unitB = await createItem({ name: `${BASE_NAME}单位 大桶`, category: "日用", type: "CONSUMABLE", unit: "kg", quantity: 4 });
if (unitA.id && unitB.id) {
  const response = await page.evaluate(async (payload) => {
    const res = await fetch("/api/items/merge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return { status: res.status, body: await res.text() };
  }, { keepId: unitA.id, mergeIds: [unitB.id] });
  check("单位不一致时合并被拒绝", response.status === 409 || response.status === 400, `status=${response.status}`);

  const stillThere = await getItem(unitB.id);
  check("被拒绝时两条都还在(没有半途改动)", Boolean(stillThere && !stillThere.deletedAt), `deletedAt=${stillThere?.deletedAt ?? "空"}`);
}

// ============ 清理 ============
for (const id of [main.id, extra.id, unitA.id, unitB.id].filter(Boolean)) {
  await page.evaluate(async (itemId) => {
    await fetch(`/api/items/${itemId}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    await fetch(`/api/items/${itemId}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ permanent: true }) });
  }, id);
}

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);