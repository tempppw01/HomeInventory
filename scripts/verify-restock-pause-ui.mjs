// 「暂停补货提醒」界面入口的验收。
//
// 这个功能此前是半成品:字段存在、客户端逻辑尊重它、接口也接受它,
// 但**界面上没有任何入口**,用户根本开不了 —— 所以这一套专门盯界面这一半。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-restock-pause-ui.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

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

/** 打开第一张消耗品卡片的 ⋯ 菜单,返回菜单项文字 */
const openMenu = async () => {
  await page.goto(`${BASE}/items`);
  await page.waitForTimeout(2600);
  await dismissBlockingDialogs(page);
  // 先筛成消耗品:这个入口只对消耗品出现,而「第一张卡片」是谁取决于库里的更新时间,
  // 别的套件建的耐用品一旦排在前面,这里就会拿到一个本来就没有该入口的物品。
  const consumableFilter = page.getByRole('button', { name: '消耗品', exact: true }).first();
  if ((await consumableFilter.count()) > 0) {
    await consumableFilter.click().catch(() => {});
    await page.waitForTimeout(900);
  }
  await page.locator('main button[aria-label="更多操作"]').first().click({ button: "right" });
  await page.waitForTimeout(900);
  return page.evaluate(() => Array.from(document.querySelectorAll('[role="menuitem"]')).map((node) => (node.textContent || "").trim()));
};

/** 当前处于暂停期的物品名 */
const pausedNames = () => page.evaluate(async () => {
  const response = await fetch("/api/dashboard", { cache: "no-store" });
  const body = await response.json();
  return (body.items ?? [])
    .filter((item) => item.restockPausedUntil && new Date(item.restockPausedUntil).getTime() > Date.now())
    .map((item) => item.name);
});

const clickMenu = (text) => page.evaluate((needle) => {
  const node = Array.from(document.querySelectorAll('[role="menuitem"]')).find((entry) => (entry.textContent || "").includes(needle));
  if (!node) return false;
  node.click();
  return true;
}, text);

// 先让待会儿要点的第一张卡片回到「未暂停」状态。
// 这里**不能**用「库里有没有暂停物品」来判断:家人真的暂停过别的物品是正常的
// (本地这套就是对着真实家用库跑的),那样会去恢复另一件东西,等于没处理这张卡片。
{
  const items = await openMenu();
  if (items.some((entry) => entry.includes("恢复补货提醒"))) {
    await clickMenu("恢复补货提醒");
    await page.waitForTimeout(2200);
  }
}

// 动手前的暂停名单:断言只针对「这次点下去的那一件」。
// 此前这里要求恢复后全库一件不剩 —— 只要家里有别的物品处于暂停期就会误报。
const pausedBaseline = await pausedNames();
let pausedThisRun = [];

// ① 菜单里有入口
{
  const items = await openMenu();
  const consumableCards = await page.locator('main button[aria-label="更多操作"]').count();
  check("筛成消耗品后确实有卡片可点(防止空跑)", consumableCards > 0, `卡片数=${consumableCards}`);
  check("卡片菜单里有「暂停补货提醒」入口", items.some((entry) => entry.includes("暂停补货提醒")), `菜单=${items.join("/")}`);
}

// ② 点击后真的写入了暂停期(不是只有提示)
{
  const paused = await openMenu();
  if (!paused.some((entry) => entry.includes("暂停补货提醒"))) {
    check("点击后物品进入暂停期", false, "菜单里没有该入口");
  } else {
    await clickMenu("暂停补货提醒");
    await page.waitForTimeout(2600);
    const names = await pausedNames();
    pausedThisRun = names.filter((name) => !pausedBaseline.includes(name));
    check("点击后物品进入暂停期(数据已写入)", pausedThisRun.length === 1, `本次暂停=${pausedThisRun.join(",") || "无"};库里暂停中的=${names.join(",") || "无"}`);

    const feedback = await page.evaluate(() => /已暂停补货提醒/.test(document.body.innerText));
    check("给出了可见反馈", feedback, "没有看到提示文字");
  }
}

