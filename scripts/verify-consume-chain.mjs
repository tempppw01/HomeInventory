// 消耗链的验收:消耗 → 撤销消耗 → 补货建议 → 扫码消耗。
//
// 本轮量到的三处缺陷(修之前,均为实测):
//   1 消耗 3 次(rate=0.1)→ 撤销 1 次:数量退回 8 了,consumeRate **仍是 0.1**(应为 2/30)。
//     根因:撤销时先数流水、后写 undoneAt,刚撤销的那次还留在分子里。
//     后果:「还能用几天」「每月花费」按一次没发生过的消耗在算,而且不会自愈。
//   2 余量型消耗(瓶装 quantity=1、余量 100% → 60%)撤销后:quantity **变成 2**、余量仍是 60% ——
//     凭空多一瓶。根因:撤销一律 quantity+1,不管这次消耗动的是数量还是余量。
//   3 扫码消耗 3 次:consumeRate **恒为 0**,待采购建议也走另一套代码。
//     根因:公开扫码接口自己算,从来没算过消耗速度。
//
// 另有一处接口自身说谎:撤销响应里的 item 是撤销**之前**的快照(数量比库里少 1)。
//
// 用法:BASE_URL=... PROBE_USER=... PROBE_PASS=... node scripts/verify-consume-chain.mjs

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
const NAME_A = `消耗链探针A${STAMP}`;
const NAME_B = `消耗链探针B${STAMP}`;
const NAME_C = `消耗链探针C${STAMP}`;
const NAME_D = `消耗链探针D${STAMP}`;
const created = [];
const createdShopping = new Set();

const createItem = async (body) => {
  const res = await call("/api/items", { method: "POST", body });
  const id = res.json?.id ?? res.json?.item?.id ?? null;
  if (id) created.push(id);
  return { id, status: res.status };
};

const itemOf = async (id) => (await call(`/api/items/${id}`)).json ?? {};
const shoppingRows = async () => (await call("/api/dashboard")).json?.shopping ?? [];
const near = (actual, expected, tolerance = 1e-6) => typeof actual === "number" && Math.abs(actual - expected) < tolerance;

// ---------- A:数量型 —— 撤销后消耗速度必须回落 ----------
const a = await createItem({ name: NAME_A, category: "零食", type: "CONSUMABLE", unit: "件", quantity: 10, minQuantity: 3, remainingPercent: 100 });
check("造出一件数量型消耗品", Boolean(a.id), `status=${a.status}`);

if (a.id) {
  check("初始没有消耗速度", (await itemOf(a.id)).consumeRate === 0, `实际=${(await itemOf(a.id)).consumeRate}`);

  const consumeIds = [];
  for (let index = 0; index < 3; index += 1) {
    const res = await call(`/api/items/${a.id}/consume`, { method: "POST" });
    if (res.json?.activityId) consumeIds.push(res.json.activityId);
  }
  const after3 = await itemOf(a.id);
  check("消耗 3 次:数量 10 → 7", after3.quantity === 7, `实际=${after3.quantity}`);
  check("消耗 3 次:consumeRate = 3/30", near(after3.consumeRate, 3 / 30), `实际=${after3.consumeRate}`);

  const undo = await call(`/api/activity/${consumeIds[2]}/undo`, { method: "POST" });
  const afterUndo = await itemOf(a.id);
  check("撤销一次:数量回到 8", afterUndo.quantity === 8, `实际=${afterUndo.quantity}`);
  check("撤销一次:consumeRate 回落到 2/30", near(afterUndo.consumeRate, 2 / 30), `实际=${afterUndo.consumeRate}(修之前停在 0.1)`);
  check("撤销响应里的物品就是撤销之后的状态", undo.json?.item?.quantity === 8, `响应 quantity=${undo.json?.item?.quantity}(修之前是撤销前的 7)`);

  const logs = (await call(`/api/activity?itemId=${a.id}`)).json ?? [];
  check("流水里未撤销的消耗只剩 2 条", logs.filter((row) => row.action === "CONSUME" && !row.undoneAt).length === 2, `实际=${logs.filter((row) => row.action === "CONSUME" && !row.undoneAt).length}`);
  check("撤销动作本身留了痕", logs.some((row) => row.action === "CONSUME_UNDO" && row.undoOfId === consumeIds[2]), "没有 CONSUME_UNDO 流水");

  const twice = await call(`/api/activity/${consumeIds[2]}/undo`, { method: "POST" });
  check("同一条消耗不能撤销两次", twice.status === 409, `status=${twice.status}`);

  await call(`/api/items/${a.id}/consume`, { method: "POST" });
  check("撤销后再消耗一次:consumeRate 回到 3/30", near((await itemOf(a.id)).consumeRate, 3 / 30), `实际=${(await itemOf(a.id)).consumeRate}`);
}

