// inDaysPhrase 的单测。
//
// 这个助手是为了根治「0 天后到期」「还有 0 天」这类句子而加的:
// 界面里 5 处各自用 `Math.max(0, days) 天后…` 拼天数,0 与负数都被抹成了 0。

import { test } from "node:test";
import assert from "node:assert/strict";
import { inDaysPhrase } from "@/lib/expiry-status";

test("到期:今天 / 明天 / 之后分别说清楚", () => {
  assert.equal(inDaysPhrase(0, "到期"), "今天到期");
  assert.equal(inDaysPhrase(1, "到期"), "明天到期");
  assert.equal(inDaysPhrase(5, "到期"), "5 天后到期");
});

test("到期:已过期要说天数,不能说「0 天后」", () => {
  assert.equal(inDaysPhrase(-1, "到期"), "已过期 1 天");
  assert.equal(inDaysPhrase(-30, "到期"), "已过期 30 天");
  assert.ok(!inDaysPhrase(-3, "到期").includes("0 天后"));
});

test("用完:今天 / 明天 / 之后", () => {
  assert.equal(inDaysPhrase(0, "用完"), "今天用完");
  assert.equal(inDaysPhrase(1, "用完"), "明天用完");
  assert.equal(inDaysPhrase(4, "用完"), "4 天后用完");
});

test("用完:已经用完不再报负数天数", () => {
  assert.equal(inDaysPhrase(-2, "用完"), "已经用完");
});

test("不带动作词时只说时间", () => {
  assert.equal(inDaysPhrase(0, ""), "今天");
  assert.equal(inDaysPhrase(1, ""), "明天");
  assert.equal(inDaysPhrase(6, ""), "6 天后");
});

test("预估语气(约)只加在未来、且不是今天/明天", () => {
  assert.equal(inDaysPhrase(5, "", true), "约 5 天后");
  assert.equal(inDaysPhrase(5, "用完", true), "约 5 天后用完");
  assert.equal(inDaysPhrase(0, "", true), "今天");
  assert.equal(inDaysPhrase(1, "", true), "明天");
});

test("默认动作词是「到期」", () => {
  assert.equal(inDaysPhrase(3), "3 天后到期");
  assert.equal(inDaysPhrase(0), "今天到期");
});