// 「每周盘点」提醒的单测。
//
// 这个偏好此前是死开关:能存、能改、接口也返回,但没有任何地方消费它。
// 现在由提醒中心据此决定是否给出「开始盘点」入口,规则在这里钉住。

import { test } from "node:test";
import assert from "node:assert/strict";

import { isWeeklyReviewDay, weekdayLabel, WEEKDAY_LABELS } from "../../src/lib/weekly-review.ts";

// 2026-11-21 是周六(6)
const SATURDAY = new Date(2026, 10, 21, 10, 0, 0);
const SUNDAY = new Date(2026, 10, 22, 10, 0, 0);

test("设定日就是今天 → 需要提醒", () => {
  assert.equal(isWeeklyReviewDay({ weeklyReviewEnabled: true, weeklyReviewDay: 6 }, SATURDAY), true);
  assert.equal(isWeeklyReviewDay({ weeklyReviewEnabled: true, weeklyReviewDay: 0 }, SUNDAY), true);
});

test("不是设定日 → 不提醒", () => {
  assert.equal(isWeeklyReviewDay({ weeklyReviewEnabled: true, weeklyReviewDay: 0 }, SATURDAY), false);
  assert.equal(isWeeklyReviewDay({ weeklyReviewEnabled: true, weeklyReviewDay: 5 }, SUNDAY), false);
});

test("开关关掉后,即使撞上设定日也不提醒", () => {
  assert.equal(isWeeklyReviewDay({ weeklyReviewEnabled: false, weeklyReviewDay: 6 }, SATURDAY), false);
});

test("偏好缺失或异常值不报错、也不提醒", () => {
  assert.equal(isWeeklyReviewDay(null, SATURDAY), false);
  assert.equal(isWeeklyReviewDay(undefined, SATURDAY), false);
  assert.equal(isWeeklyReviewDay({ weeklyReviewEnabled: true, weeklyReviewDay: 9 }, SATURDAY), false);
  assert.equal(isWeeklyReviewDay({ weeklyReviewEnabled: true, weeklyReviewDay: -1 }, SATURDAY), false);
});

test("星期文案与 Date.getDay() 对齐", () => {
  assert.equal(WEEKDAY_LABELS[0], "周日");
  assert.equal(WEEKDAY_LABELS[6], "周六");
  assert.equal(weekdayLabel(3), "周三");
  assert.equal(weekdayLabel(99), "");
});
