// 采购清单的界面验收:同一件东西在概览、清单、物品页是不是同一种说法。
//
// 起因 —— 2026-11-27 在真界面上量到的两处:
//   1. 概览的「补货建议」按名字排除了已经在清单里的物品,而首屏「最需要做的事」不看。
//      于是同一件东西:一处不吭声,一处还请你「加入采购清单」。实测点一次,清单上的数量
//      从 4 盒变成 8 盒(建议补的量本来就是 4 盒)—— 按钮上写的是「加入采购清单」,不是「再加一份」。
//   2. ★ 的提示语是「已加入常买清单」,但全应用没有一栏列出常买;而采购项一旦标成「已购买」
//      就离开唯一渲染它的列表(实测 3 项 → 2 项),常买标记从此看不到、也点不到。
//
// 这个套件要跑在**空库实例**上(CI 里是 3002,本地请指向临时库):
// 首屏挑哪一件事由数据决定,有已过期 / 临期 / 更晚更新的低库存物品在,首屏就不会挑到探针物品 ——
// 那会让断言量在别的物品上,「全部通过」却什么都没测。所以第一条检查就是「目标实例必须是空的」。
//
// 用法:BASE_URL=http://127.0.0.1:3002 PROBE_USER=leadcheck PROBE_PASS=... node scripts/verify-shopping-list-ui.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "leadcheck";
const PASS = process.env.PROBE_PASS;
if (!PASS) throw new Error("set PROBE_PASS");

const STAMP = Date.now().toString(36).slice(-5);
const A = `采购清单探针A·低库存已在清单${STAMP}`;   // 低库存 + 清单里已经有它
const B = `采购清单探针B·低库存没在清单${STAMP}`;   // 低库存 + 清单里没有
const C = `采购清单探针C·常买${STAMP}`;             // 手动加的待购项,用来量常买那一栏

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const finish = async (code) => {
  await context.close();
  await browser.close();
  process.exit(code);
};

const auth = await loginAndConfirm(page, BASE, USER, PASS);
check("已登录", auth.ok, auth.detail);
if (!auth.ok) await finish(1);

/** 从**应用自己的会话**里调接口:与界面读的是同一份数据,不会出现「接口对、界面不对」。 */
const api = async (method, path, body) => page.evaluate(async ({ method, path, body }) => {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  return { status: res.status, body: parsed };
}, { method, path, body });

const dashboard = async () => (await api("GET", "/api/dashboard")).body;

// ---------------------------------------------------------------- 0 前置:必须是空库实例
{
  const data = await dashboard();
  const items = data?.items?.length ?? -1;
  const shopping = data?.shopping?.length ?? -1;
  check("目标实例是空库(物品 0 件、采购项 0 条)", items === 0 && shopping === 0,
    `items=${items} shopping=${shopping} @ ${BASE} —— 这个套件要跑在空库实例上,不然首屏不会挑到探针物品`);
  if (items !== 0 || shopping !== 0) {
    console.log("      请指向空库实例(CI 用 3002;本地先建一个临时库再起实例),或在清空后重跑");
    await finish(1);
  }
}

// ---------------------------------------------------------------- 1 造探针
let itemA = null;
let itemB = null;
{
  const a = await api("POST", "/api/items", { name: A, category: "食品", type: "CONSUMABLE", quantity: 1, minQuantity: 5, unit: "瓶", remainingPercent: 100 });
  const b = await api("POST", "/api/items", { name: B, category: "日用", type: "CONSUMABLE", quantity: 2, minQuantity: 6, unit: "盒", remainingPercent: 100 });
  itemA = a.body?.id ?? null;
  itemB = b.body?.id ?? null;
  check("能造出两件低库存物品(A 已在清单 / B 不在清单)", Boolean(itemA && itemB), `itemA=${a.status} itemB=${b.status}`);

  // 建低库存物品时服务端会顺手建一条待采购建议(ensureRestockSuggestion):
  // A 留着(它就是「已经在清单里」的那一件),B 的删掉(否则「不在清单里」这个状态造不出来)。
  const data = await dashboard();
  const rows = data?.shopping ?? [];
  const suggestionOf = (name) => rows.find((row) => row.name === name && row.status === "PENDING");
  const aRow = suggestionOf(A);
  const bRow = suggestionOf(B);
  if (bRow) await api("DELETE", `/api/shopping/${bRow.id}`);
  const after = await dashboard();
  const names = (after?.shopping ?? []).map((row) => `${row.name}/${row.status}`);
  check("A 在清单里、B 不在清单里", Boolean(aRow) && !names.some((entry) => entry.startsWith(`${B}/PENDING`)), names.join("、"));
  check("A 的那条建议量正好是「建议补 4 瓶」", Number(aRow?.quantity) === 4, `quantity=${aRow?.quantity ?? null}`);
}

