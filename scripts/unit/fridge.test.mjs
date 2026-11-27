// 冰箱清单规则的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { fridgePlan, fridgeSummary, looksLikeFridge } from "../../src/lib/fridge.ts";

const item = (patch) => ({
  id: patch.id ?? "x",
  name: patch.name ?? "物品",
  unit: patch.unit ?? "盒",
  quantity: patch.quantity ?? 1,
  storage: patch.storage ?? null,
  locationName: patch.locationName ?? null,
});

test("位置名像冰箱的判定", () => {
  for (const name of ["冰箱", "冷藏层", "冷冻室", "小冷柜", "冰柜上层", "保鲜抽屉"]) {
    assert.equal(looksLikeFridge(name), true, name);
  }
  for (const name of ["厨房", "阳台柜", "未设置", null]) {
    assert.equal(looksLikeFridge(name), false, String(name));
  }
});

test("需冷藏但没设位置的物品挑进待处理", () => {
  const plan = fridgePlan([
    item({ id: "a", name: "酸奶", storage: "COLD", locationName: null }),
    item({ id: "b", name: "鲜奶", storage: "COLD", locationName: "厨房" }),
    item({ id: "c", name: "鸡蛋", storage: "COLD", locationName: "冰箱上层" }),
  ]);
  assert.deepEqual(plan.unplaced.map((row) => row.id), ["a", "b"]);
  assert.deepEqual(plan.placed.map((row) => row.id), ["c"]);
  assert.equal(plan.total, 3);
});

test("常温物品不进入冰箱清单", () => {
  const plan = fridgePlan([
    item({ id: "a", name: "可乐", storage: "ROOM" }),
    item({ id: "b", name: "纸巾", storage: null }),
  ]);
  assert.equal(plan.total, 0);
  assert.equal(fridgeSummary(plan), null);
});

test("开封后冷藏只做提醒,不算进「没放好」", () => {
  const plan = fridgePlan([item({ id: "a", name: "酱油", storage: "COLD_AFTER_OPEN" })]);
  assert.equal(plan.unplaced.length, 0);
  assert.equal(plan.afterOpen.length, 1);
  assert.equal(plan.total, 1);
});

test("摘要文案随状态变化", () => {
  const partially = fridgePlan([
    item({ id: "a", name: "酸奶", storage: "COLD" }),
    item({ id: "b", name: "牛奶", storage: "COLD", locationName: "冰箱" }),
  ]);
  assert.match(fridgeSummary(partially), /该冷藏 2 件,1 件还没放好/);

  const allPlaced = fridgePlan([item({ id: "c", name: "鸡蛋", storage: "COLD", locationName: "冷藏层" })]);
  assert.equal(fridgeSummary(allPlaced), "1 件已放好");
});

test("已经用完的冷藏品不再提醒放回去", () => {
  // 起因(2026-11-27 实测):月报会念一件数量为 0 的冷藏品「还没放好」,
  // 而概览与物品列表都按「用完即退出提醒」处理 —— 一件吃完的东西没法再放回冰箱。
  const plan = fridgePlan([
    item({ id: "a", name: "喝完的鲜奶", storage: "COLD", quantity: 0 }),
    item({ id: "b", name: "鸡蛋", storage: "COLD", locationName: "冷藏层" }),
    item({ id: "c", name: "开封后冷藏的果酱", storage: "COLD_AFTER_OPEN", quantity: 0 }),
  ]);
  assert.deepEqual(plan.unplaced, []);
  assert.equal(plan.total, 1);
  assert.equal(fridgeSummary(plan), "1 件已放好");
});

test("开封后冷藏既算进摘要件数,也由 afterOpen 交出来给界面显示", () => {
  // 摘要里的「该冷藏 N 件」把 afterOpen 算进去了,而界面此前只渲染 unplaced 与 placed,
  // 于是实测出现「该冷藏 4 件」但页面上只有 3 行 —— 契约:afterOpen 必须交出去。
  const plan = fridgePlan([
    item({ id: "a", name: "鲜奶", storage: "COLD" }),
    item({ id: "b", name: "酱油", storage: "COLD_AFTER_OPEN" }),
  ]);
  assert.equal(plan.total, 2);
  assert.deepEqual(plan.afterOpen.map((row) => row.id), ["b"]);
  assert.match(fridgeSummary(plan), /该冷藏 2 件,1 件还没放好/);
});

test("空库不报错", () => {
  const plan = fridgePlan([]);
  assert.deepEqual({ total: plan.total, unplaced: plan.unplaced.length, placed: plan.placed.length }, { total: 0, unplaced: 0, placed: 0 });
});