// 空间件数的界面验收:卡片上的「N 件」是不是**点进去看到的那个数**。
//
// 起因 —— 2026-11-27 在真界面上量到的两处:
//   1. 空间卡只数「直接放在这一层」的物品,而点卡片进物品页时是按「含下级空间」筛的。
//      实测「厨房」卡片写「1 件」,点进去是 2 件(另一件在吊柜里)。
//   2. 更明显的一处:一个自己没物品、下级空间有物品的空间,卡片写「**还没放东西**」,
//      点进去却有 1 件东西。卡片上的提示语是「点击空间卡片可直接查看其中的物品」,
//      所以卡片与它引导你去的地方不能各说一个数。
//
// 盘点的范围**故意更窄**(只数本层,因为盘点是照着货架挨个核对),但它写着「仅当前空间」——
// 这个套件会同时钉住「更窄但写明了」,免得以后有人把它也改成含下级却不再说明。
//
// 这个套件**不要求空库**:它自己造两棵探针空间树,量完删净。期望值都从接口现算
// (套件自己按 parentId 独立算一遍子树,不调用应用的实现 —— 免得两边一起错)。
//
// 用法:BASE_URL=http://127.0.0.1:3001 PROBE_USER=bgs PROBE_PASS=... node scripts/verify-space-counts-ui.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS;
if (!PASS) throw new Error("set PROBE_PASS");

const STAMP = Date.now().toString(36).slice(-5);
// 第一棵:父自己 1 件、子 1 件、孙 1 件(父的子树 3 件)——「卡片要等于点进去的件数」
const ROOM = `空间探针·储藏间${STAMP}`;
const SHELF = `空间探针·货架${STAMP}`;
const DRAWER = `空间探针·上层${STAMP}`;
// 第二棵:父自己 0 件、子 1 件 —— 实测里卡片会写「还没放东西」的那个情形
const HALL = `空间探针·走廊${STAMP}`;
const CABINET = `空间探针·柜子${STAMP}`;
// 第三棵:自己和下级都空
const EMPTY_TOP = `空间探针·空柜${STAMP}`;
const EMPTY_CHILD = `空间探针·空层${STAMP}`;

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
await dismissBlockingDialogs(page);

/** 从**应用自己的会话**里调接口:与界面读的是同一份数据。 */
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

// ---------------------------------------------------------------- 0 造树
const created = { locations: [], items: [] };
const addLocation = async (name, parentId) => {
  const res = await api("POST", "/api/locations", { name, icon: "Package", parentId: parentId ?? null, notes: null });
  if (res.status !== 201) throw new Error(`建空间失败:${name} ${res.status} ${JSON.stringify(res.body)}`);
  created.locations.push(res.body.id);
  return res.body.id;
};
const addItem = async (name, locationId, quantity, price) => {
  const res = await api("POST", "/api/items", {
    name, category: "日用", type: "DURABLE", quantity, minQuantity: 0, remainingPercent: 100,
    unit: "盒", price, purchaseDate: null, expiryDate: null, locationId, notes: null,
    imageUrl: null, recordPurchase: false, purchaseStore: null,
  });
  if (res.status !== 201) throw new Error(`建物品失败:${name} ${res.status} ${JSON.stringify(res.body)}`);
  created.items.push(res.body.id);
  return res.body.id;
};

const roomId = await addLocation(ROOM, null);
const shelfId = await addLocation(SHELF, roomId);
const drawerId = await addLocation(DRAWER, shelfId);
const hallId = await addLocation(HALL, null);
const cabinetId = await addLocation(CABINET, hallId);
const emptyTopId = await addLocation(EMPTY_TOP, null);
await addLocation(EMPTY_CHILD, emptyTopId);
await addItem(`${ROOM}·自己的箱子`, roomId, 3, 10);
await addItem(`${SHELF}·自己的抽纸`, shelfId, 2, 5);
await addItem(`${DRAWER}·自己的胶带`, drawerId, 4, 1);
await addItem(`${CABINET}·自己的抹布`, cabinetId, 1, 2);

const cleanup = async () => {
  for (const id of created.items) await api("DELETE", `/api/items/${id}`, { permanent: true });
  // 先删叶子再删父级:空间里还有物品时接口会拒绝删除(409)
  for (const id of [...created.locations].reverse()) await api("DELETE", `/api/locations/${id}`);
};

