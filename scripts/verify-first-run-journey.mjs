// 空库上的「新用户从 0 到 1」旅程 —— 此前**没有任何检查跑在空库上**。
//
// 现有的几十个套件都跑在有数据的库上(CI 会先建好账号、部分套件还会造样例物品),
// 于是「刚装好归物的人看到什么、第一步能不能走通」从来没被验证过:
// 空状态文案还在不在、引导说的「完成第一步后小卡会自动收起」是不是真的、
// 录完第一件物品之后首屏会不会从「先录入第一件」切成正常的形态 ——
// 这些只会在**空库**上暴露。
//
// 这个套件要求 BASE_URL 指向一个空库实例(CI 里是 3002,用 DATABASE_URL=file:../data/empty.db)。
// 它自己会先把库清空到「只剩账号」的状态,所以本地对着空库实例重复跑也安全。
//
// 用法:BASE_URL=http://127.0.0.1:3002 PROBE_USER=leadcheck PROBE_PASS='Lead#2026' node scripts/verify-first-run-journey.mjs

import { launchChromium } from "./lib/browser.mjs";
import { loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3002";
const USER = process.env.PROBE_USER || "leadcheck";
const PASS = process.env.PROBE_PASS || "Lead#2026";
const SEEN_KEY = "home-inventory-welcome-seen";

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

const api = (method, path, body) => page.evaluate(async ({ method, path, body }) => {
  const response = await fetch(path, { method, headers: body === null ? undefined : { "Content-Type": "application/json" }, body: body === null ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json };
}, { method, path, body: body ?? null });

// ---------- 前置:把库清空到「只剩账号」 ----------
const beforeClean = await api("GET", "/api/items?includeDeleted=1", null);
for (const item of beforeClean.json ?? []) await api("DELETE", `/api/items/${item.id}`, { permanent: true });
// 采购项要从 dashboard 读:`/api/shopping` 只有 POST,GET 回 405 ——
// 此前这里就是 `GET /api/shopping`,`shopping.json` 恒为 null,循环一次都不进,
// 「从 0 开始」的前置其实一直留着库里的采购项没清(而下面那条前置断言也没看采购)。
const shoppingList = await api("GET", "/api/dashboard", null);
for (const entry of shoppingList.json?.shopping ?? []) await api("DELETE", `/api/shopping/${entry.id}`, null);
const dashboard0 = await api("GET", "/api/dashboard", null);
for (const location of dashboard0.json?.locations ?? []) await api("DELETE", `/api/locations/${location.id}`, null);

const emptied = await api("GET", "/api/dashboard", null);
check("前置:库已清空(否则这一套测的不是「从 0 开始」)", (emptied.json?.items ?? []).length === 0 && (emptied.json?.locations ?? []).length === 0 && (emptied.json?.shopping ?? []).length === 0, `物品=${(emptied.json?.items ?? []).length} 空间=${(emptied.json?.locations ?? []).length} 采购=${(emptied.json?.shopping ?? []).length}`);

/** 让「欢迎使用」引导重新出现 */
const openGuide = async () => {
  await page.evaluate((key) => localStorage.removeItem(key), SEEN_KEY);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  return page.evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-label="欢迎使用"]')));
};

// ---------- 1 空库首屏:空状态文案要说人话 ----------
await openGuide();
const emptyHead = await page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " ").trim());
check("空库首屏引导新人「先录入第一件物品」", /先录入家里的第一件物品|录入第一件/.test(emptyHead), emptyHead.slice(0, 120));
check("空库首屏的「最近更新」有专门的空状态文案(不是空白一片)", /还没有物品|录入第一件物品后/.test(emptyHead), emptyHead.slice(0, 160));

// ---------- 2 从引导进入录入,并真的存下第一件物品 ----------
const guideToForm = page.locator('[role="dialog"][aria-label="欢迎使用"] button').filter({ hasText: "录入一件物品" }).first();
check("引导里有「录入一件物品」入口", (await guideToForm.count()) > 0, "没找到入口");
await guideToForm.click({ timeout: 6000 }).catch(() => {});
await page.waitForTimeout(1300);

const dialog = page.locator('[role="dialog"][aria-label="录入新物品"]');
check("打开了录入弹窗", (await dialog.count()) > 0, "没有出现录入新物品弹窗");

// 空库里没有空间 —— 表单必须提供「就地新建」,否则第一件物品永远没有存放位置
const locationOptions = await dialog.evaluate((node) => {
  const select = node.querySelector('select[aria-label="存放位置"]');
  return select ? Array.from(select.options).map((option) => option.textContent.trim()) : null;
});
check("空库时「存放位置」提供就地新建(不用先离开弹窗去建空间)", Boolean(locationOptions) && locationOptions.some((text) => text.includes("新建")), JSON.stringify(locationOptions));

await dialog.locator('input').first().fill("第一袋大米");
await page.waitForTimeout(400);
await dialog.locator('button:has-text("快速保存")').first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(2600);

const afterSave = await api("GET", "/api/dashboard", null);
const saved = (afterSave.json?.items ?? []).map((item) => `${item.name}×${item.quantity}${item.unit}`);
check("第一件物品真的存进去了", saved.some((text) => text.startsWith("第一袋大米×1")), JSON.stringify(saved));
check("保存后录入弹窗自动关闭", (await page.locator('[role="dialog"][aria-label="录入新物品"]').count()) === 0, "弹窗还开着");

// ---------- 3 引导承诺的「完成第一步后小卡自动收起」 ----------
const guideState = await page.evaluate((key) => ({
  open: Boolean(document.querySelector('[role="dialog"][aria-label="欢迎使用"]')),
  seen: localStorage.getItem(key),
}), SEEN_KEY);
check("引导承诺「完成第一步后自动收起」—— 确实收起了", !guideState.open, "引导还开着");
check("并且写入了「看过」标记(下次不再打扰)", Boolean(guideState.seen), `标记=${guideState.seen ?? "(空)"}`);

// ---------- 4 首屏从「空」切到「有」,不能还挂着空状态文案 ----------
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
const filled = await page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " ").trim());
check("首屏切成了「有物品」的形态,不再显示「先录入第一件物品」", !/先录入家里的第一件物品/.test(filled), filled.slice(0, 140));
check("最近更新里能看到刚录入的这件", filled.includes("第一袋大米"), filled.slice(0, 220));
check("引导不会因为刷新又冒出来", !(await page.evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-label="欢迎使用"]')))), "刷新后引导又出现了");

// ---------- 5 物品页与空间页也要跟得上 ----------
await page.goto(`${BASE}/items`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
const itemsPage = await page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " ").trim());
check("物品页列出了这件物品", itemsPage.includes("第一袋大米"), itemsPage.slice(0, 160));

await page.goto(`${BASE}/locations`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);
const locationsPage = await page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " ").trim());
check("空间页在「一个空间都没有」时也有引导文案", /添加空间|还没有空间|建一个/.test(locationsPage), locationsPage.slice(0, 160));

// 收尾:把探针物品清掉,库还原成空
const leftovers = await api("GET", "/api/items?includeDeleted=1", null);
for (const item of leftovers.json ?? []) await api("DELETE", `/api/items/${item.id}`, { permanent: true });
await page.evaluate((key) => localStorage.setItem(key, "seen"), SEEN_KEY);

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);