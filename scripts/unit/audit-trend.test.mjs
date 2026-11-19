// 盘点历史趋势的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { confirmRate, auditTrend, auditTrendText } from "../../src/lib/audit-trend.ts";

const entry = (patch) => ({ at: patch.at ?? "2026-11-01T10:00:00", total: patch.total ?? 10, confirmed: patch.confirmed ?? 5, locationName: patch.locationName ?? "全部空间" });

test("确认率计算,总数为 0 时返回 0", () => {
  assert.equal(confirmRate(entry({ total: 10, confirmed: 5 })), 0.5);
  assert.equal(confirmRate(entry({ total: 4, confirmed: 4 })), 1);
  assert.equal(confirmRate(entry({ total: 0, confirmed: 0 })), 0);
});

test("少于两次不画趋势(一个点看不出走势)", () => {
  assert.deepEqual(auditTrend([]), []);
  assert.deepEqual(auditTrend([entry({})]), []);
});

test("按时间正序输出最近若干次,标签用月/日", () => {
  const trend = auditTrend([
    entry({ at: "2026-11-18T09:00:00", total: 10, confirmed: 9 }), // 最新
    entry({ at: "2026-11-10T09:00:00", total: 10, confirmed: 5 }),
    entry({ at: "2026-11-01T09:00:00", total: 10, confirmed: 3 }),
  ]);
  assert.deepEqual(trend.map((row) => row.value), [30, 50, 90]);
  assert.deepEqual(trend.map((row) => row.label), ["11/1", "11/10", "11/18"]);
});

test("只取最近 N 次,并按时间正序", () => {
  // history 约定为「最新在前」(盘点页每次结束都 unshift),所以这里按 8→1 排列
  const history = Array.from({ length: 8 }, (_, index) => {
    const day = 8 - index;
    return entry({ at: `2026-11-${String(day).padStart(2, "0")}T09:00:00`, total: 10, confirmed: day });
  });
  const trend = auditTrend(history, 3);
  assert.equal(trend.length, 3);
  assert.deepEqual(trend.map((row) => row.value), [60, 70, 80]); // 最近三次:6 日、7 日、8 日
});

test("非法日期不崩,标签用 ?", () => {
  // 最新在前:第一条是坏日期;反转后它排在最后
  const trend = auditTrend([entry({ at: "bad-date" }), entry({ at: "2026-11-18T09:00:00" })]);
  assert.equal(trend.at(-1)?.label, "?");
  assert.equal(trend[0].label, "11/18");
});

test("趋势文案说明变好还是变差", () => {
  assert.match(auditTrendText([{ value: 50 }, { value: 80 }]) ?? "", /比上次高 30 个百分点/);
  assert.match(auditTrendText([{ value: 80 }, { value: 50 }]) ?? "", /比上次低 30 个百分点/);
  assert.equal(auditTrendText([{ value: 60 }, { value: 60 }]), "最近两次都是 60%");
  assert.equal(auditTrendText([{ value: 60 }]), null);
});