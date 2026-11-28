// 离线待发队列(纯函数部分)的单测:
//   npm run test:unit
//
// 守两件会真出事的东西:① 该重试的必须重试(网络错、5xx),不该重试的绝不能重试(400 卡死队列);
// ② opId 必须落在服务端那把钥匙的白名单里,否则幂等在服务端会被当成「没带」。
import { test } from "node:test";
import assert from "node:assert/strict";

import { isRetryable, makeOpId, makeOperation, nextDelayMs, oldest, pendingCount } from "../../src/lib/outbox-core.ts";
import { normalizeOpId } from "../../src/lib/idempotency.ts";

test("opId 必须能被服务端的 normalizeOpId 收下(否则幂等白做)", () => {
  const opId = makeOpId();
  assert.ok(opId.length >= 8 && opId.length <= 120, `长度越界:${opId.length}`);
  assert.equal(normalizeOpId(opId), opId);
});

test("opId 不重复(同一毫秒内连发也一样)", () => {
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) ids.add(makeOpId(1700000000000));
  assert.equal(ids.size, 200);
});

test("该重试的:断网(null)、5xx、408、429", () => {
  assert.equal(isRetryable(null), true, "没拿到响应 = 断网,最该重试");
  assert.equal(isRetryable(500), true);
  assert.equal(isRetryable(503), true);
  assert.equal(isRetryable(408), true);
  assert.equal(isRetryable(429), true);
});

test("不该重试的:400 校验不过、401 没登录、403 只读、404、409 业务冲突", () => {
  for (const status of [400, 401, 403, 404, 409, 413, 422]) {
    assert.equal(isRetryable(status), false, `${status} 不该重试 —— 重试只会把队列卡死在第一条`);
  }
});

test("退避是指数增长且有上限(1s → 2s → 4s … 最多 60s)", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(nextDelayMs), [1000, 2000, 4000, 8000, 16000, 32000]);
  assert.equal(nextDelayMs(6), 60000);
  assert.equal(nextDelayMs(50), 60000, "次数再多也不许无限等");
  assert.equal(nextDelayMs(-3), 1000, "脏数据不要炸");
});

test("新建的操作:次数 0、没有错误、带标签", () => {
  const op = makeOperation({ method: "POST", url: "/api/items/x/consume", label: "消耗 1 件 · 可乐" }, 1700000000000);
  assert.equal(op.attempts, 0);
  assert.equal(op.lastError, null);
  assert.equal(op.createdAt, 1700000000000);
  assert.equal(op.label, "消耗 1 件 · 可乐");
  assert.equal(op.method, "POST");
});

test("重放按最老的一条先来(先建后改不能乱序)", () => {
  const a = { ...makeOperation({ method: "POST", url: "/a", label: "A" }, 1000) };
  const b = { ...makeOperation({ method: "POST", url: "/b", label: "B" }, 2000) };
  assert.equal(oldest([b, a])?.url, "/a");
  assert.equal(oldest([]), null);
  assert.equal(pendingCount([a, b]), 2);
});
