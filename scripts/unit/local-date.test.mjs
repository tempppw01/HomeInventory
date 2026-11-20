// 本地日历日的单测。
//
// 这个 helper 的存在本身就是为了一类反复踩到的 bug:
// 用 `toISOString().slice(0, 10)` 当「今天」,在东八区会于 00:00~08:00 之间差一天。
// 所以这里既测正常格式,也**明确记录**与 UTC 写法的差异。

import { test } from "node:test";
import assert from "node:assert/strict";

import { localDateString } from "../../src/lib/local-date.ts";

test("按本地日格式化,月/日补零", () => {
  assert.equal(localDateString(new Date(2026, 0, 5, 9, 0, 0)), "2026-01-05");
  assert.equal(localDateString(new Date(2026, 11, 31, 23, 59, 59)), "2026-12-31");
});

test("跨零点仍是当天(本地语义)", () => {
  assert.equal(localDateString(new Date(2026, 10, 20, 0, 0, 1)), "2026-11-20");
  assert.equal(localDateString(new Date(2026, 10, 19, 23, 59, 59)), "2026-11-19");
});

test("凌晨时分不会像 UTC 写法那样退到前一天", () => {
  const earlyMorning = new Date(2026, 10, 20, 2, 0, 0); // 本地 2026-11-20 02:00
  assert.equal(localDateString(earlyMorning), "2026-11-20");

  // 在东八区,同一时刻的 UTC 串是前一天 —— 这正是被替换掉的那种写法的问题。
  // 特意断言,免得以后有人「顺手改回 toISOString」。
  if (earlyMorning.getTimezoneOffset() === -480) {
    assert.equal(earlyMorning.toISOString().slice(0, 10), "2026-11-19");
  }
});

test("默认参数取当前时间,且格式始终是 YYYY-MM-DD", () => {
  assert.match(localDateString(), /^\d{4}-\d{2}-\d{2}$/);
});
