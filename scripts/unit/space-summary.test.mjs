// 空间整理摘要的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { spaceSummary, spaceSummaryText, spaceAlert } from "../../src/lib/space-summary.ts";
import { locationSubtreeIds } from "../../src/lib/location-tree.ts";

const item = (patch) => ({
  // 注意用 in 判断:显式传 null 表示「没有位置」,不能用 ?? 兜底
  locationId: "locationId" in patch ? patch.locationId : "loc-1",
  type: patch.type ?? "CONSUMABLE",
  quantity: patch.quantity ?? 1,
  price: patch.price ?? null,
  expiryDate: patch.expiryDate ?? null,
  storage: patch.storage ?? null,
  minQuantity: patch.minQuantity ?? 0,
});

const NOW = new Date("2026-06-10T00:00:00Z").getTime();
const days = (offset) => new Date(NOW + offset * 86400000).toISOString();

test("只统计该空间的物品", () => {
  const summary = spaceSummary([
    item({ locationId: "loc-1" }),
    item({ locationId: "loc-2" }),
    item({ locationId: null }),
  ], "loc-1", NOW);
  assert.equal(summary.count, 1);
});

test("已用完(0 件)的物品不占卡片上的件数 —— 它在任何列表里都看不到", () => {
  // 起因(2026-11-28 探针库实测):厨房里一件物品消耗到 0 件后,空间页写「厨房 3 件」,
  // 按空间筛选点进去只有 2 件 —— 差的就是那件已从列表隐藏的(消耗提示条也这么说)。
  const summary = spaceSummary([
    item({ locationId: "loc-1", quantity: 2, price: 10 }),
    item({ locationId: "loc-1", quantity: 0, price: 10, minQuantity: 1, storage: "COLD", expiryDate: days(3) }),
  ], "loc-1", NOW);
  assert.equal(summary.count, 1);
  assert.equal(summary.consumables, 1);
  assert.equal(summary.cold, 0);
  assert.equal(summary.expiring, 0);
  assert.equal(summary.lowStock, 0);
  // 价值本来就是「数量 × 单价」,0 件那件不影响;剩下的仍是 2 × 10。
  assert.equal(summary.value, 20);
});

// 源码级守卫:空间页导轨上那个数与卡片上的数、点进去看到的件数必须是同一个数。
// 起因(2026-11-28 探针库实测):导轨与卡片都少了 `quantity > 0`,一件物品在厨房里消耗到
// 0 件后(按设计从所有列表隐藏),两处写 3 件、按空间筛选点进去只有 2 件。
// 数量过滤写在两个地方(lib 的统计范围、视图的 countIn),少一处就会出现两个数。
test("导轨计数必须与卡片、点进去的件数同口径(都按 quantity > 0)", () => {
  const source = readFileSync(new URL("../../src/components/views/locations-view.tsx", import.meta.url), "utf8");
  const countIn = source.slice(source.indexOf("const countIn ="), source.indexOf("const countIn =") + 400);
  assert.ok(countIn.includes("item.quantity > 0"), "countIn 里必须过滤掉已用完(0 件)的物品");
  assert.ok(countIn.includes("locationSubtreeIds"), "countIn 仍要含下级空间(点进去是按含下级筛的)");
});

