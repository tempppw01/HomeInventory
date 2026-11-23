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
  expiryStatusFor,
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

// ---- expiryStatusFor:全站唯一口径 -------------------------------------------------
//
// v0.1.33 起因:物品卡片的临期窗口是**硬编码 30 天**、详情页也是,而提醒中心用的是
// 用户设置的「保质期提前 N 天」。把提醒设成 7 天,卡片仍会给 20 天后到期的东西打黄色到期标,
// 提醒中心里却没有它 —— 同一个词两套标准。下面把「窗口由调用方给、三档语义固定」钉住。

test("expiryStatusFor:三档语义(过期 / 临期 / 都不标)", () => {
  const now = new Date(2026, 10, 24, 12, 0, 0); // 本地 2026-11-24 12:00
  const on = (day) => new Date(2026, 10, day, 0, 0, 0);

  assert.deepEqual(expiryStatusFor(on(20), now, 7), { days: -4, expired: true, expiring: false, tone: "danger" });

  assert.deepEqual(expiryStatusFor(on(24), now, 7), { days: 0, expired: true, expiring: false, tone: "danger" }, "今天到期按危险色,和卡片一致");

  assert.deepEqual(expiryStatusFor(on(27), now, 7), { days: 3, expired: false, expiring: true, tone: "warning" });

  assert.deepEqual(expiryStatusFor(on(30), now, 7), { days: 6, expired: false, expiring: true, tone: "warning" }, "窗口是闭区间");

  // 注意:11 月只有 30 天,on(31) 会滚到 12-01(正好 7 天后),要单独写日期
  const beyond = expiryStatusFor(new Date(2026, 11, 2, 0, 0, 0), now, 7); // 12-02 = 8 天后
  assert.equal(beyond.expiring, false, "8 天后到期、窗口 7 天:不标");
  assert.equal(beyond.tone, null);
});

test("expiryStatusFor:窗口由调用方给 —— 同一个日期,窗口不同结论就不同", () => {
  const now = new Date(2026, 10, 24, 9, 0, 0);
  const target = new Date(2026, 11, 14, 0, 0, 0); // 20 天后
  assert.equal(expiryStatusFor(target, now, 7).expiring, false, "设成提前 7 天:20 天后不该算临期");
  assert.equal(expiryStatusFor(target, now, 14).expiring, false, "设成提前 14 天:也还不到");
  assert.equal(expiryStatusFor(target, now, 30).expiring, true, "只有窗口 ≥20 天才算临期");
});

test("expiryStatusFor:没有有效期 / 非法日期返回 null", () => {
  const now = new Date(2026, 10, 24, 12, 0, 0);
  assert.equal(expiryStatusFor(null, now, 7), null);
  assert.equal(expiryStatusFor(undefined, now, 7), null);
  assert.equal(expiryStatusFor("不是日期", now, 7), null);
});
