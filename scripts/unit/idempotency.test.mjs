// 幂等助手(纯函数部分)的单测:
//   npm run test:unit
//
// opId 是唯一键的一部分,不能什么字符串都收:长度、字符集都要卡住。
// (去重本身要真数据库,靠探针库上的两步验证,见 verify-* 与发布说明。)
import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeOpId } from "../../src/lib/idempotency.ts";

test("正常的操作号:收下并去掉首尾空白", () => {
  assert.equal(normalizeOpId(" 8f2a1c4e-77bb-4a1e-9d3f-2c5e10ab9911 "), "8f2a1c4e-77bb-4a1e-9d3f-2c5e10ab9911");
  assert.equal(normalizeOpId("offline:item.consume:1723456789:abcd1234"), "offline:item.consume:1723456789:abcd1234");
});

test("太长、太短、带怪字符:一律当没带(宁可不保护,也不把垃圾塞进唯一键)", () => {
  assert.equal(normalizeOpId(null), null);
  assert.equal(normalizeOpId(""), null);
  assert.equal(normalizeOpId("short"), null);
  assert.equal(normalizeOpId("带中文的操作号12345678"), null);
  assert.equal(normalizeOpId("has space and length ok"), null);
  assert.equal(normalizeOpId("a".repeat(121)), null);
});

test("长度边界:8 位收、7 位不收、120 位收、121 位不收", () => {
  assert.equal(normalizeOpId("abcdefgh"), "abcdefgh");
  assert.equal(normalizeOpId("abcdefg"), null);
  assert.equal(normalizeOpId("a".repeat(120)), "a".repeat(120));
  assert.equal(normalizeOpId("a".repeat(121)), null);
});
