// 纯函数单元测试:node:test 内置,零依赖。
//   node --test scripts/unit/
// 覆盖最容易在改动中被悄悄改坏的判定逻辑:数量归一化、补货、日均成本、
// 液体判定、到期天数、药品分类、类型识别。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  usageDays, dailyUsageCost, isLiquidConsumable, estimatedUseDays,
  isCountUnit, normalizeItemQuantity, needsRestock, restockQuantity,
  scanConsumeBlocker, SCAN_CONSUME_BLOCKER_MESSAGE,
} from "../../src/lib/item-metrics.ts";
import { isMedicineCategory, medicineCategoryLabel, suggestMedicineCategory, MEDICINE_CATEGORIES } from "../../src/lib/categories.ts";
import { LIQUID_LOW_PERCENT } from "../../src/lib/restock-limits.ts";
import { guessItemType } from "../../src/lib/item-type-guess.ts";

const NOW = new Date("2026-11-17T12:00:00+08:00");
const consumable = { type: "CONSUMABLE", name: "洗衣液", category: "清洁", unit: "瓶" };
const durable = { type: "DURABLE", name: "电钻", category: "家电", unit: "台" };

// ---------------------------------------------------------------- 数量归一化
test("计数单位:小数会被四舍五入到整数", () => {
  for (const unit of ["件", "个", "盒", "瓶", "袋", "卷", "包", "台"]) {
    assert.equal(isCountUnit(unit), true, `${unit} 应该是计数单位`);
    assert.equal(normalizeItemQuantity(2.5, unit), 3);
    assert.equal(normalizeItemQuantity(2.4, unit), 2);
  }
});

test("计数单位:负数被夹到 0", () => {
  assert.equal(normalizeItemQuantity(-5, "件"), 0);
});

test("计量单位(kg/L/ml)保留小数", () => {
  for (const unit of ["kg", "L", "ml"]) {
    assert.equal(isCountUnit(unit), false, `${unit} 不应是计数单位`);
    assert.equal(normalizeItemQuantity(2.5, unit), 2.5);
    assert.equal(normalizeItemQuantity(0.001, unit), 0.001);
  }
});

// ---------------------------------------------------------------- 补货判定
test("消耗品低于阈值需要补货", () => {
  assert.equal(needsRestock({ ...consumable, unit: "件", quantity: 1, minQuantity: 5, remainingPercent: 100 }), true);
});

test("消耗品高于阈值不需要补货", () => {
  assert.equal(needsRestock({ ...consumable, unit: "件", quantity: 10, minQuantity: 5, remainingPercent: 100 }), false);
});

test("阈值设为 0 时不触发数量补货", () => {
  assert.equal(needsRestock({ ...consumable, unit: "件", quantity: 0, minQuantity: 0, remainingPercent: 100 }), false);
});

test("耐用品永远不补货", () => {
  assert.equal(needsRestock({ ...durable, quantity: 0, minQuantity: 5, remainingPercent: 0 }), false);
});

test("液体的剩余量 ≤ LIQUID_LOW_PERCENT 触发补货", () => {
  // 阈值写成常量而不是字面量 20:这条线此前在服务端和客户端各抄了一份,
  // 改了其中一处就会变成「角标说该补货、服务端不生成采购项」。
  assert.equal(needsRestock({ ...consumable, quantity: 10, minQuantity: 0, remainingPercent: LIQUID_LOW_PERCENT }), true);
  assert.equal(needsRestock({ ...consumable, quantity: 10, minQuantity: 0, remainingPercent: LIQUID_LOW_PERCENT + 1 }), false);
});

test("补货数量至少为 1,即使缺口为负", () => {
  assert.equal(restockQuantity({ quantity: 1, minQuantity: 5 }), 4);
  assert.equal(restockQuantity({ quantity: 10, minQuantity: 5 }), 1);
});

// ---------------------------------------------------------------- 液体判定
test("清洁/饮品分类按液体处理", () => {
  assert.equal(isLiquidConsumable({ ...consumable, category: "清洁", unit: "件" }), true);
  assert.equal(isLiquidConsumable({ ...consumable, category: "饮品", unit: "件" }), true);
});

test("瓶 / L / ml 单位按液体处理", () => {
  assert.equal(isLiquidConsumable({ ...consumable, category: "其他", unit: "L" }), true);
  assert.equal(isLiquidConsumable({ ...consumable, category: "其他", unit: "ml" }), true);
});

test("名称命中关键词按液体处理", () => {
  for (const name of ["洗发水", "牛奶", "酱油", "色拉油", "沐浴露"]) {
    assert.equal(isLiquidConsumable({ ...consumable, name, category: "其他", unit: "件" }), true, name);
  }
});

test("耐用品永远不是液体", () => {
  assert.equal(isLiquidConsumable({ ...durable, name: "牛奶杯", category: "饮品", unit: "瓶" }), false);
});

test("液体不参与剩余天数估算", () => {
  assert.equal(estimatedUseDays({ ...consumable, quantity: 3, consumeRate: 1 }), null);
});

