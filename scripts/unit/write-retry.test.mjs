// 写事务重试的单测:
//   npm run test:unit
//
// 由来(MySQL 实测):两件余量被并发下调时,其中一个事务被判定死锁并抛错,接口没处理,
// 用户看到 500(3 个并发里 2 个 500)。SQLite 上永远复现不出来 —— 它的写事务天然串行。
// 这里把「哪些错误该重试、重试几次、用尽后抛什么」钉死。

import { test } from "node:test";
import assert from "node:assert/strict";

import { withWriteRetry, isContention } from "../../src/lib/write-retry.ts";

const prismaError = (code) => Object.assign(new Error(`prisma ${code}`), { code });

test("不撞车就直接返回,不会白重试", async () => {
  let calls = 0;
  const value = await withWriteRetry(async () => { calls += 1; return "ok"; });
  assert.equal(value, "ok");
  assert.equal(calls, 1);
});

test("P2034(死锁 / 写冲突)会重试,第二次成功就返回", async () => {
  let calls = 0;
  const value = await withWriteRetry(async () => {
    calls += 1;
    if (calls === 1) throw prismaError("P2034");
    return "second";
  });
  assert.equal(value, "second");
  assert.equal(calls, 2);
});

test("业务错误不重试:一次就抛出原错误", async () => {
  let calls = 0;
  await assert.rejects(
    withWriteRetry(async () => { calls += 1; throw prismaError("P2002"); }),
    (error) => error.code === "P2002",
  );
  assert.equal(calls, 1);
});

test("重试次数用尽后抛出最后一次的错误", async () => {
  let calls = 0;
  await assert.rejects(
    withWriteRetry(async () => { calls += 1; throw prismaError("P2034"); }, 3),
    (error) => error.code === "P2034",
  );
  assert.equal(calls, 3);
});

test("消息里的 deadlock / SQLITE_BUSY 也算撞车(不同引擎报法不一样)", async () => {
  assert.equal(isContention(prismaError("P2034")), true);
  assert.equal(isContention(new Error("Deadlock found when trying to get lock")), true);
  assert.equal(isContention(new Error("database is locked")), true);
  assert.equal(isContention(prismaError("P2002")), false);
  assert.equal(isContention(new Error("物品不存在")), false);
});