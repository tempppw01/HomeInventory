// 任务重复周期的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { nextDueDate, isTaskRecurrence, recurrenceLabel, TASK_RECURRENCES, RECURRENCE_LABELS } from "../../src/lib/task-recurrence.ts";

const iso = (date) => date.toISOString().slice(0, 10);

test("每天 / 每周", () => {
  assert.equal(iso(nextDueDate(new Date("2026-03-10T09:00:00Z"), "DAILY")), "2026-03-11");
  assert.equal(iso(nextDueDate(new Date("2026-03-10T09:00:00Z"), "WEEKLY")), "2026-03-17");
});

test("每月 / 每季度 / 每半年 / 每年", () => {
  const base = new Date("2026-03-10T09:00:00Z");
  assert.equal(iso(nextDueDate(base, "MONTHLY")), "2026-04-10");
  assert.equal(iso(nextDueDate(base, "QUARTERLY")), "2026-06-10");
  assert.equal(iso(nextDueDate(base, "HALF_YEARLY")), "2026-09-10");
  assert.equal(iso(nextDueDate(base, "YEARLY")), "2027-03-10");
});

test("月末不会溢出到下一个月的错误日期", () => {
  // 1/31 + 1 个月应该是 2/28(2026 非闰年),而不是 3/3
  assert.equal(iso(nextDueDate(new Date("2026-01-31T09:00:00Z"), "MONTHLY")), "2026-02-28");
  // 8/31 + 3 个月 → 11/30
  assert.equal(iso(nextDueDate(new Date("2026-08-31T09:00:00Z"), "QUARTERLY")), "2026-11-30");
});

test("闰年 2 月也按当月实际天数夹住", () => {
  assert.equal(iso(nextDueDate(new Date("2028-01-31T09:00:00Z"), "MONTHLY")), "2028-02-29");
});

test("一次性与未知周期都不推进", () => {
  const base = new Date("2026-03-10T09:00:00Z");
  assert.equal(iso(nextDueDate(base, "NONE")), "2026-03-10");
  assert.equal(iso(nextDueDate(base, "WAT")), "2026-03-10");
});

test("原日期对象不被修改", () => {
  const base = new Date("2026-03-10T09:00:00Z");
  nextDueDate(base, "YEARLY");
  assert.equal(iso(base), "2026-03-10");
});

test("周期白名单与中文标签完整", () => {
  assert.equal(TASK_RECURRENCES.length, 7);
  for (const value of TASK_RECURRENCES) {
    assert.ok(RECURRENCE_LABELS[value], value);
  }
  assert.equal(RECURRENCE_LABELS.QUARTERLY, "每 3 个月");
  assert.equal(isTaskRecurrence("QUARTERLY"), true);
  assert.equal(isTaskRecurrence("WAT"), false);
  assert.equal(isTaskRecurrence(null), false);
});
test("周期标签:不认识的值按「一次性」显示(与完成时的行为一致)", () => {
  // 修之前:这类值恢复进库后标签是个空徽章,点「完成」也不推进
  assert.equal(recurrenceLabel("WEEKLY"), "每周");
  assert.equal(recurrenceLabel("QUARTERLY"), "每 3 个月");
  assert.equal(recurrenceLabel("NONE"), "一次性");
  assert.equal(recurrenceLabel("每周"), "一次性");
  assert.equal(recurrenceLabel("WAT"), "一次性");
  assert.equal(recurrenceLabel(""), "一次性");
});
