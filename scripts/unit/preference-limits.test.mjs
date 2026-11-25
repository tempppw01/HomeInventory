// 偏好取值范围与夹取的单元测试。
//   npm run test:unit
//
// 由来(实测):界面上「提前 1~90 天提醒」「每周盘点 0~6」,设置接口也拒绝越界值,
// 但恢复备份只查了 Number.isFinite —— `expiryReminderDays: -3, weeklyReviewDay: 99`
// 被原样写进库:临期提醒窗口变成负数(家里有快过期的东西也不再提醒),
// 每周盘点落在一个不存在的星期。

import { test } from "node:test";
import assert from "node:assert/strict";

import { PREFERENCE_LIMITS, clampPreferenceInt } from "../../src/lib/preference-limits.ts";

test("提醒天数:1~90,越界夹到边界", () => {
  const range = PREFERENCE_LIMITS.expiryReminderDays;
  assert.equal(range.min, 1);
  assert.equal(range.max, 90);
  assert.equal(clampPreferenceInt(7, range), 7);
  assert.equal(clampPreferenceInt(1, range), 1);
  assert.equal(clampPreferenceInt(90, range), 90);
  assert.equal(clampPreferenceInt(0, range), 1);
  assert.equal(clampPreferenceInt(-3, range), 1);
  assert.equal(clampPreferenceInt(9999, range), 90);
});

test("每周盘点星期:0~6,越界夹到边界", () => {
  const range = PREFERENCE_LIMITS.weeklyReviewDay;
  assert.equal(range.min, 0);
  assert.equal(range.max, 6);
  assert.equal(clampPreferenceInt(3, range), 3);
  assert.equal(clampPreferenceInt(99, range), 6);
  assert.equal(clampPreferenceInt(-1, range), 0);
});

test("小数四舍五入,非数字用默认值", () => {
  const range = PREFERENCE_LIMITS.expiryReminderDays;
  assert.equal(clampPreferenceInt(2.4, range), 2);
  assert.equal(clampPreferenceInt(2.7, range), 3);
  assert.equal(clampPreferenceInt("14", range), 14);
  assert.equal(clampPreferenceInt("abc", range), range.fallback);
  assert.equal(clampPreferenceInt(null, range), range.fallback);
  assert.equal(clampPreferenceInt(undefined, range), range.fallback);
  assert.equal(clampPreferenceInt(Number.NaN, range), range.fallback);
  assert.equal(clampPreferenceInt(Number.POSITIVE_INFINITY, range), range.fallback);
});