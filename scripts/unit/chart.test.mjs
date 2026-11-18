// 图表计算的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { niceMax, ticksFor, barLayout, pointLayout, sharesOf, formatCompact, monthlyBuckets, monthOverMonth } from "../../src/lib/chart.ts";

test("坐标上限取 1/2/5 × 10^n", () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(1), 1);
  assert.equal(niceMax(1.2), 2);
  assert.equal(niceMax(3), 5);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(120), 200);
  assert.equal(niceMax(950), 1000);
  assert.equal(niceMax(-5), 1);
});

test("刻度从 0 到上限均分", () => {
  assert.deepEqual(ticksFor(100, 4), [0, 25, 50, 75, 100]);
  assert.deepEqual(ticksFor(3, 2), [0, 2.5, 5]);
});

test("柱状布局:宽度均分、有最小高度、y 从底部往上", () => {
  const rects = barLayout([10, 0, 5], 300, 100);
  assert.equal(rects.length, 3);
  assert.ok(rects[0].y < rects[2].y, "值大的柱子应该更高(y 更小)");
  assert.equal(rects[1].height, 0, "值为 0 不画柱子");
  assert.ok(rects[2].height >= 1.5, "有值就有最小高度");
  assert.ok(rects[0].x < rects[1].x && rects[1].x < rects[2].x);
});

test("柱状布局对空输入与零尺寸安全", () => {
  assert.deepEqual(barLayout([], 100, 100), []);
  assert.deepEqual(barLayout([1, 2], 0, 100), []);
  assert.deepEqual(barLayout([1, 2], 100, 0), []);
});

test("折线点:单点居中不除零", () => {
  const points = pointLayout([5], 100, 50);
  assert.equal(points.length, 1);
  assert.equal(points[0].x, 0);
  assert.ok(Number.isFinite(points[0].y));
});

test("占比:总和为 0 时不产生 NaN", () => {
  assert.deepEqual(sharesOf([1, 1, 2]), [0.25, 0.25, 0.5]);
  assert.deepEqual(sharesOf([0, 0]), [0, 0]);
  assert.deepEqual(sharesOf([]), []);
});

test("金额简写", () => {
  assert.equal(formatCompact(0), "0");
  assert.equal(formatCompact(999), "999");
  assert.equal(formatCompact(1200), "1.2k");
  assert.equal(formatCompact(12000), "1.2万");
  assert.equal(formatCompact(240000), "24万");
});

test("按月归集:补齐空月份", () => {
  const now = new Date("2026-11-18T00:00:00");
  const buckets = monthlyBuckets([
    { purchasedAt: "2026-11-02T00:00:00", totalPrice: 100 },
    { purchasedAt: "2026-11-20T00:00:00", totalPrice: 50 },
    { purchasedAt: "2026-09-10T00:00:00", totalPrice: 30 },
    { purchasedAt: "2025-01-01T00:00:00", totalPrice: 999 },
  ], now, 6);
  assert.equal(buckets.length, 6);
  assert.deepEqual(buckets.map((row) => row.month), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.equal(buckets[3].total, 30);
  assert.equal(buckets[5].total, 150);
  assert.equal(buckets[4].total, 0, "没有记录的月份补 0");
  assert.equal(buckets[0].label, "6 月");
});

test("按月归集容忍非法日期", () => {
  const buckets = monthlyBuckets([{ purchasedAt: "not-a-date", totalPrice: 10 }], new Date("2026-11-18"), 3);
  assert.deepEqual(buckets.map((row) => row.total), [0, 0, 0]);
});

test("环比:上月为 0 时返回 null", () => {
  const rows = (values) => values.map((total, index) => ({ month: `2026-0${index + 1}`, label: `${index + 1} 月`, total }));
  assert.equal(monthOverMonth(rows([100, 150])), 50);
  assert.equal(monthOverMonth(rows([100, 50])), -50);
  assert.equal(monthOverMonth(rows([0, 50])), null);
  assert.equal(monthOverMonth(rows([100])), null);
});