// ---------- B:余量型 —— 撤销要退余量,不是加一瓶 ----------
const b = await createItem({ name: NAME_B, category: "调料", type: "CONSUMABLE", unit: "瓶", quantity: 1, minQuantity: 0, remainingPercent: 100 });
check("造出一件余量型(瓶装)消耗品", Boolean(b.id), `status=${b.status}`);

if (b.id) {
  await call(`/api/items/${b.id}`, { method: "PATCH", body: { remainingPercent: 60 } });
  const b1 = await itemOf(b.id);
  check("余量 100% → 60% 记下一次消耗(数量不动)", b1.quantity === 1 && b1.remainingPercent === 60, `quantity=${b1.quantity} percent=${b1.remainingPercent}`);

  const bLogs = (await call(`/api/activity?itemId=${b.id}`)).json ?? [];
  const percentLog = bLogs.find((row) => row.action === "CONSUME" && !row.undoneAt);
  check("这条消耗记下了当时的余量", percentLog?.percentBefore === 100, JSON.stringify({ percentBefore: percentLog?.percentBefore ?? null, percentAfter: percentLog?.percentAfter ?? null }));

  const bUndo = await call(`/api/activity/${percentLog?.id}/undo`, { method: "POST" });
  const b2 = await itemOf(b.id);
  check("撤销余量消耗:瓶数仍是 1", b2.quantity === 1, `实际=${b2.quantity}(修之前变成 2 —— 凭空多一瓶)`);
  check("撤销余量消耗:余量回到 100%", b2.remainingPercent === 100, `实际=${b2.remainingPercent}(修之前停在 60)`);
  check("撤销余量消耗:消耗速度不虚增", Number(b2.consumeRate ?? 0) < 1 / 30, `实际=${b2.consumeRate}(修之前平白多出 1/30)`);
  check("响应说明撤回的是余量", bUndo.json?.restoredPercent === 100, JSON.stringify(bUndo.json?.restoredPercent ?? null));

  // 撤销过的余量消耗不能再撤销
  const bTwice = await call(`/api/activity/${percentLog?.id}/undo`, { method: "POST" });
  check("撤销过的余量消耗不能再撤销", bTwice.status === 409, `status=${bTwice.status}`);
}

// ---------- C:扫码消耗也要算进消耗速度 ----------
const c = await createItem({ name: NAME_C, category: "零食", type: "CONSUMABLE", unit: "件", quantity: 5, minQuantity: 0, remainingPercent: 100 });
check("造出一件用于扫码的消耗品", Boolean(c.id), `status=${c.status}`);

if (c.id) {
  let scanned = 0;
  for (let index = 0; index < 3; index += 1) {
    const res = await call("/api/public/consume", { method: "POST", body: { itemId: c.id, requestId: crypto.randomUUID() } });
    if (res.status === 200) scanned += 1;
  }
  const c1 = await itemOf(c.id);
  check("扫码消耗 3 次成功", scanned === 3, `实际=${scanned}`);
  check("扫码消耗真的减库存(5 → 2)", c1.quantity === 2, `实际=${c1.quantity}`);
  check("扫码消耗计入 consumeRate(3/30)", near(c1.consumeRate, 3 / 30), `实际=${c1.consumeRate}(修之前恒为 0)`);

  const replay = await call("/api/public/consume", { method: "POST", body: { itemId: c.id, requestId: crypto.randomUUID() } });
  check("扫码接口仍可用(未登录)", replay.status === 200, `status=${replay.status}`);
}

// ---------- D:撤销消耗之后,自动生成的待采购建议该去该留 ----------
// 一:退回之后**仍然**低于最低库存(2 ≤ 2)→ 建议要留着,不然用户刚点完撤销就丢了采购项。
const d = await createItem({ name: NAME_D, category: "零食", type: "CONSUMABLE", unit: "件", quantity: 2, minQuantity: 2, remainingPercent: 100 });
check("造出一件「低于最低库存会建议补货」的物品", Boolean(d.id), `status=${d.status}`);

