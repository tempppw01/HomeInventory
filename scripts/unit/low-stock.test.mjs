// 「该补货」统一判定的单测。
//
// 抽这个 helper 的原因:同一个概念此前有三套实现(列表角标 / 概览提醒 / 空间摘要与月报),
// 于是液体见底时列表说该补货、空间摘要却说「0 件该补货」。
// 这里把规则钉死,四处共用。

import { test } from "node:test";
import assert from "node:assert/strict";

import { isLowStock, LIQUID_LOW_PERCENT } from "../../src/lib/low-stock.ts";
import { needsRestock } from "../../src/lib/item-metrics.ts";

const base = {
  name: "洗衣液",
  category: "清洁",
  type: "CONSUMABLE",
  unit: "瓶",
  quantity: 3,
  minQuantity: 0,
  remainingPercent: 100,
  restockPausedUntil: null,
};

test("数量低于最小库存 → 该补货", () => {
  assert.equal(isLowStock({ ...base, quantity: 2, minQuantity: 2 }), true);
  assert.equal(isLowStock({ ...base, quantity: 1, minQuantity: 2 }), true);
});

test("数量高于最小库存 → 不该补货", () => {
  assert.equal(isLowStock({ ...base, quantity: 5, minQuantity: 2 }), false);
});

test("没设最小库存时,不看数量", () => {
  assert.equal(isLowStock({ ...base, quantity: 0, minQuantity: 0 }), false);
});

test("液体余量见底也算该补货(此前只有列表角标算)", () => {
  assert.equal(isLowStock({ ...base, remainingPercent: LIQUID_LOW_PERCENT }), true);
  assert.equal(isLowStock({ ...base, remainingPercent: 5 }), true);
  assert.equal(isLowStock({ ...base, remainingPercent: 80 }), false);
});

test("非液体不看余量", () => {
  // 注意:应用的液体判定把「清洁」分类也算液体(洗洁精这类),
  // 所以这里用「日用 + 盒」这种确实不属于液体的组合。
  assert.equal(isLowStock({ ...base, name: "一次性手套", category: "日用", unit: "盒", remainingPercent: 5 }), false);
});

test("「清洁」分类按液体对待(洗洁精这类要按余量提醒)", () => {
  assert.equal(isLowStock({ ...base, name: "洗洁精", category: "清洁", unit: "瓶", remainingPercent: 10 }), true);
});

test("耐用品不算该补货", () => {
  assert.equal(isLowStock({ ...base, type: "DURABLE", quantity: 1, minQuantity: 5 }), false);
});

test("已经用完(数量 0)不算「该补货」——那是另一件事", () => {
  assert.equal(isLowStock({ ...base, quantity: 0, minQuantity: 0, remainingPercent: 0 }), false);
});

test("暂停补货期内不再提醒,过期后恢复", () => {
  const now = new Date(2026, 10, 20, 12, 0, 0).getTime();
  const item = { ...base, quantity: 1, minQuantity: 2 };

  assert.equal(isLowStock({ ...item, restockPausedUntil: new Date(now + 86400000) }, now), false);
  assert.equal(isLowStock({ ...item, restockPausedUntil: new Date(now - 86400000) }, now), true);
  assert.equal(isLowStock({ ...item, restockPausedUntil: new Date(now - 86400000) }), true);
});

test("不传 now 时按当前时间判断 —— 暂停期内就不提醒", () => {
  // 这条断言此前是反的(「不传 now 时忽略暂停设置(纯展示场景)」),也正是缺陷的来源:
  // 物品卡角标、空间摘要、月报这三个只做展示的调用点都没传 now,
  // 于是用户暂停了某件东西,概览的「低库存」少了它、同一张卡片上却还挂着「需补货」。
  // 暂停的语义是「这件东西别再跟我说」,不该因为调用点忘了传参就失效。
  const item = { ...base, quantity: 1, minQuantity: 2 };
  const future = new Date(Date.now() + 86400000);
  const past = new Date(Date.now() - 86400000);

  assert.equal(isLowStock({ ...item, restockPausedUntil: future }), false, "暂停期内不该说该补货");
  assert.equal(isLowStock({ ...item, restockPausedUntil: past }), true, "暂停期过了要恢复提醒");
  assert.equal(isLowStock({ ...item, restockPausedUntil: null }), true);
});

test("客户端角标与服务端生成采购建议共用同一条液体线", () => {
  const liquid = { ...base, quantity: 5, minQuantity: 0 };
  const now = new Date(2026, 10, 20, 12, 0, 0).getTime();

  for (const percent of [LIQUID_LOW_PERCENT, LIQUID_LOW_PERCENT + 1]) {
    assert.equal(
      isLowStock({ ...liquid, remainingPercent: percent }, now),
      needsRestock({ ...liquid, remainingPercent: percent }, now),
      `余量 ${percent}% 时两边结论不一致`,
    );
  }
});

test("服务端「数量 0 也要买」与客户端「角标不重复提示」是有意不同", () => {
  const empty = { ...base, quantity: 0, minQuantity: 2, remainingPercent: 100 };
  assert.equal(isLowStock(empty), false, "角标:已经用完的东西不用再挂「需补货」");
  assert.equal(needsRestock(empty), true, "采购建议:用完了正是该买的时候");
});