// ---------------------------------------------------------------- 扫码页能不能按件消耗
// 这个页面只会「减 1 件」,所以判定必须和它实际能做的事一致。
// 实测(2026-11-27,v0.1.101):耐用品没有走这条判定,于是扫码页照发一个必然 409 的请求。
test("耐用品不能走扫码按件消耗(界面此前漏了这一档)", () => {
  assert.equal(scanConsumeBlocker({ ...durable, name: "螺丝刀", category: "工具", unit: "个" }), "durable");
  assert.equal(SCAN_CONSUME_BLOCKER_MESSAGE.durable, "耐用品不能通过扫码消耗", "文案要与接口 409 里的原话一致");
});

test("液体也不能走扫码按件消耗,但给的是余量刻度那句话", () => {
  assert.equal(scanConsumeBlocker({ ...consumable, name: "洗衣液", category: "清洁", unit: "瓶" }), "liquid");
  assert.match(SCAN_CONSUME_BLOCKER_MESSAGE.liquid, /余量刻度/);
  assert.notEqual(SCAN_CONSUME_BLOCKER_MESSAGE.liquid, SCAN_CONSUME_BLOCKER_MESSAGE.durable, "两种原因两句话,不能合并成一句通用提示");
});

test("能按件消耗的消耗品不受影响", () => {
  assert.equal(scanConsumeBlocker({ ...consumable, name: "抽纸", category: "日用", unit: "包" }), null);
});

// ---------------------------------------------------------------- 使用天数 / 日均成本
test("使用天数按自然日计算,起点算 1 天", () => {
  assert.equal(usageDays("2026-11-17", NOW), 1);
  assert.equal(usageDays("2026-11-16", NOW), 2);
  assert.equal(usageDays("2026-10-19", NOW), 30);
});

test("没有购入日期或日期在未来时返回 null", () => {
  assert.equal(usageDays(null, NOW), null);
  assert.equal(usageDays("2026-12-01", NOW), null);
  assert.equal(usageDays("不是日期", NOW), null);
});

test("只有耐用品且填了价格才算日均成本", () => {
  assert.equal(dailyUsageCost({ type: "CONSUMABLE", price: 100, purchaseDate: "2026-11-01" }, NOW), null);
  assert.equal(dailyUsageCost({ type: "DURABLE", price: null, purchaseDate: "2026-11-01" }, NOW), null);
  const result = dailyUsageCost({ type: "DURABLE", price: 300, purchaseDate: "2026-11-07" }, NOW);
  assert.ok(result);
  assert.equal(result.days, 11);
  assert.equal(Math.round(result.cost * 100) / 100, 27.27);
});

test("消耗品按消耗速度估算可用天数", () => {
  assert.equal(estimatedUseDays({ ...consumable, unit: "件", name: "纸巾", category: "日用", quantity: 10, consumeRate: 1 }), 10);
  assert.equal(estimatedUseDays({ ...consumable, unit: "件", name: "纸巾", category: "日用", quantity: 1, consumeRate: 3 }), 1);
  assert.equal(estimatedUseDays({ ...consumable, unit: "件", name: "纸巾", category: "日用", quantity: 0, consumeRate: 1 }), null);
  assert.equal(estimatedUseDays({ ...consumable, unit: "件", name: "纸巾", category: "日用", quantity: 10, consumeRate: 0.05 }), null);
});

// ---------------------------------------------------------------- 药品分类
test("药品分类识别", () => {
  assert.equal(MEDICINE_CATEGORIES.length > 0, true);
  for (const category of MEDICINE_CATEGORIES) {
    assert.equal(isMedicineCategory(category), true, category);
    assert.equal(medicineCategoryLabel(category).length > 0, true, category);
  }
  assert.equal(isMedicineCategory("家电"), false);
  assert.equal(isMedicineCategory(null), false);
  assert.equal(isMedicineCategory(undefined), false);
});

test("按名称建议药品子分类", () => {
  const result = suggestMedicineCategory("布洛芬缓释胶囊");
  assert.equal(MEDICINE_CATEGORIES.includes(result), true, `返回了 ${result}`);
});

// ---------------------------------------------------------------- 类型识别
test("识别消耗品并给依据", () => {
  const guess = guessItemType({ name: "洗衣液 2L", category: "清洁", unit: "瓶" });
  assert.equal(guess.type, "CONSUMABLE");
  assert.equal(guess.reason.length > 0, true);
});

test("识别耐用品并给依据", () => {
  const guess = guessItemType({ name: "电钻", category: "家电", unit: "台" });
  assert.equal(guess.type, "DURABLE");
  assert.equal(guess.reason.length > 0, true);
});

test("没有把握时返回 null,由界面决定不提示", () => {
  // 契约是「不确定就不猜」:界面靠 null 决定不显示识别提示。
  assert.equal(guessItemType({ name: "儿童绘本" }), null);
});

test("依据字段在命中时非空、未命中时为空", () => {
  const matched = guessItemType({ name: "洗衣液", category: "清洁", unit: "瓶" });
  assert.ok(matched);
  assert.equal(typeof matched.matched, "string");
  assert.equal(matched.matched.length > 0, true);
});