test("传一组空间 id 时把它下面所有空间的物品都算进来(卡片上的数 = 点进去看到的数)", () => {
  // 起因(2026-11-27 实测):卡片只数「直接放在这一层」的,而点卡片进物品页是按「含下级空间」筛的。
  // 于是「厨房」卡片写 1 件、点进去 2 件;自己没物品、下级有物品的空间卡片写「还没放东西」,
  // 点进去却有东西。现在两边用同一个范围。
  const tree = [
    { id: "厨房", parentId: null },
    { id: "吊柜", parentId: "厨房" },
    { id: "上层", parentId: "吊柜" },
    { id: "客厅", parentId: null },
  ];
  const scope = [...locationSubtreeIds(tree, "厨房")];
  assert.deepEqual(scope.sort(), ["上层", "吊柜", "厨房"].sort(), "自己 + 儿子 + 孙子");

  const summary = spaceSummary([
    item({ locationId: "厨房", quantity: 6, price: 4 }),
    item({ locationId: "吊柜", quantity: 12, price: 1 }),
    item({ locationId: "上层", quantity: 1, price: 100 }),
    item({ locationId: "客厅", quantity: 3, price: 1 }),
  ], scope, NOW);
  assert.equal(summary.count, 3, "厨房这一支的 3 件都算(客厅的不算)");
  assert.equal(summary.value, 6 * 4 + 12 * 1 + 1 * 100);

  // 下级空间的「件数」仍然只算它自己这一支
  assert.equal(spaceSummary([item({ locationId: "吊柜" }), item({ locationId: "上层" })], [...locationSubtreeIds(tree, "吊柜")], NOW).count, 2);
  // 只有一个 id 的老用法不受影响
  assert.equal(spaceSummary([item({ locationId: "厨房" }), item({ locationId: "吊柜" })], "厨房", NOW).count, 1);
});

test("库里有环时求子树不会打转", () => {
  const broken = [
    { id: "a", parentId: "c" },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
  ];
  assert.deepEqual([...locationSubtreeIds(broken, "a")].sort(), ["a", "b", "c"]);
});

test("统计需冷藏(含开封后冷藏)", () => {
  const summary = spaceSummary([
    item({ storage: "COLD" }),
    item({ storage: "COLD_AFTER_OPEN" }),
    item({ storage: "ROOM" }),
  ], "loc-1", NOW);
  assert.equal(summary.cold, 2);
});

test("临期按本地自然日算,窗口外的与没有有效期的都不算", () => {
  const summary = spaceSummary([
    item({ expiryDate: days(-3) }),
    item({ expiryDate: days(2) }),
    item({ expiryDate: days(30) }),
    item({ expiryDate: null }),
  ], "loc-1", NOW);
  assert.equal(summary.expiring, 1, "只有 +2 天那件落在默认窗口(7 天)内");
  assert.equal(summary.expired, 1, "-3 天那件是已过期,不算临期");
});

test("估算价值按数量乘单价", () => {
  const summary = spaceSummary([item({ quantity: 3, price: 12.5 }), item({ quantity: 2, price: null })], "loc-1", NOW);
  assert.equal(summary.value, 37.5);
});

test("低于最低库存的消耗品单独计数,耐用品不算", () => {
  const summary = spaceSummary([
    item({ quantity: 1, minQuantity: 3 }),
    item({ quantity: 5, minQuantity: 3 }),
    item({ type: "DURABLE", quantity: 1, minQuantity: 3 }),
  ], "loc-1", NOW);
  assert.equal(summary.lowStock, 1);
});

test("摘要文案只列出有内容的项", () => {
  const summary = spaceSummary([
    item({ storage: "COLD", price: 10, quantity: 2 }),
    item({ quantity: 1, minQuantity: 2 }),
  ], "loc-1", NOW);
  const text = spaceSummaryText(summary);
  assert.match(text, /2 件/);
  assert.match(text, /1 件需冷藏/);
  assert.match(text, /1 件该补货/);
  assert.match(text, /约 ¥20/);
  assert.doesNotMatch(text, /临期/);
});

test("暂停补货中的物品不算「该补货」——空间卡与概览必须同一个答案", () => {
  // 起因:spaceSummary 当初没把 now 传给 isLowStock,而那个参数「不传就跳过暂停判定」。
  // 结果用户暂停了某件东西,概览的「低库存」少算它、空间卡上仍写着「N 件该补货」。
  const pausedItem = (until) => ({
    locationId: "loc-1", type: "CONSUMABLE", quantity: 1, minQuantity: 5, price: null,
    expiryDate: null, storage: null, name: "酱油", category: "调味", unit: "瓶",
    remainingPercent: 100, restockPausedUntil: until,
  });

  assert.equal(spaceSummary([pausedItem(null)], "loc-1", NOW).lowStock, 1, "没暂停要算");
  assert.equal(spaceSummary([pausedItem(new Date(NOW + 86400000))], "loc-1", NOW).lowStock, 0, "暂停期内不算");
  assert.equal(spaceSummary([pausedItem(new Date(NOW - 86400000))], "loc-1", NOW).lowStock, 1, "暂停期过了要恢复");

  const paused = spaceSummary([pausedItem(new Date(NOW + 86400000))], "loc-1", NOW);
  assert.doesNotMatch(spaceSummaryText(paused), /该补货/);
  assert.equal(spaceAlert(spaceSummary([pausedItem(new Date(NOW + 86400000))], "loc-1", NOW)), null, "暂停期内也不该给空间挂黄点");
});

