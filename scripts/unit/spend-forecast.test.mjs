// 支出预测规则的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { monthlySpendFor, spendForecast, spendSummary } from "../../src/lib/spend-forecast.ts";

// 与 src/lib/item-forecast.ts 的 daysLeftFor 同口径:液体按余量折算,其余按数量。
function daysLeftFor(item) {
  if (item.type !== "CONSUMABLE") return null;
  if (item.quantity <= 0) return 0;
  const rate = item.consumeRate ?? 0;
  if (rate < 0.1) return null;
  const isLiquid = ["饮品", "清洁"].includes(item.category) || ["瓶", "L", "ml"].includes(item.unit) || /水|奶|饮料|酒|油|液|露|乳|汁|酱/.test(item.name);
  const effective = isLiquid ? item.quantity * (Math.max(0, Math.min(100, item.remainingPercent)) / 100) : item.quantity;
  if (effective <= 0) return 0;
  return Math.max(1, Math.ceil(effective / rate));
}

const item = (patch) => ({
  id: patch.id ?? "x",
  name: patch.name ?? "物品",
  category: patch.category ?? "日用",
  type: patch.type ?? "CONSUMABLE",
  unit: patch.unit ?? "包",
  quantity: patch.quantity ?? 10,
  remainingPercent: patch.remainingPercent ?? 100,
  consumeRate: patch.consumeRate ?? null,
  expiryDate: patch.expiryDate ?? null,
  restockPausedUntil: patch.restockPausedUntil ?? null,
  price: patch.price ?? null,
  minQuantity: patch.minQuantity ?? 0,
});

test("月均支出 = 日均消耗 × 30 × 单价", () => {
  // 每天 1 包、每包 20 元 → 每月 600
  assert.equal(monthlySpendFor(item({ consumeRate: 1, price: 20 })), 600);
});

test("没有消耗速度或没有单价就算不出来", () => {
  assert.equal(monthlySpendFor(item({ consumeRate: null, price: 20 })), null);
  assert.equal(monthlySpendFor(item({ consumeRate: 1, price: null })), null);
  assert.equal(monthlySpendFor(item({ consumeRate: 1, price: 0 })), null);
});

test("耐用品不计入支出预测", () => {
  assert.equal(monthlySpendFor(item({ type: "DURABLE", consumeRate: 1, price: 500 })), null);
});

test("液体按剩余量折算(与补货预测同一口径)", () => {
  // 2 瓶、剩 50% → 等效 1 瓶;日均 0.5 瓶、每瓶 30 元 → 每月 0.5*30*30 = 450
  const liquid = item({ name: "洗洁精", category: "清洁", unit: "瓶", quantity: 2, remainingPercent: 50, consumeRate: 0.5, price: 30 });
  assert.equal(monthlySpendFor(liquid), 450);
});

test("汇总多项并给出最近该买的", () => {
  const forecast = spendForecast([
    item({ id: "a", name: "抽纸", consumeRate: 1, price: 20, quantity: 3 }),          // 600/月,3 天用完
    item({ id: "b", name: "洗衣液", unit: "瓶", consumeRate: 0.2, price: 40, quantity: 2 }), // 240/月,10 天
    item({ id: "c", name: "电钻", type: "DURABLE", price: 300 }),
  ], daysLeftFor);
  assert.equal(Math.round(forecast.monthlyTotal), 840);
  assert.equal(forecast.countedItems, 2);
  assert.deepEqual(forecast.nextPurchases.map((row) => row.id), ["a", "b"]);
  assert.equal(forecast.nextPurchases[0].daysLeft, 3);
});

test("有消耗速度但缺单价的物品单独计数", () => {
  const forecast = spendForecast([item({ id: "a", consumeRate: 1, price: null })], daysLeftFor);
  assert.equal(forecast.monthlyTotal, 0);
  assert.equal(forecast.missingPrice, 1);
});

test("预计花费按「一次买的量」估算:优先最低库存,否则按 30 天用量", () => {
  const withMin = spendForecast([item({ id: "a", name: "抽纸", consumeRate: 1, price: 20, quantity: 2, minQuantity: 5 })], daysLeftFor);
  assert.equal(withMin.nextPurchases[0].estimatedCost, 100);
  const withoutMin = spendForecast([item({ id: "b", name: "抽纸", consumeRate: 1, price: 20, quantity: 2, minQuantity: 0 })], daysLeftFor);
  assert.equal(withoutMin.nextPurchases[0].estimatedCost, 600);
});

test("没有可算数据时摘要为 null", () => {
  assert.equal(spendSummary(spendForecast([item({ type: "DURABLE", price: 100 })], daysLeftFor)), null);
});

test("摘要包含月支出与最近要买的", () => {
  const text = spendSummary(spendForecast([item({ id: "a", name: "抽纸", consumeRate: 1, price: 20, quantity: 3 })], daysLeftFor));
  assert.match(text, /每月约 ¥600/);
  assert.match(text, /抽纸/);
});

test("暂停补货的物品不进入「最近该买」", () => {
  const paused = new Date(Date.now() + 86400000).toISOString();
  const forecast = spendForecast([item({ id: "a", consumeRate: 1, price: 20, quantity: 2, restockPausedUntil: paused })], daysLeftFor);
  assert.deepEqual(forecast.nextPurchases, []);
});