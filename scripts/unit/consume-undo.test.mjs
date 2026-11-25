// 「撤销消耗」退什么的单测:
//   npm run test:unit
//
// 这一轮量到的缺陷:撤销逻辑不分「数量型」与「余量型」,一律给 quantity 加 1。
// 实测一瓶(quantity=1、余量 100% → 60%)撤销后变成 quantity=2、余量仍 60% —— 凭空多一瓶。
// 判断因此抽成纯函数 planConsumeUndo,这里把三种情形钉死。

import { test } from "node:test";
import assert from "node:assert/strict";

import { planConsumeUndo } from "../../src/lib/consume-undo.ts";
import { consumeRateFrom, CONSUME_RATE_WINDOW_DAYS } from "../../src/lib/consume-rate.ts";

test("数量型消耗(手动/扫码)→ 撤销就是把数量加回来", () => {
  assert.deepEqual(planConsumeUndo({ percentBefore: null, detail: "手动消耗 1 件" }), { kind: "unit" });
  assert.deepEqual(planConsumeUndo({ percentBefore: null, detail: "扫码消耗 1 瓶" }), { kind: "unit" });
  assert.deepEqual(planConsumeUndo({ percentBefore: null, detail: null }), { kind: "unit" });
});

test("余量型消耗记下了 percentBefore → 按余量回退,不动数量", () => {
  assert.deepEqual(planConsumeUndo({ percentBefore: 100, detail: "余量 100% → 60%" }), { kind: "percent", percentBefore: 100 });
  assert.deepEqual(planConsumeUndo({ percentBefore: 62.5, detail: "余量 63% → 25%" }), { kind: "percent", percentBefore: 62.5 });
});

test("余量 0% 也要能回退(不能被当成「没记下」)", () => {
  assert.deepEqual(planConsumeUndo({ percentBefore: 0, detail: "余量 0% → 20%" }), { kind: "percent", percentBefore: 0 });
});

test("旧记录(没有 percentBefore,但明细写着余量)→ 拒绝撤销,不拿库存去猜", () => {
  assert.deepEqual(planConsumeUndo({ percentBefore: null, detail: "余量 100% → 60%" }), { kind: "legacy-percent" });
  assert.deepEqual(planConsumeUndo({ percentBefore: undefined, detail: "余量 80% → 40%" }), { kind: "legacy-percent" });
});

test("字段存在但值不可用(不是有限数)→ 也按旧记录拒绝", () => {
  assert.deepEqual(planConsumeUndo({ percentBefore: Number.NaN, detail: null }), { kind: "legacy-percent" });
});

test("消耗速度的换算口径:30 天窗口,次/天", () => {
  assert.equal(CONSUME_RATE_WINDOW_DAYS, 30);
  assert.equal(consumeRateFrom(3), 0.1);
  assert.equal(consumeRateFrom(0), 0);
  assert.equal(consumeRateFrom(2), 2 / 30);
});

test("越界的 percentBefore(备份里塞进来的)→ 按旧记录拒绝,不拿它去改库存", () => {
  // 实测:恢复一份 `percentBefore: 150` 的备份后,点「撤销消耗」会把余量写成 150%。
  assert.deepEqual(planConsumeUndo({ percentBefore: 150, detail: "余量 150% → 300%" }), { kind: "legacy-percent" });
  assert.deepEqual(planConsumeUndo({ percentBefore: -5, detail: null }), { kind: "legacy-percent" });
  assert.deepEqual(planConsumeUndo({ percentBefore: 0.5, detail: null }), { kind: "percent", percentBefore: 0.5 });
  // 边界值本身是合法的,不能被误伤
  assert.deepEqual(planConsumeUndo({ percentBefore: 0, detail: null }), { kind: "percent", percentBefore: 0 });
  assert.deepEqual(planConsumeUndo({ percentBefore: 100, detail: null }), { kind: "percent", percentBefore: 100 });
});
