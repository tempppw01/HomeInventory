// 采购闭环的验收:标记「已购买」到底往库存里加了几次。
//
// 本轮量到的缺陷(修之前):
//   库存 10 → 标记已购买+入库 → 13 ✓ → **再点一次「已购买」→ 16** → 撤销改回待购 → **16**(不退回)
//   → 再标记已购买 → **19**。
// 而每一次界面都说「采购已完成,并已入库」—— 账实不符,是这类应用最不能出的错。
//
// 根因:接口只要收到 `PURCHASED + replenishItemId` 就 +库存,没有任何「已经入过库」的记录。
// 修法:采购项记下 stockedAt / stockedQuantity / stockedItemId,只在第一次入库,撤销时退回。
//
// 用法:BASE_URL=... PROBE_USER=... PROBE_PASS=... node scripts/verify-shopping-purchase.mjs

import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const cookie = await loginCookie(BASE, USER, PASS);
const call = async (path, opts = {}) => {
  const response = await fetch(BASE + path, { method: opts.method ?? "GET", headers: { "content-type": "application/json", cookie }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json };
};

const STAMP = Date.now().toString(36).slice(-5);
const NAME = `采购闭环探针${STAMP}`;
const BASE_QTY = 10;
const BUY_QTY = 3;

const item = await call("/api/items", { method: "POST", body: { name: NAME, category: "食品", type: "CONSUMABLE", quantity: BASE_QTY, unit: "盒", minQuantity: 2, remainingPercent: 100 } });
const itemId = item.json?.id ?? null;
const shopping = await call("/api/shopping", { method: "POST", body: { name: NAME, quantity: BUY_QTY, unit: "盒", category: "食品", priority: 1, source: "manual" } });
// POST 的返回是 { item: {...} }
const shoppingId = shopping.json?.item?.id ?? shopping.json?.id ?? null;
check("造出一件物品与一条同名采购项", Boolean(itemId && shoppingId), `item=${item.status} shopping=${shopping.status}`);

const stock = async () => {
  const all = await call("/api/items?includeDeleted=1");
  return (Array.isArray(all.json) ? all.json : []).find((entry) => entry.id === itemId)?.quantity ?? null;
};
const patch = (body) => call(`/api/shopping/${shoppingId}`, { method: "PATCH", body });

if (itemId && shoppingId) {
  check("初始库存是 10", (await stock()) === BASE_QTY, `实际=${await stock()}`);

  // 1 第一次标记已购买 + 入库
  const first = await patch({ status: "PURCHASED", replenishItemId: itemId });
  check("第一次标记已购买会入库(+3)", (await stock()) === BASE_QTY + BUY_QTY, `实际=${await stock()}`);
  check("响应明确说「这次入库了」", first.json?.stocked === true, JSON.stringify(first.json).slice(0, 100));
  // 响应体必须反映**入库之后**的那一行:此前返回的是入库前的快照,第一次「已购买」的
  // 响应里 stockedAt/stockedQuantity 还是 null(界面靠刷新盖过去,接口自己在说谎)。
  check("响应里带的入库记账是入库之后的(不是入库前快照)", Boolean(first.json?.stockedAt) && Number(first.json?.stockedQuantity) === BUY_QTY && first.json?.stockedItemId === itemId, JSON.stringify({ stockedAt: first.json?.stockedAt ?? null, stockedQuantity: first.json?.stockedQuantity ?? null, stockedItemId: first.json?.stockedItemId ?? null }));

  // 2 再点一次「已购买」——不该再加
  const second = await patch({ status: "PURCHASED", replenishItemId: itemId });
  check("再点一次「已购买」**不会**重复加库存", (await stock()) === BASE_QTY + BUY_QTY, `实际=${await stock()}(修之前会变成 16)`);
  check("响应说明这次没有入库", second.json?.stocked === false, JSON.stringify(second.json).slice(0, 100));

  // 3 撤销(改回待购)——库存要退回
  const undone = await patch({ status: "PENDING" });
  check("撤销后库存退回原值", (await stock()) === BASE_QTY, `实际=${await stock()}(修之前会停在 16)`);
  check("响应说明这次是撤销入库", undone.json?.reverted === true, JSON.stringify(undone.json).slice(0, 100));
  check("撤销响应里的记账已经清空(不是撤销前快照)", undone.json?.stockedAt === null && undone.json?.stockedQuantity === null && undone.json?.stockedItemId === null, JSON.stringify({ stockedAt: undone.json?.stockedAt ?? null, stockedQuantity: undone.json?.stockedQuantity ?? null, stockedItemId: undone.json?.stockedItemId ?? null }));

  // 4 再买一次:只加一次
  const again = await patch({ status: "PURCHASED", replenishItemId: itemId });
  check("再次标记已购买只加一次", (await stock()) === BASE_QTY + BUY_QTY, `实际=${await stock()}(修之前会变成 19)`);
  check("这一次又真的入库了", again.json?.stocked === true, JSON.stringify(again.json).slice(0, 100));

  // 5 采购项上留了入库记账(便于排查与撤销)
  const dash = await call("/api/dashboard");
  const row = (dash.json?.shopping ?? []).find((entry) => entry.id === shoppingId);
  check("采购项上记下了「入过库多少」", Number(row?.stockedQuantity) === BUY_QTY && Boolean(row?.stockedAt), JSON.stringify({ stockedQuantity: row?.stockedQuantity ?? null, stockedAt: row?.stockedAt ?? null }));
}

// 收尾
if (itemId) await call(`/api/items/${itemId}`, { method: "DELETE", body: { permanent: true } });
if (shoppingId) await call(`/api/shopping/${shoppingId}`, { method: "DELETE" });
const leftover = await call("/api/dashboard");
check("探针数据已清理", !(leftover.json?.shopping ?? []).some((entry) => entry.name === NAME), "采购项还在");

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);