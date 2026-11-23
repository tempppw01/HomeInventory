// localDateOf 的单测 —— 把「接口给的日期字符串」转成本地那一天。
//
// 起因:一处被复制了八遍的 `日期字符串.slice(0, 10)`。接口返回的是完整 ISO
// (2026-12-13T16:00:00.000Z 表示**本地 12-14 的零点**),slice 拿到的是 UTC 日 ——
// 在东八区永远比用户看到的那天早一天。实测:录入到期日 2026-12-14 → 导出 CSV 写成 2026-12-13。
// 最要命的是编辑弹窗用它预填:打开编辑、不动日期点保存 → 到期日往回退一天,每编辑一次退一天。

import { test } from "node:test";
import assert from "node:assert/strict";

import { localDateOf, localDateString } from "../../src/lib/local-date.ts";

/** 造一个「本地某天的零点」对应的 ISO 字符串(与接口返回的形状一致) */
const isoForLocalMidnight = (year, month, day) => new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();

test("完整时间戳 → 取本地那天,不是 UTC 那天", () => {
  const iso = isoForLocalMidnight(2026, 12, 14);
  // 东八区下这个 ISO 的前 10 位是 12-13,而本地那天是 12-14
  assert.equal(iso.slice(0, 10), "2026-12-13", "前提:接口给的 ISO 前 10 位确实是前一天(东八区)");
  assert.equal(localDateOf(iso), "2026-12-14", "应当取本地那天");
});

test("本来就是日期字符串 → 原样返回(不能被 UTC 解析再退一天)", () => {
  for (const date of ["2026-12-14", "2026-01-01", "2024-02-29"]) {
    assert.equal(localDateOf(date), date);
  }
  assert.equal(localDateOf("  2026-12-14  "), "2026-12-14", "前后空白要去掉");
});

test("Date 对象 → 本地那天", () => {
  const date = new Date(2026, 11, 14, 23, 59, 59);
  assert.equal(localDateOf(date), "2026-12-14");
  assert.equal(localDateOf(date), localDateString(date), "与 localDateString 口径一致");
});

test("空值 / 非法值 → 空串,而不是 Invalid Date", () => {
  for (const value of [null, undefined, "", "不是日期"]) {
    assert.equal(localDateOf(value), "", `「${String(value)}」应当返回空串`);
  }
});

test("导出后再导入不会漂移(往返稳定)", () => {
  // 模拟:接口 → 导出写 CSV → 再从 CSV 读回来
  const iso = isoForLocalMidnight(2026, 11, 20);
  const exported = localDateOf(iso);
  assert.equal(exported, "2026-11-20");
  // CSV 里是纯日期,导入时再走一次 localDateOf 也必须原样
  assert.equal(localDateOf(exported), "2026-11-20", "第二次过一遍也不能变");
});