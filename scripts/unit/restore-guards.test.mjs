// 恢复备份时的取值守卫单测:外部文件里能塞进什么,决定了库里会出现什么。
//   npm run test:unit
//
// 由来(实测,修之前都真的写进去了):
//   · `percentBefore: 150` 恢复进库 → 点「撤销消耗」把物品余量写成 150%;
//   · `unitPrice: -100 / quantity: -2` 恢复进库 → 月报支出被负数拉低。
// 这里把「什么算可用」钉死,避免以后有人把判断又改回 `typeof === "number"`。

import { test } from "node:test";
import assert from "node:assert/strict";

import { usableAmount, usablePercent } from "../../src/lib/restore-guards.ts";

test("余量标记:0..100 之间的有限数才可用", () => {
  assert.equal(usablePercent(0), 0);
  assert.equal(usablePercent(60), 60);
  assert.equal(usablePercent(100), 100);
  assert.equal(usablePercent(150), null);
  assert.equal(usablePercent(-1), null);
  assert.equal(usablePercent(Number.NaN), null);
  assert.equal(usablePercent(Number.POSITIVE_INFINITY), null);
  assert.equal(usablePercent("50"), null);
  assert.equal(usablePercent(null), null);
  assert.equal(usablePercent(undefined), null);
});

test("金额与数量:非负有限数才可用(负价在任何界面里都录不进来)", () => {
  assert.equal(usableAmount(0), true);
  assert.equal(usableAmount(12.34), true);
  assert.equal(usableAmount(-100), false);
  assert.equal(usableAmount(-0.01), false);
  assert.equal(usableAmount(Number.NaN), false);
  assert.equal(usableAmount(Number.POSITIVE_INFINITY), false);
  assert.equal(usableAmount("12"), false);
  assert.equal(usableAmount(null), false);
});