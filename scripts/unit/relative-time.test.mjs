// 相对时间文案的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { relativeTimeText } from "../../src/lib/relative-time.ts";

const NOW = new Date("2026-11-19T12:00:00");
const ago = (ms) => new Date(NOW.getTime() - ms);

test("一分钟内说「刚刚」", () => {
  assert.equal(relativeTimeText(ago(0), NOW), "刚刚");
  assert.equal(relativeTimeText(ago(59_000), NOW), "刚刚");
});

test("一小时内按分钟", () => {
  assert.equal(relativeTimeText(ago(3 * 60_000), NOW), "3 分钟前");
  assert.equal(relativeTimeText(ago(59 * 60_000), NOW), "59 分钟前");
});

test("一天内按小时", () => {
  assert.equal(relativeTimeText(ago(2 * 3600_000), NOW), "2 小时前");
  assert.equal(relativeTimeText(ago(23 * 3600_000), NOW), "23 小时前");
});

test("一天到一周按天,昨天单独说", () => {
  assert.equal(relativeTimeText(ago(25 * 3600_000), NOW), "昨天");
  assert.equal(relativeTimeText(ago(3 * 86400_000), NOW), "3 天前");
});

test("超过一周给日期", () => {
  assert.equal(relativeTimeText(new Date("2026-10-02T12:00:00"), NOW), "10/2");
});

test("空值与坏数据返回 null", () => {
  assert.equal(relativeTimeText(null), null);
  assert.equal(relativeTimeText(undefined), null);
  assert.equal(relativeTimeText("not-a-date"), null);
});

test("接受字符串时间", () => {
  assert.equal(relativeTimeText("2026-11-19T11:30:00", NOW), "30 分钟前");
});

test("未来时间不显示负数", () => {
  assert.equal(relativeTimeText(new Date(NOW.getTime() + 5 * 60_000), NOW), "刚刚");
});