/** 读首屏那张卡:标题 / 明细 / 按钮文字(按钮只有一个,就在 dashboard-overview 里)。 */
const readHero = async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await dismissBlockingDialogs(page);
  return page.evaluate(() => {
    const section = document.querySelector("section.dashboard-overview");
    const text = (section?.innerText || "").replace(/\n+/g, " | ");
    const match = text.match(/最需要做的事 \| ([^|]+)\| ([^|]+)/);
    return {
      headline: match ? match[1].trim() : null,
      detail: match ? match[2].trim() : null,
      action: section?.querySelector("button")?.textContent?.trim() ?? null,
      raw: text.slice(0, 200),
    };
  });
};

const clickHeroAction = async () => {
  const clicked = await page.evaluate(() => {
    const button = document.querySelector("section.dashboard-overview button");
    if (!button) return null;
    const label = button.textContent?.trim() ?? "";
    button.click();
    return label;
  });
  await page.waitForTimeout(1800);
  return clicked;
};

/** 概览上的两个计数(「待采购 N 项」与「采购清单 · N」),以及物品页摘要里的那个数。 */
const readPendingCounts = async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await dismissBlockingDialogs(page);
  // 「采购清单 · N」在默认折叠的「更多待处理事项」里 —— 折叠的 <details> 内容不进 innerText,
  // 不先展开就只会读到 null(第一版就是这么量错的)。
  const more = page.locator('main details summary:has-text("更多待处理事项")').first();
  if (await more.count()) { await more.click(); await page.waitForTimeout(700); }
  const overview = await page.evaluate(() => {
    const text = document.querySelector("main")?.innerText || "";
    const metric = text.match(/待采购\s*(\d+)\s*项/);
    const section = text.match(/采购清单 · (\d+)/);
    return { metric: metric ? Number(metric[1]) : null, section: section ? Number(section[1]) : null };
  });
  await page.goto(`${BASE}/items`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await dismissBlockingDialogs(page);
  const itemsSummary = await page.evaluate(() => {
    const text = document.querySelector("main")?.innerText || "";
    const match = text.match(/(\d+)\s*项等你顺路带回家/);
    return match ? Number(match[1]) : null;
  });
  return { ...overview, itemsSummary };
};

const pendingFromApi = async () => ((await dashboard())?.shopping ?? []).filter((row) => row.status === "PENDING");

// ---------------------------------------------------------------- 2 B 不在清单里:首屏请你加入,点一次只加一份
{
  const hero = await readHero();
  check("首屏挑到的是 B(不在清单里的那件)", /采购清单探针B/.test(hero.headline ?? ""), `headline=${hero.headline}`);
  check("B 还没进清单时,首屏给的是「加入采购清单」", hero.action === "加入采购清单", `action=${hero.action}`);

  const before = (await pendingFromApi()).length;
  const clicked = await clickHeroAction();
  const rows = (await pendingFromApi()).filter((row) => row.name === B);
  check("点首屏那一下,清单里出现 B,数量 = 建议补的 4 盒(不是 8)", rows.length === 1 && Number(rows[0].quantity) === 4,
    `clicked=${clicked} rows=${rows.length} quantity=${rows[0]?.quantity ?? null}`);

  const after = (await pendingFromApi()).length;
  check("待采购只多了一条(不是两条)", after === before + 1, `before=${before} after=${after}`);

  const again = await readHero();
  check("B 进了清单之后,首屏不再给「加入采购清单」", again.action !== "加入采购清单", `action=${again.action}`);
  check("并说明已经有一份(4 盒),而不是继续邀请你加", /已经有一份\(4 盒\)/.test(again.detail ?? ""), `detail=${again.detail}`);

  const stillOne = (await pendingFromApi()).filter((row) => row.name === B);
  check("清单里 B 还是 4 盒(没有被重复加)", stillOne.length === 1 && Number(stillOne[0].quantity) === 4,
    `rows=${stillOne.length} quantity=${stillOne[0]?.quantity ?? null}`);
}

