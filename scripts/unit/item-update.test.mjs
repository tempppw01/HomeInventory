// 「一次编辑要连带做什么」的单测:单条编辑与批量编辑现在共用这一份。
//   npm run test:unit
//
// 由来(实测,修之前两条路径各写各的):
//   · 改成「耐用品」:单条清掉到期日,批量留着 → 那件东西还会出现在到期提醒里;
//   · 余量 80% → 20%:单条补一条消耗流水并重算日均消耗,批量什么都不记;
//   · 改分类:单条重算存放建议与自动标签,批量不重算 → 标签停在旧值。

import { test } from "node:test";
import assert from "node:assert/strict";

import { planItemUpdate } from "../../src/lib/item-update.ts";

const existing = (over = {}) => ({ name: "测试物品", category: "饮品", type: "CONSUMABLE", unit: "瓶", quantity: 4, remainingPercent: 80, ...over });

test("改成耐用品:到期日必须被清掉(界面上没有给耐用品填保质期的入口)", () => {
  const plan = planItemUpdate(existing(), { type: "DURABLE" });
  assert.equal(plan.data.expiryDate, null);
  assert.equal(plan.data.type, "DURABLE");
});

test("改成消耗品:不动到期日", () => {
  const plan = planItemUpdate(existing({ type: "DURABLE" }), { type: "CONSUMABLE" });
  assert.equal("expiryDate" in plan.data, false);
});

test("数量按各自的单位归一化:计数单位取整,计量单位保留小数", () => {
  const counted = planItemUpdate(existing({ unit: "件" }), { quantity: 2.5 });
  assert.equal(counted.data.quantity, 3);
  const measured = planItemUpdate(existing({ unit: "kg" }), { quantity: 2.5 });
  assert.equal(measured.data.quantity, 2.5);
});

test("余量下降够多:要记一次消耗(带前后值与等效用量)", () => {
  const plan = planItemUpdate(existing({ remainingPercent: 80, quantity: 4 }), { remainingPercent: 20 });
  assert.deepEqual(plan.consume, { percentBefore: 80, percentAfter: 20, equivalent: 2.4 });
});

test("余量只掉一点点 / 反而上升:都不该记成消耗", () => {
  assert.equal(planItemUpdate(existing({ remainingPercent: 80, quantity: 4 }), { remainingPercent: 79 }).consume, null);
  assert.equal(planItemUpdate(existing({ remainingPercent: 80, quantity: 4 }), { remainingPercent: 100 }).consume, null);
  // 数量为 0 时余量下降也没有实际用量
  assert.equal(planItemUpdate(existing({ remainingPercent: 80, quantity: 0 }), { remainingPercent: 20 }).consume, null);
});

test("存放建议与自动标签每次都重算(改类型/分类都要跟上)", () => {
  const toDurable = planItemUpdate(existing(), { type: "DURABLE" });
  assert.match(String(toDurable.data.autoTags), /耐用品/);
  assert.equal(typeof toDurable.data.storage, "string");
  assert.equal(typeof toDurable.data.storageReason, "string");

  const toFood = planItemUpdate(existing(), { category: "食品" });
  assert.equal(String(toFood.data.autoTags).includes("饮料"), false);
  assert.match(String(toFood.data.autoTags), /消耗品/);
});

test("没有提到的字段不会被凭空写进去", () => {
  const plan = planItemUpdate(existing(), { minQuantity: 2 });
  assert.equal("name" in plan.data, false);
  assert.equal("quantity" in plan.data, false);
  assert.equal(plan.data.minQuantity, 2);
  // 但洞察三件套一定在(否则批量改分类后标签还是旧值)
  assert.ok("storage" in plan.data && "storageReason" in plan.data && "autoTags" in plan.data);
});