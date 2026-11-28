// 「看得见的物品」这条规则的单测:
//   npm run test:unit
//
// 守的是「已用完(0 件)的东西在界面上必须有入口」这件事的地基:
// 以前数量过滤与四项筛选条件混在一处(provider 里一句 `item.quantity > 0 && ...`),
// 于是 0 件的物品不在物品页、不在搜索、不在回收站 —— 空间删不掉、补货无从下手
// (v0.1.112 实测:卡片写「还没放东西」,删除却回「还有 1 件物品,请先移动」)。
// 现在条件抽成一处共用,数量由调用方选「还在用 / 已用完」。
import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { matchesItemFilters, pickVisibleItems } from "../../src/lib/item-visibility.ts";

const ALL = { search: "", typeFilter: "ALL", categoryFilter: "ALL", spaceScope: null };

const item = (patch = {}) => ({
  name: "物品",
  itemCode: null,
  category: "日用",
  notes: null,
  autoTags: null,
  location: null,
  type: "CONSUMABLE",
  locationId: "loc-1",
  quantity: 1,
  ...patch,
});

test("两个列表分开:还在用 / 已用完,一件都不会漏也不会重", () => {
  const items = [item({ name: "还有货", quantity: 3 }), item({ name: "用完了", quantity: 0 })];
  const live = pickVisibleItems(items, ALL, "live");
  const usedUp = pickVisibleItems(items, ALL, "usedUp");
  assert.deepEqual(live.map((row) => row.name), ["还有货"]);
  assert.deepEqual(usedUp.map((row) => row.name), ["用完了"]);
  assert.equal(live.length + usedUp.length, items.length);
});

test("负数数量也算已用完(不留在「还在用」里,也进得了「已用完」)", () => {
  const items = [item({ name: "异常负值", quantity: -2 })];
  assert.equal(pickVisibleItems(items, ALL, "live").length, 0);
  assert.deepEqual(pickVisibleItems(items, ALL, "usedUp").map((row) => row.name), ["异常负值"]);
});

test("类型与分类条件在两个列表里都算数(旧行为不变)", () => {
  const items = [
    item({ name: "耐用品", type: "DURABLE", quantity: 0 }),
    item({ name: "消耗品", type: "CONSUMABLE", quantity: 0 }),
    item({ name: "感冒灵", category: "医药·感冒发热", quantity: 0 }),
  ];
  assert.deepEqual(
    pickVisibleItems(items, { ...ALL, typeFilter: "DURABLE" }, "usedUp").map((row) => row.name),
    ["耐用品"],
  );
  assert.deepEqual(
    pickVisibleItems(items, { ...ALL, categoryFilter: "日用" }, "usedUp").map((row) => row.name),
    ["耐用品", "消耗品"],
  );
  // 「医药」不是类型也不是分类名,而是「按用途」的一组分类(与界面上的筛选项一致)
  assert.deepEqual(
    pickVisibleItems(items, { ...ALL, typeFilter: "MEDICINE" }, "usedUp").map((row) => row.name),
    ["感冒灵"],
  );
  assert.deepEqual(
    pickVisibleItems(items, { ...ALL, categoryFilter: "MEDICINE" }, "usedUp").map((row) => row.name),
    ["感冒灵"],
  );
});

test("空间范围与搜索在「已用完」里同样生效(否则点空间筛选会冒出别处的物品)", () => {
  const items = [
    item({ name: "厨房的", locationId: "厨房", quantity: 0 }),
    item({ name: "客厅的", locationId: "客厅", quantity: 0 }),
    item({ name: "笔记里提过的", locationId: "客厅", notes: "换季备用", quantity: 0 }),
  ];
  assert.deepEqual(
    pickVisibleItems(items, { ...ALL, spaceScope: new Set(["厨房"]) }, "usedUp").map((row) => row.name),
    ["厨房的"],
  );
  assert.deepEqual(
    pickVisibleItems(items, { ...ALL, search: "换季" }, "usedUp").map((row) => row.name),
    ["笔记里提过的"],
  );
  // 搜索大小写与空格不该影响结果(条件里自己会 trim/lowercase)
  assert.deepEqual(
    pickVisibleItems(items, { ...ALL, search: "  换季  " }, "usedUp").map((row) => row.name),
    ["笔记里提过的"],
  );
});

test("matchesItemFilters 只管条件,不管数量", () => {
  assert.equal(matchesItemFilters(item({ quantity: 0 }), ALL), true);
  assert.equal(matchesItemFilters(item({ quantity: 0 }), { ...ALL, search: "不存在的东西" }), false);
});

test("源码级守卫:芯片上的数必须等于点下去看到的件数", () => {
  // 2026-11-28 真机实测:初始 9 件时「需冷藏 3」;点「饮品 4」后屏幕「4 件」而芯片仍写 3,
  // 再点它只出 2 件 —— 因为它按 allItems(全屋「还在用」那份)数,而点下去是在当前筛选之上再筛。
  // 「已用完 N」是按当前筛选数的,两个并排的芯片口径必须一致:标签承诺什么,点下去就给什么。
  const source = readFileSync(new URL("../../src/components/views/items-view.tsx", import.meta.url), "utf8");
  const coldAt = source.indexOf("const coldCount = ");
  assert.ok(coldAt > 0, "没找到 coldCount");
  const coldLine = source.slice(coldAt, source.indexOf("\n", coldAt));
  assert.match(coldLine, /\bitems\.filter\(/, "「需冷藏 N」必须按当前筛选(items)数,不是全屋(allItems)");
  assert.doesNotMatch(coldLine, /allItems/, "不要再从 allItems 数 —— 那是全屋那份,点下去只在当前筛选里筛");
  const usedAt = source.indexOf("const usedUpChip = ");
  assert.ok(usedAt > 0, "没找到 usedUpChip");
  assert.match(source.slice(usedAt, usedAt + 300), /usedUpItems\.length/, "「已用完 N」按当前筛选的已用完那份数");
});
test("源码级守卫:「导出当前筛选」导的必须是屏幕上那一份", () => {
  // 2026-11-28 探针库实测:点「已用完 1」后屏幕写「1 件」,导出提示条却说「已导出 9 件物品」——
  // 因为 exportCsv 用的是 items(还在用那份),而两个芯片只作用于 shownItems。
  // 按钮自己承诺「当前筛选」,就得导屏幕上那份;这条守卫挡住以后又接回 items。
  const source = readFileSync(new URL("../../src/components/views/items-view.tsx", import.meta.url), "utf8");
  const at = source.indexOf("const exportCsv = () => {");
  assert.ok(at > 0, "没找到 exportCsv");
  const body = source.slice(at, at + 3000);
  assert.match(body, /shownItems\.map\(/, "导出的行必须来自 shownItems(含「需冷藏 / 已用完」这些芯片的筛选)");
  assert.doesNotMatch(body, /\bitems\.map\(/, "不要再从 items 取行 —— 那是「还在用」那份,与屏幕上的可能不是一个集合");
  assert.match(body, /shownItems\.length/, "提示条说的件数也要与导出的行同源");
});