// ---------------------------------------------------------------- 3 A 一直在清单里:首屏从一开始就不请你加
{
  // 把 A 变成最近更新的物品 —— 首屏按 updatedAt 倒序挑低库存里最新的那一件。
  await api("PATCH", `/api/items/${itemA}`, { quantity: 1 });
  const hero = await readHero();
  check("首屏改挑 A", /采购清单探针A/.test(hero.headline ?? ""), `headline=${hero.headline}`);
  check("A 已经在清单里,首屏给的是「查看采购清单」", hero.action === "查看采购清单", `action=${hero.action}`);
  check("A 的明细里写清「采购清单里已经有一份(4 瓶)」", /已经有一份\(4 瓶\)/.test(hero.detail ?? ""), `detail=${hero.detail}`);
  check("已经在清单里的物品,首屏不出现「加入采购清单」", !/加入采购清单/.test(hero.raw ?? ""), hero.raw);
  // A 是「瓶」(应用按液体对待)但这次是**数量线**触发(1 瓶 < 提醒线 5 瓶),余量 100%。
  // 修之前首屏按「是不是液体」选说法,于是说「余量只剩 100%,低于你设的提醒线」——
  // 提醒中心说的是「库存仅剩 1 瓶」。一条是实话,一条自相矛盾。
  check("液体但数量线触发时,首屏不说「余量只剩 100%」", !/余量只剩 100%/.test(hero.detail ?? ""), `detail=${hero.detail}`);
  check("而是按数量线说清(还剩 1 瓶 / 提醒线 5 瓶)", /还剩 1 瓶/.test(hero.detail ?? "") && /提醒线是 5 瓶/.test(hero.detail ?? ""), `detail=${hero.detail}`);
}

// ---------------------------------------------------------------- 4 三个界面的「待采购」是同一个数
{
  const counts = await readPendingCounts();
  const apiPending = (await pendingFromApi()).length;
  const same = counts.metric === apiPending && counts.section === apiPending && counts.itemsSummary === apiPending;
  check("概览「待采购 N 项」= 「采购清单 · N」= 物品页「N 项等你顺路带回家」= 库里的待购条数", same,
    `概览=${counts.metric} 清单小节=${counts.section} 物品页=${counts.itemsSummary} 库里=${apiPending}`);
}

