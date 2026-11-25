// 盘点数量上界的单测:接口与「恢复备份」共用一份规则。
//   npm run test:unit
//
// 由来:接口早就拒绝 10 亿,但恢复备份那条路当时只查了 Number.isFinite,
// 同一个值从备份文件里一路写进永久历史。规则收到 lib/audit-limits 之后,这里把边界钉死。

import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_AUDIT_COUNT, auditCountRangeMessage, clampAuditConfirmed, isAuditCount } from "../../src/lib/audit-limits.ts";

test("盘点数量:0 与上界都算合法,越界与非法值都不算", () => {
  assert.equal(isAuditCount(0), true);
  assert.equal(isAuditCount(5), true);
  assert.equal(isAuditCount(MAX_AUDIT_COUNT), true);
  assert.equal(isAuditCount(MAX_AUDIT_COUNT + 1), false);
  assert.equal(isAuditCount(1_000_000_000), false);
  assert.equal(isAuditCount(-1), false);
  assert.equal(isAuditCount(Number.NaN), false);
  assert.equal(isAuditCount(Number.POSITIVE_INFINITY), false);
});

test("确认数不可能超过总数:夹取而不是丢弃这条真实记录", () => {
  assert.equal(clampAuditConfirmed(5, 99), 5);
  assert.equal(clampAuditConfirmed(5, 3), 3);
  assert.equal(clampAuditConfirmed(10, -2), 0);
  assert.equal(clampAuditConfirmed(10, Number.NaN), 0);
  assert.equal(clampAuditConfirmed(10, 12.4), 10);
  assert.equal(clampAuditConfirmed(2000, 999999999), 2000);
});

test("越界提示里能读到一个具体的上限数字(用户知道该改成多少)", () => {
  assert.match(auditCountRangeMessage(), /1,000,000/);
});