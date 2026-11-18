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

test("空库不报错", () => {
  const plan = fridgePlan([]);
  assert.deepEqual({ total: plan.total, unplaced: plan.unplaced.length, placed: plan.placed.length }, { total: 0, unplaced: 0, placed: 0 });
});