// ---------------------------------------------------------------- 5 常买:买过的也要看得见
{
  const created = await api("POST", "/api/shopping", { name: C, quantity: 1, unit: "袋", priority: 1, source: "manual" });
  const rowId = created.body?.item?.id ?? created.body?.id ?? null;
  check("能造出一条待购项 C(用来量常买)", Boolean(rowId), `status=${created.status}`);

  // 物品页的采购清单:展开后点 C 那一行的 ★
  await page.goto(`${BASE}/items`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await dismissBlockingDialogs(page);
  const summary = page.locator('main details summary:has-text("采购清单")').first();
  if (await summary.count()) { await summary.click(); await page.waitForTimeout(700); }

  const clickRowButton = (name, label) => page.evaluate(({ name, label }) => {
    const button = Array.from(document.querySelectorAll(`button[aria-label="${label}"]`))
      .find((node) => (node.closest(".group")?.textContent || "").includes(name));
    if (!button) return false;
    button.click();
    return true;
  }, { name, label });

  const starred = await clickRowButton(C, "标记为常买");
  await page.waitForTimeout(1600);
  check("能给 C 点★常买", starred, `found=${starred}`);
  const starredLabel = await page.evaluate((name) => Array.from(document.querySelectorAll("button"))
    .some((node) => node.getAttribute("aria-label") === "取消常买" && (node.closest(".group")?.textContent || "").includes(name)), C);
  check("点完★之后那一行变成「取消常买」(标记真的存下去了)", starredLabel, `取消常买=${starredLabel}`);

  // 期望值从**库里**取,不写死数字:A 与 B 早就在清单里,C 是刚加的那条,
  // 结算前后的条数由服务端说了算(第一版把预期写成了 1 与 2,自己把自己判红了一次)。
  const beforeBuy = (await pendingFromApi()).length;
  const bought = await clickRowButton(C, "标记为已购买");
  await page.waitForTimeout(1800);
  const afterBuy = await page.evaluate((name) => {
    const text = document.querySelector("main")?.innerText || "";
    const group = text.match(/(\d+)\s*项等你顺路带回家/);
    return {
      pending: group ? Number(group[1]) : null,
      rowShown: Array.from(document.querySelectorAll("button"))
        .some((node) => node.getAttribute("aria-label") === "标记为未购买" && (node.closest(".group")?.textContent || "").includes(name)),
      hasFavoriteSection: /常买 · 买过的留在这里/.test(text),
    };
  }, C);
  const afterBuyApi = (await pendingFromApi()).length;
  check("标记「已购买」之后,C 离开待购列表(少了一条,界面数字与库一致)",
    bought && afterBuyApi === beforeBuy - 1 && afterBuy.pending === afterBuyApi,
    `clicked=${bought} 买前=${beforeBuy} 库里=${afterBuyApi} 界面=${afterBuy.pending}`);
  check("但买过的常买项仍然看得见(常买那一栏真的存在)", afterBuy.hasFavoriteSection && afterBuy.rowShown,
    `常买栏=${afterBuy.hasFavoriteSection} 行在=${afterBuy.rowShown}`);

  const back = await clickRowButton(C, "标记为未购买");
  await page.waitForTimeout(1800);
  const afterBack = await page.evaluate((name) => {
    const text = document.querySelector("main")?.innerText || "";
    const group = text.match(/(\d+)\s*项等你顺路带回家/);
    return {
      pending: group ? Number(group[1]) : null,
      stillInFavorite: Array.from(document.querySelectorAll("button"))
        .some((node) => node.getAttribute("aria-label") === "标记为未购买" && (node.closest(".group")?.textContent || "").includes(name)),
    };
  }, C);
  const afterBackApi = (await pendingFromApi()).length;
  check("在常买那一栏点勾,能改回待采购(条数回到买之前)",
    back && afterBackApi === beforeBuy && afterBack.pending === afterBackApi,
    `clicked=${back} 库里=${afterBackApi} 界面=${afterBack.pending} 买前=${beforeBuy}`);
  check("改回待购之后,它不再留在常买那一栏", !afterBack.stillInFavorite, `还在常买栏=${afterBack.stillInFavorite}`);
}

// ---------------------------------------------------------------- 6 收尾:探针必须清干净(下一个套件还要在空库上跑)
{
  const rows = (await dashboard())?.shopping ?? [];
  for (const row of rows) if (row.name === A || row.name === B || row.name === C) await api("DELETE", `/api/shopping/${row.id}`);
  if (itemA) await api("DELETE", `/api/items/${itemA}`, { permanent: true });
  if (itemB) await api("DELETE", `/api/items/${itemB}`, { permanent: true });
  const after = await dashboard();
  const leftoverItems = (after?.items ?? []).filter((item) => `${item.name}`.includes("采购清单探针"));
  const leftoverShopping = (after?.shopping ?? []).filter((row) => `${row.name}`.includes("采购清单探针"));
  check("探针数据清理干净(物品与采购项都没残留)", leftoverItems.length === 0 && leftoverShopping.length === 0,
    `items=${leftoverItems.length} shopping=${leftoverShopping.length}`);
  check("实例回到空库(留给下一个套件)", (after?.items ?? []).length === 0 && (after?.shopping ?? []).length === 0,
    `items=${(after?.items ?? []).length} shopping=${(after?.shopping ?? []).length}`);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
await finish(failed.length ? 1 : 0);