if (d.id) {
  const rowsAtCreate = (await shoppingRows()).filter((row) => row.name === NAME_D);
  for (const row of rowsAtCreate) createdShopping.add(row.id);
  check("数量等于最低库存时就会生成待采购建议", rowsAtCreate.some((row) => row.status === "PENDING" && row.source === "low-stock"), JSON.stringify(rowsAtCreate.map((row) => ({ status: row.status, source: row.source }))));

  const consume = await call(`/api/items/${d.id}/consume`, { method: "POST" });
  const rowsAfter = (await shoppingRows()).filter((row) => row.name === NAME_D);
  for (const row of rowsAfter) createdShopping.add(row.id);
  check("消耗到最低库存以下仍有建议", rowsAfter.some((row) => row.status === "PENDING"), JSON.stringify(rowsAfter.map((row) => ({ status: row.status, source: row.source }))));

  const undoD = await call(`/api/activity/${consume.json?.activityId}/undo`, { method: "POST" });
  const rowsUndone = (await shoppingRows()).filter((row) => row.name === NAME_D);
  check("撤销后数量仍是 2(=最低库存)→ 建议保留", rowsUndone.some((row) => row.status === "PENDING"), JSON.stringify(rowsUndone.map((row) => ({ status: row.status, source: row.source }))));
  check("这一次没有撤掉任何建议", Number(undoD.json?.removedSuggestions ?? 0) === 0, JSON.stringify(undoD.json?.removedSuggestions ?? null));
}

// 二:退回之后**不再**低于最低库存(3 > 2)→ 自动生成的建议该被撤掉。
const e = await createItem({ name: NAME_D, category: "零食", type: "CONSUMABLE", unit: "件", quantity: 3, minQuantity: 2, remainingPercent: 100 });
check("造出第二件同名物品(撤销后会高于最低库存)", Boolean(e.id), `status=${e.status}`);

if (e.id) {
  const consumeE = await call(`/api/items/${e.id}/consume`, { method: "POST" });
  const made = (await shoppingRows()).filter((row) => row.name === NAME_D);
  for (const row of made) createdShopping.add(row.id);
  check("同名物品消耗到最低库存会复用/建起建议", made.some((row) => row.status === "PENDING"), JSON.stringify(made.map((row) => ({ status: row.status, source: row.source }))));
  const undoE = await call(`/api/activity/${consumeE.json?.activityId}/undo`, { method: "POST" });
  const left = (await shoppingRows()).filter((row) => row.name === NAME_D);
  check("退回到最低库存之上 → 自动生成的建议被撤掉", left.length === 0, `剩余=${JSON.stringify(left.map((row) => ({ status: row.status, source: row.source })))}`);
  check("响应里说明了撤掉几条建议", Number(undoE.json?.removedSuggestions ?? 0) >= 1, JSON.stringify(undoE.json?.removedSuggestions ?? null));
}

// ---------- 液体不能直接消耗(既有规则,守住) ----------
const f = await createItem({ name: NAME_B, category: "调料", type: "CONSUMABLE", unit: "瓶", quantity: 2, minQuantity: 0, remainingPercent: 100 });
if (f.id) {
  const res = await call(`/api/items/${f.id}/consume`, { method: "POST" });
  check("液体不能直接消耗(仍走余量刻度)", res.status === 409, `status=${res.status} ${JSON.stringify(res.json).slice(0, 80)}`);
}

// 收尾
for (const id of created) await call(`/api/items/${id}`, { method: "DELETE", body: { permanent: true } });
for (const id of createdShopping) await call(`/api/shopping/${id}`, { method: "DELETE" });
for (const row of await shoppingRows()) if (row.name.startsWith("消耗链探针")) await call(`/api/shopping/${row.id}`, { method: "DELETE" });
const leftoverItems = (await call("/api/items?includeDeleted=1")).json ?? [];
const leftoverShopping = (await shoppingRows()).filter((row) => row.name.startsWith("消耗链探针"));
check("探针物品已清理", !leftoverItems.some((row) => String(row.name).startsWith("消耗链探针")), `${leftoverItems.filter((row) => String(row.name).startsWith("消耗链探针")).length} 件还在`);
check("探针采购项已清理", leftoverShopping.length === 0, `${leftoverShopping.length} 条还在`);

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);