test("临期窗口跟调用方走,已过期单独算", () => {
  // 起因:这里此前写死 7 天(且把已过期也算成「临期」),而概览/提醒中心/物品卡
  // 都用用户设置的「保质期提前 N 天」。实测同一屏:提醒中心 8 件临期、空间卡 6 件。
  const at = (offset) => ({ ...item({ expiryDate: days(offset) }), name: "酸奶", category: "食品", unit: "盒", remainingPercent: 100 });

  // 默认窗口 7 天:0..7 算临期
  assert.equal(spaceSummary([at(0), at(7), at(8)], "loc-1", NOW).expiring, 2);
  // 窗口跟参数走:14 天时 +14 也算
  assert.equal(spaceSummary([at(0), at(7), at(8), at(14), at(15)], "loc-1", NOW, 14).expiring, 4);
  assert.equal(spaceSummary([at(0), at(7), at(8), at(14), at(15)], "loc-1", NOW, 30).expiring, 5);
  // 已过期不进「临期」,单独数(不限窗口)
  const summary = spaceSummary([at(-1), at(-40), at(3), at(40)], "loc-1", NOW, 7);
  assert.equal(summary.expired, 2);
  assert.equal(summary.expiring, 1);
});

test("摘要文案把已过期与临期分开说,不再混成一句", () => {
  const at = (offset) => ({ ...item({ expiryDate: days(offset) }), name: "酸奶", category: "食品", unit: "盒", remainingPercent: 100 });
  const text = spaceSummaryText(spaceSummary([at(-2), at(1), at(2)], "loc-1", NOW));
  assert.match(text, /1 件已过期/);
  assert.match(text, /2 件临期/);
  assert.equal(spaceAlert(spaceSummary([at(-2)], "loc-1", NOW)), "danger", "已过期也要挂危险点");
  assert.equal(spaceAlert(spaceSummary([at(40)], "loc-1", NOW)), null);
});

test("空空间给明确提示,而不是一串 0", () => {
  const summary = spaceSummary([], "loc-1", NOW);
  assert.equal(spaceSummaryText(summary), "还没放东西");
  assert.equal(spaceAlert(summary), null);
});

test("有下级空间时把这件事说出来(否则同一屏上「2 件 / 1 件」像多数了一件)", () => {
  const summary = spaceSummary([item({ locationId: "loc-1" }), item({ locationId: "loc-2" })], ["loc-1", "loc-2"], NOW);
  assert.match(spaceSummaryText(summary, 1), /2 件 · 含 1 个下级空间/);
  assert.doesNotMatch(spaceSummaryText(summary), /下级空间/, "没有下级空间就不要提");
  // 自己和下级都是空的时候,也要说清「下级也是空的」,别让人以为下面还有东西
  assert.match(spaceSummaryText(spaceSummary([], "loc-1", NOW), 2), /还没放东西.*下级空间也是空的/);
});

test("状态角标:临期最严重,其次是该补货", () => {
  assert.equal(spaceAlert(spaceSummary([item({ expiryDate: days(1), quantity: 1, minQuantity: 5 })], "loc-1", NOW)), "danger");
  assert.equal(spaceAlert(spaceSummary([item({ quantity: 1, minQuantity: 5 })], "loc-1", NOW)), "warning");
  assert.equal(spaceAlert(spaceSummary([item({ quantity: 9 })], "loc-1", NOW)), null);
});