try {
  const data = await dashboard();
  const locations = data.locations;
  const items = data.items;

  // 期望值:套件自己按 parentId 独立算一遍子树
  const subtreeIds = (rootId) => {
    const out = new Set([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const location of locations) {
        if (location.parentId && out.has(location.parentId) && !out.has(location.id)) { out.add(location.id); grew = true; }
      }
    }
    return out;
  };
  const inScope = (rootId) => items.filter((item) => item.locationId && subtreeIds(rootId).has(item.locationId));
  const countIn = (rootId) => inScope(rootId).length;
  const ownCountIn = (rootId) => items.filter((item) => item.locationId === rootId).length;
  const valueIn = (rootId) => inScope(rootId).reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0);

  const expected = { room: countIn(roomId), shelf: countIn(shelfId), drawer: countIn(drawerId), hall: countIn(hallId), emptyTop: countIn(emptyTopId) };
  check(
    "探针树造好了:父 3 件 / 子 2 件 / 孙 1 件,走廊(自己 0 件)1 件,空柜 0 件",
    expected.room === 3 && expected.shelf === 2 && expected.drawer === 1 && expected.hall === 1 && expected.emptyTop === 0,
    JSON.stringify(expected),
  );

  // ---------------------------------------------------------------- 1 空间页:卡片与导轨
  const readLocations = async () => {
    await page.goto(`${BASE}/locations`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    return page.evaluate(() => {
      const cards = [...document.querySelectorAll("button.surface")].map((el) => {
        const lines = (el.innerText || "").split("\n").map((line) => line.trim()).filter(Boolean);
        return { name: lines[0] ?? "", path: lines[1] ?? "", text: (el.innerText || "").replace(/\s+/g, " ").trim() };
      });
      const rail = [...document.querySelectorAll(".browse-rail-item")].map((el) => {
        const lines = (el.innerText || "").split("\n").map((line) => line.trim()).filter(Boolean);
        return { name: lines[0] ?? "", count: Number(lines[lines.length - 1] ?? NaN) };
      });
      return { cards, rail };
    });
  };
  const cardOf = (view, name) => view.cards.find((card) => card.name === name)?.text ?? "";
  const cardCount = (text) => Number((text.match(/(\d+)\s*件/) ?? [])[1] ?? NaN);
  // 导轨上写的是**路径**(同名空间分得开):顶层就是名字,下级是「父 / 子」
  const railCount = (view, name) => view.rail.find((entry) => entry.name === name || entry.name.endsWith(`/ ${name}`))?.count ?? NaN;

  const view = await readLocations();
  const roomCard = cardOf(view, ROOM);
  const shelfCard = cardOf(view, SHELF);
  const drawerCard = cardOf(view, DRAWER);
  const hallCard = cardOf(view, HALL);
  const emptyCard = cardOf(view, EMPTY_TOP);

  check("父空间卡片上的「N 件」= 含下级空间的件数", cardCount(roomCard) === expected.room, `卡片=${roomCard}`);
  check("子空间卡片上的「N 件」= 含下级空间的件数", cardCount(shelfCard) === expected.shelf, `卡片=${shelfCard}`);
  check("孙空间卡片上的件数(它自己那一件)", cardCount(drawerCard) === expected.drawer, `卡片=${drawerCard}`);
  check(
    "父空间卡片说清它有下级空间(否则「父 3 件 / 子 2 件」摆在同一屏像多数了)",
    /含 1 个下级空间/.test(roomCard),
    `卡片=${roomCard}`,
  );
  check("没有下级空间时不要提下级(孙空间那张卡)", !/下级空间/.test(drawerCard), `卡片=${drawerCard}`);
  check(
    "自己没物品但下级有:卡片不许再说「还没放东西」(实测就是这句谎)",
    cardCount(hallCard) === 1 && !/还没放东西/.test(hallCard),
    `卡片=${hallCard}`,
  );
  check(
    "下级也是空的:卡片说清「下级空间也是空的」",
    /还没放东西.*下级空间也是空的/.test(emptyCard),
    `卡片=${emptyCard}`,
  );
  check("导轨上的件数与卡片是同一个数(父)", railCount(view, ROOM) === cardCount(roomCard), `导轨=${railCount(view, ROOM)} 卡片=${roomCard}`);
  check("导轨上的件数与卡片是同一个数(子)", railCount(view, SHELF) === cardCount(shelfCard), `导轨=${railCount(view, SHELF)} 卡片=${shelfCard}`);
  check("导轨上的件数与卡片是同一个数(自己 0 件、下级有东西的那张)", railCount(view, HALL) === cardCount(hallCard), `导轨=${railCount(view, HALL)} 卡片=${hallCard}`);
  check(
    "卡片上的估值 = 含下级空间的数量 × 单价",
    Math.round(Number((roomCard.match(/约 ¥(\d+)/) ?? [])[1] ?? NaN)) === Math.round(valueIn(roomId)),
    `卡片=${roomCard} 手算=${valueIn(roomId)}`,
  );

  // ---------------------------------------------------------------- 2 点卡片:物品页的件数必须与卡片一致
  const openSpace = async (name) => {
    await page.goto(`${BASE}/locations`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const clicked = await page.evaluate((target) => {
      const card = [...document.querySelectorAll("button.surface")]
        .find((el) => ((el.innerText || "").split("\n")[0] ?? "").trim() === target);
      if (!card) return false;
      card.click();
      return true;
    }, name);
    await page.waitForTimeout(1700);
    const seen = await page.evaluate((stamp) => {
      const leaf = [...document.querySelectorAll("main *")]
        .filter((el) => el.children.length === 0 && /^\d+\s*件$/.test((el.textContent || "").trim()));
      const chip = [...document.querySelectorAll("main button")].map((el) => (el.innerText || "").trim()).find((text) => text.startsWith("空间:"));
      const rows = [...document.querySelectorAll("main article, main [class*='surface']")]
        .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim()).filter((text) => text.includes(stamp));
      return {
        chip: chip ?? "",
        countText: leaf[0] ? leaf[0].textContent.trim() : "",
        visible: leaf[0] ? leaf[0].offsetParent !== null : false,
        rows,
      };
    }, STAMP);
    return { clicked, ...seen };
  };
  const listedCount = (text) => Number((text.match(/^(\d+)\s*件$/) ?? [])[1] ?? NaN);

  const roomView = await openSpace(ROOM);
  check("点父空间卡片 → 物品页按它筛选", roomView.clicked && roomView.chip.includes(ROOM), `chip=${roomView.chip}`);
  check("物品页上写的件数 = 卡片上的件数(父)", listedCount(roomView.countText) === cardCount(roomCard), `物品页=${roomView.countText} 卡片=${roomCard}`);
  check("这个件数是看得见的(不是被隐藏的元素)", roomView.visible, `visible=${roomView.visible}`);
  check("列表里确实有父空间这一支的 3 件物品", roomView.rows.length === expected.room, `列表=${roomView.rows.length} 期望=${expected.room}`);

  const shelfView = await openSpace(SHELF);
  check("物品页上写的件数 = 卡片上的件数(子)", listedCount(shelfView.countText) === cardCount(shelfCard), `物品页=${shelfView.countText} 卡片=${shelfCard}`);
  check("子空间的列表里有孙空间里的那件(含下级)", shelfView.rows.some((text) => text.includes(DRAWER)), `列表=${shelfView.rows.join(" | ")}`);
  check("子空间的列表里**没有**父空间自己的那件(只往下,不往上)", !shelfView.rows.some((text) => text.includes(`${ROOM}·自己的箱子`)), `列表=${shelfView.rows.join(" | ")}`);

  const hallView = await openSpace(HALL);
  check(
    "自己 0 件、下级有 1 件:点进去看得到那 1 件,与卡片一致(卡片不再说「还没放东西」)",
    hallView.clicked && listedCount(hallView.countText) === 1 && hallView.rows.some((text) => text.includes(CABINET)),
    `物品页=${hallView.countText} 列表=${hallView.rows.join(" | ")}`,
  );

  const emptyView = await openSpace(EMPTY_TOP);
  check("空空间点进去是 0 件,与卡片一致", emptyView.clicked && listedCount(emptyView.countText) === 0, `物品页=${emptyView.countText}`);

  // ---------------------------------------------------------------- 3 盘点:范围更窄,但写明了
  await page.goto(`${BASE}/audit`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const audit = await page.evaluate(async (room) => {
    const select = [...document.querySelectorAll("select")].find((el) => [...el.options].some((option) => option.text === room));
    if (!select) return { ok: false, reason: "盘点页没有空间下拉框" };
    const option = [...select.options].find((entry) => entry.text === room);
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 1400));
    const text = (document.querySelector("main")?.innerText || "").replace(/\s+/g, " ");
    return {
      ok: true,
      checklist: Number((text.match(/当前范围共\s*(\d+)\s*件/) ?? [])[1] ?? NaN),
      labelled: /仅当前空间/.test(text),
      childItemMentioned: text.includes("自己的抽纸"),
    };
  }, ROOM);
  check("盘点页能按空间选范围", audit.ok, audit.reason ?? "");
  check(
    "盘点只数本层(盘点是照着货架挨个核对),但必须写着「仅当前空间」",
    audit.ok && audit.checklist === ownCountIn(roomId) && audit.labelled,
    `盘点=${audit.checklist} 本层手算=${ownCountIn(roomId)} 写着仅当前空间=${audit.labelled}`,
  );
  check(
    "盘点的范围确实比空间卡窄(这正是它需要那句话的原因)",
    audit.ok && audit.checklist < cardCount(roomCard),
    `盘点=${audit.checklist} 空间卡=${cardCount(roomCard)}`,
  );
  check("盘点没把下级空间的东西混进本层核对表", audit.ok && !audit.childItemMentioned, `含下级物品=${audit.childItemMentioned}`);
} finally {
  await cleanup();
}

// ---------------------------------------------------------------- 4 收尾
const after = await dashboard();
const leftoverSpaces = (after?.locations ?? []).filter((entry) => entry.name.includes(STAMP));
const leftoverItems = (after?.items ?? []).filter((entry) => entry.name.includes(STAMP));
check("探针空间清干净了", leftoverSpaces.length === 0, `还剩 ${leftoverSpaces.map((entry) => entry.name).join("、")}`);
check("探针物品清干净了", leftoverItems.length === 0, `还剩 ${leftoverItems.map((entry) => entry.name).join("、")}`);

await page.goto(`${BASE}/locations`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const finalCards = await page.evaluate(() => [...document.querySelectorAll("button.surface")].map((el) => (el.innerText || "").replace(/\s+/g, " ").trim()));
check("空间页上不再出现探针空间", finalCards.every((text) => !text.includes(STAMP)), `卡片=${finalCards.join(" / ")}`);

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
await finish(failed.length ? 1 : 0);