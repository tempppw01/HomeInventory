// 到期状态判定的单测。
//
// 这个 helper 的由来:同一个「临期/过期」概念散落在 6 处,边界语义还不一致 ——
// 概览与提醒中心把「今天到期」算进已过期,详情页却当成警告;
// 月报那份列表则是「窗口内(含已过期)」另一种语义。这里把三档语义都钉住。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXPIRING_SOON_DAYS,
  EXPIRING_URGENT_DAYS,
  isExpiredDays,
  isExpiringSoonDays,
  isExpiringUrgentDays,
  isWithinExpiryWindowDays,
  expiryToneFor,
} from "../../src/lib/expiry-status.ts";

test("已过期:只有过了今天才算(今天到期不算)", () => {
  assert.equal(isExpiredDays(-1), true);
  assert.equal(isExpiredDays(-30), true);
  assert.equal(isExpiredDays(0), false);
  assert.equal(isExpiredDays(1), false);
});

test("临期:今天到期属于临期里最紧迫的一档", () => {
  assert.equal(isExpiringSoonDays(0), true);
  assert.equal(isExpiringSoonDays(EXPIRING_SOON_DAYS), true);
  assert.equal(isExpiringSoonDays(EXPIRING_SOON_DAYS + 1), false);
  assert.equal(isExpiringSoonDays(-1), false);
});

test("临期窗口可自定义(用户设置提醒天数)", () => {
  assert.equal(isExpiringSoonDays(5, 7), true);
  assert.equal(isExpiringSoonDays(8, 7), false);
});

test("紧急临期:本周内(含今天),边界包含第 7 天", () => {
  assert.equal(EXPIRING_URGENT_DAYS, 7);
  assert.equal(isExpiringUrgentDays(0), true);
  assert.equal(isExpiringUrgentDays(7), true);
  assert.equal(isExpiringUrgentDays(8), false);
  assert.equal(isExpiringUrgentDays(-1), false);
});

test("月报用的窗口:**含已过期**,只是后面会被标记出来", () => {
  assert.equal(isWithinExpiryWindowDays(-3), true);
  assert.equal(isWithinExpiryWindowDays(0), true);
  assert.equal(isWithinExpiryWindowDays(EXPIRING_SOON_DAYS), true);
  assert.equal(isWithinExpiryWindowDays(EXPIRING_SOON_DAYS + 10), false);
});

test("界面色调:过期危险、临期警示、更远不上色", () => {
  assert.equal(expiryToneFor(-1), "danger");
  assert.equal(expiryToneFor(0), "warning");
  assert.equal(expiryToneFor(EXPIRING_SOON_DAYS), "warning");
  assert.equal(expiryToneFor(EXPIRING_SOON_DAYS + 1), undefined);
  assert.equal(expiryToneFor(null), undefined);
});
