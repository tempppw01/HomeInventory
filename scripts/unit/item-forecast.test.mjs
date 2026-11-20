// 后台补货预测与重复物品建议的单元测试:
//   npm run test:unit
// 这两个能力都是「后台自动跑」的:不需要点击,也不依赖 AI Key。
import { test } from "node:test";
import assert from "node:assert/strict";

import { daysLeftFor, restockForecast, normalizeItemName, duplicateGroups, learnConsumeRate, FORECAST_LABEL } from "../../src/lib/item-forecast.ts";

const item = (patch) => ({
  id: patch.id ?? "x",
  name: patch.name ?? "物品",
  category: patch.category ?? "日用",
  type: patch.type ?? "CONSUMABLE",
  unit: patch.unit ?? "件",
  quantity: patch.quantity ?? 10,
  remainingPercent: patch.remainingPercent ?? 100,
  consumeRate: patch.consumeRate ?? null,
  expiryDate: patch.expiryDate ?? null,
  restockPausedUntil: patch.restockPausedUntil ?? null,
});

test("按数量与日均消耗估算天数", () => {
  assert.equal(daysLeftFor(item({ type: "CONSUMABLE", unit: "包", quantity: 10, consumeRate: 2 })), 5);
  assert.equal(daysLeftFor(item({ type: "CONSUMABLE", unit: "包", quantity: 1, consumeRate: 5 })), 1);
});

test("耐用品不参与补货预测", () => {
  assert.equal(daysLeftFor(item({ type: "DURABLE", unit: "台", quantity: 1, consumeRate: 3 })), null);
});

test("没有消耗速度时不给结论", () => {
  assert.equal(daysLeftFor(item({ quantity: 10, consumeRate: null })), null);
  assert.equal(daysLeftFor(item({ quantity: 10, consumeRate: 0.01 })), null);
});

test("液体按剩余量百分比估算", () => {
  // 2 瓶、剩 50% → 等效 1 瓶;日均 0.5 瓶 → 2 天
  const liquid = item({ name: "洗洁精", category: "清洁", unit: "瓶", quantity: 2, remainingPercent: 50, consumeRate: 0.5 });
  assert.equal(daysLeftFor(liquid), 2);
});

test("数量为 0 时立刻算用完了", () => {
  assert.equal(daysLeftFor(item({ quantity: 0, consumeRate: 1 })), 0);
});

test("只挑出 7 天内会用完的,并按紧迫度排序", () => {
  const rows = restockForecast([
    item({ id: "a", name: "牙膏", unit: "支", quantity: 3, consumeRate: 1 }),   // 3 天
    item({ id: "b", name: "纸巾", unit: "包", quantity: 20, consumeRate: 1 }),  // 20 天,排除
    item({ id: "c", name: "垃圾袋", unit: "卷", quantity: 1, consumeRate: 1 }),  // 1 天
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["c", "a"]);
  assert.ok(rows[0].daysLeft <= rows[1].daysLeft);
  assert.match(rows[0].reason, /还能用 1 天/);
});

test("暂停补货的物品不出现在预测里", () => {
  const paused = new Date(Date.now() + 86400000).toISOString();
  const rows = restockForecast([item({ id: "p", quantity: 1, consumeRate: 1, restockPausedUntil: paused })]);
  assert.deepEqual(rows, []);
});

test("名称归一化能忽略规格与括号", () => {
  assert.equal(normalizeItemName("洗洁精（柠檬味）"), "洗洁精");
  assert.equal(normalizeItemName("洗发水 500ml"), "洗发水");
  assert.equal(normalizeItemName("抽纸 3 包"), "抽纸");
  assert.equal(normalizeItemName("A-B_C"), "abc");
});

test("同名物品归为重复组,建议保留数量多的", () => {
  const groups = duplicateGroups([
    item({ id: "one", name: "洗洁精", quantity: 1 }),
    item({ id: "two", name: "洗洁精(柠檬)", quantity: 3 }),
    item({ id: "three", name: "电钻", type: "DURABLE", quantity: 1 }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].keepId, "two");
});

// 包含关系也要算重复(注释里承诺过「洗洁精」与「洗洁精柠檬」这种情形;
// 带括号的名字靠归一化就能对上,不带括号的必须靠这条规则)。
test("一方名字包含另一方时也算疑似重复", () => {
  const groups = duplicateGroups([
    item({ id: "one", name: "洗洁精", quantity: 1 }),
    item({ id: "two", name: "洗洁精柠檬", quantity: 2 }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].keepId, "two");
});

test("过短的名字不参与包含匹配(避免「盐」把一堆东西拉进同一组)", () => {
  const groups = duplicateGroups([
    item({ id: "one", name: "盐" }),
    item({ id: "two", name: "盐焗坚果" }),
  ]);
  assert.deepEqual(groups, []);
});

test("名字不同不会误判为重复", () => {
  const groups = duplicateGroups([
    item({ id: "one", name: "洗洁精" }),
    item({ id: "two", name: "洗衣液" }),
  ]);
  assert.deepEqual(groups, []);
});

test("少于两次事件不学习消耗速度", () => {
  const now = Date.now();
  assert.equal(learnConsumeRate([{ at: now, units: 2 }], now), null);
  assert.equal(learnConsumeRate([], now), null);
});

test("按事件跨度学习日均消耗", () => {
  const now = Date.now();
  const day = 86400000;
  // 10 天内用掉 10 个单位 → 约 1/天
  const events = [0, 3, 6, 10].map((offset) => ({ at: now - offset * day, units: 2.5 }));
  const rate = learnConsumeRate(events, now);
  assert.ok(rate > 0.8 && rate < 1.3, );
});

test("窗口外的旧事件不计入", () => {
  const now = Date.now();
  const day = 86400000;
  const rate = learnConsumeRate([{ at: now - 60 * day, units: 10 }, { at: now - 2 * day, units: 1 }], now);
  assert.equal(rate, null);
});

test("空名单不报错", () => {
  assert.deepEqual(duplicateGroups([]), []);
  assert.deepEqual(restockForecast([]), []);
  assert.ok(FORECAST_LABEL.urgent.length > 0);
});