// ③ 再次打开菜单变成「恢复」,且点击后暂停期被清掉
{
  const items = await openMenu();
  check("暂停后菜单变成「恢复补货提醒」", items.some((entry) => entry.includes("恢复补货提醒")), `菜单=${items.join("/")}`);

  if (items.some((entry) => entry.includes("恢复补货提醒"))) {
    await clickMenu("恢复补货提醒");
    await page.waitForTimeout(2600);
    const names = await pausedNames();
    const stillPaused = pausedThisRun.filter((name) => names.includes(name));
    check("恢复后「这一件」的暂停期被清掉", stillPaused.length === 0, `仍在暂停=${stillPaused.join(",") || "无"}`);
  }
}

// 4 暂停之后,所有界面必须同时改口
//
// 由来:isLowStock 的 now 参数当初写成可选,「不传就跳过暂停判定」,
// 而物品卡角标 / 空间摘要 / 月报这三个只做展示的调用点恰好都没传。
// 于是用户暂停了某件东西:概览的「低库存」少算了它,同一张卡片上却还挂着「需补货」——
// 同一个「该补货」在一屏里有 4 项和 6 项两个答案。
//
// 这一节只验「改了口的界面是否一致」:暂停通过接口写(界面入口本身由上面 1-3 节覆盖),
// 这样断言不依赖卡片排序,也不会因为选中了别的物品而变成假通过。
const SCOPE_NAME = "暂停口径检查·酱油";

const api = (method, path, body) => page.evaluate(async (request) => {
  const response = await fetch(request.path, {
    method: request.method,
    cache: "no-store",
    headers: request.body ? { "content-type": "application/json" } : undefined,
    body: request.body ? JSON.stringify(request.body) : undefined,
  });
  let parsed = null;
  try { parsed = await response.json(); } catch { parsed = null; }
  return { status: response.status, body: parsed };
}, { method, path, body });

/** 概览上的「低库存 N 项」 */
const overviewLowStock = async () => {
  await page.goto(BASE);
  await page.waitForTimeout(2600);
  await dismissBlockingDialogs(page);
  return page.evaluate(() => {
    const text = document.querySelector(".dashboard-overview")?.innerText ?? "";
    const matched = text.match(/低库存\D{0,4}(\d+)\s*项/);
    return matched ? Number(matched[1]) : null;
  });
};

/** 物品页上「需补货」角标的个数 */
const restockBadges = async () => {
  await page.goto(`${BASE}/items`);
  await page.waitForTimeout(2600);
  await dismissBlockingDialogs(page);
  return page.evaluate(() => Array.from(document.querySelectorAll("*"))
    .filter((node) => node.children.length === 0 && (node.textContent || "").trim() === "需补货").length);
};

/** 提醒中心里是否提到某件物品 */
const alertsMention = async (name) => {
  await page.goto(BASE);
  await page.waitForTimeout(2400);
  await dismissBlockingDialogs(page);
  await page.locator('button[aria-label="查看提醒"]').first().click();
  await page.waitForTimeout(1000);
  const text = await page.locator('[role="dialog"][aria-modal="true"]').first().innerText();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  return text.includes(name);
};

/**
 * 采购项清单只有 `/api/dashboard` 给(`/api/shopping` **没有 GET**,请求它回 405)。
 *
 * 这里此前写的是 `api("GET", "/api/shopping")`:405 → `Array.isArray(undefined)` 为假 →
 * 循环一次都不进,界面根本不会报错,于是「清理」这一步**每跑一次就白跑一次**,
 * 而最后那条「比对用的物品已清理干净」只看物品 —— 实测本机库里因此攒下了
 * 「暂停口径检查·酱油」这条 PENDING 采购项,套件仍然 17/17 通过。
 */
