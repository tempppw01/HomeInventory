// 日期边界:同一天里不同时刻,「到期天数」必须一致。
//
// 起因(实测推演出来的不一致):保质期存的是「本地那一天的 00:00」
// (本地 11-24 → 2026-11-23T16:00:00Z)。应用绝大部分地方都先把两侧归到本地自然日再相减,
// 但有两处是直接拿原始时间戳相减再 Math.round:
//   · AI 洞察那条 route 上报的 days
//   · 「排序 → 最快到期」下面那句提示
// 结果是一件**今天到期**的东西,中午之后会被算成 -1(提示「已过期 1 天」),
// 而明天到期的东西在傍晚会被算成 0(提示「今天到期」)。
//
// 这里把「本地自然日」口径钉死:一天之内随便几点,同一件物品的天数必须相同。

import { test } from "node:test";
import assert from "node:assert/strict";

import { daysUntilLocalDay } from "../../src/lib/expiry-status.ts";
import { sortHint } from "../../src/lib/item-sort.ts";

/** 把本地某个「年月日 时分」做成 Date(用本地时区构造,不受机器时区设置影响) */
const at = (year, month, day, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute, 0, 0);
/** 保质期在库里就是「本地那一天的 00:00」 */
const expiryOn = (year, month, day) => new Date(year, month - 1, day, 0, 0, 0, 0);

test("今天到期:一天里无论几点都算 0 天", () => {
  for (const hour of [0, 1, 6, 11, 12, 13, 18, 23]) {
    const now = at(2026, 11, 24, hour, hour === 23 ? 59 : 0);
    assert.equal(daysUntilLocalDay(expiryOn(2026, 11, 24), now), 0, `${hour} 点时应当算「今天到期」`);
  }
});

test("昨天 / 明天 / 前后跨月,各差一天", () => {
  const now = at(2026, 11, 24, 18);
  assert.equal(daysUntilLocalDay(expiryOn(2026, 11, 23), now), -1, "昨天既是 -1");
  assert.equal(daysUntilLocalDay(expiryOn(2026, 11, 25), now), 1, "明天既是 1");
  assert.equal(daysUntilLocalDay(expiryOn(2026, 12, 1), now), 7, "跨月也要对");
  assert.equal(daysUntilLocalDay(expiryOn(2026, 10, 31), now), -24, "跨月往回也要对");
});

test("跨年 / 闰年边界不差一天", () => {
  assert.equal(daysUntilLocalDay(expiryOn(2027, 1, 1), at(2026, 12, 31, 23, 59)), 1);
  assert.equal(daysUntilLocalDay(expiryOn(2026, 3, 1), at(2026, 2, 28, 23, 59)), 1, "2026 不是闰年");
  assert.equal(daysUntilLocalDay(expiryOn(2024, 3, 1), at(2024, 2, 29, 8)), 1, "2024 是闰年,2 月有 29 天");
});

test("非法输入返回 NaN,而不是悄悄算成 0", () => {
  assert.ok(Number.isNaN(daysUntilLocalDay("不是一个日期", at(2026, 11, 24))));
});

test("排序提示:今天到期就说今天,别在傍晚说成「已过期 1 天」", () => {
  const items = [{ expiryDate: expiryOn(2026, 11, 24).toISOString() }];
  for (const hour of [9, 12, 15, 18, 22]) {
    const hint = sortHint("expiry", items, at(2026, 11, 24, hour).getTime());
    assert.equal(hint, "最快的一件今天到期", `${hour} 点时提示=${hint}`);
  }
});

test("排序提示:明天到期就说还有 1 天,别在傍晚说成「今天到期」", () => {
  const items = [{ expiryDate: expiryOn(2026, 11, 25).toISOString() }];
  for (const hour of [1, 9, 15, 18, 23]) {
    const hint = sortHint("expiry", items, at(2026, 11, 24, hour).getTime());
    assert.equal(hint, "最快的一件还有 1 天到期", `${hour} 点时提示=${hint}`);
  }
});

test("排序提示:过期几天也按自然日算", () => {
  const items = [{ expiryDate: expiryOn(2026, 11, 20).toISOString() }];
  assert.equal(sortHint("expiry", items, at(2026, 11, 24, 9).getTime()), "最快的一件已过期 4 天");
  assert.equal(sortHint("expiry", items, at(2026, 11, 24, 21).getTime()), "最快的一件已过期 4 天", "同一天里换了时刻,天数不该变");
});