const pendingShoppingNames = async () => {
  const dashboard = await api("GET", "/api/dashboard");
  return (Array.isArray(dashboard.body?.shopping) ? dashboard.body.shopping : []).map((row) => row.name);
};

const scopeShoppingRows = async () => {
  const dashboard = await api("GET", "/api/dashboard");
  return (Array.isArray(dashboard.body?.shopping) ? dashboard.body.shopping : []).filter((row) => row.name === SCOPE_NAME);
};

/** 按名字清掉这次比对造的物品与它自动生成的采购建议(套件跑完库里不该多东西) */
const removeScopeItem = async () => {
  for (const row of await scopeShoppingRows()) {
    await api("DELETE", `/api/shopping/${row.id}`);
  }
  const items = await api("GET", "/api/items");
  for (const row of (Array.isArray(items.body) ? items.body : []).filter((entry) => entry.name === SCOPE_NAME)) {
    await api("DELETE", `/api/items/${row.id}`);
    await api("DELETE", `/api/items/${row.id}`, { permanent: true });
  }
};

await removeScopeItem();
const created = await api("POST", "/api/items", {
  name: SCOPE_NAME, category: "调味", type: "CONSUMABLE", unit: "瓶", quantity: 1, minQuantity: 5,
});
check("为口径比对建了一件低库存消耗品", created.status === 200 || created.status === 201, `status=${created.status}`);
const scopeId = created.body?.id;

const badgesBefore = await restockBadges();
const metricBefore = await overviewLowStock();
const mentionedBefore = await alertsMention(SCOPE_NAME);
check("暂停前:物品页上这件东西带着「需补货」角标", badgesBefore > 0, `角标总数=${badgesBefore}`);
check("暂停前:概览的「低库存」算上了它", typeof metricBefore === "number" && metricBefore > 0, `低库存=${metricBefore}`);
check("暂停前:提醒中心会提到它", mentionedBefore, "提醒中心里没有这条");

if (scopeId) {
  await api("PATCH", `/api/items/${scopeId}`, { restockPausedUntil: new Date(Date.now() + 7 * 86400000).toISOString() });

  const badgesPaused = await restockBadges();
  const metricPaused = await overviewLowStock();
  const mentionedPaused = await alertsMention(SCOPE_NAME);
  check("暂停后:卡片角标跟着消失", badgesPaused === badgesBefore - 1, `角标 ${badgesBefore} → ${badgesPaused}(应少 1)`);
  check("暂停后:概览的「低库存」也少算它", metricPaused === metricBefore - 1, `低库存 ${metricBefore} → ${metricPaused}(应少 1)`);
  check("暂停后:提醒中心不再提它", mentionedPaused === false, "提醒中心仍然列着");

  await api("PATCH", `/api/items/${scopeId}`, { restockPausedUntil: null });
  const badgesRestored = await restockBadges();
  const metricRestored = await overviewLowStock();
  check("恢复提醒后:角标回来", badgesRestored === badgesBefore, `角标 ${badgesPaused} → ${badgesRestored}(应回到 ${badgesBefore})`);
  check("恢复提醒后:概览也回到原数", metricRestored === metricBefore, `低库存 ${metricPaused} → ${metricRestored}(应回到 ${metricBefore})`);
}

await removeScopeItem();
const leftovers = await api("GET", "/api/items");
const stillThere = (Array.isArray(leftovers.body) ? leftovers.body : []).filter((entry) => entry.name === SCOPE_NAME).length;
const stillShopping = (await pendingShoppingNames()).filter((name) => name === SCOPE_NAME).length;
check("比对用的物品已清理干净", stillThere === 0, `还剩 ${stillThere} 件`);
// 这条以前不存在 —— 于是「采购项没清掉」在报告里根本没有位置,只能靠人去翻库。
check("比对用的采购项已清理干净(不再每跑一次留一条)", stillShopping === 0, `还剩 ${stillShopping} 条采购项`);

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);