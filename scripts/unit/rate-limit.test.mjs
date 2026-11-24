// 限流与「来源判定」的单测:
//   npm run test:unit
//
// 由来(实测):登录限流只按 X-Forwarded-For 的**最左**值计数,而那个位置客户端可以随便写 ——
// 连续 15 次尝试、每次换一个地址,0 次被拦。直连部署(NAS / docker 端口映射)下等于没有限流。
// 这里把两条规则钉死:窗口/计数语义,以及「取最右值」。

import { test } from "node:test";
import assert from "node:assert/strict";

import { clientAddress, rateLimit, resetRateLimit } from "../../src/lib/rate-limit.ts";

const uniqueKey = (label) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

test("窗口内允许 limit 次,第 limit+1 次被拦并给出重试秒数", () => {
  const key = uniqueKey("t");
  for (let index = 1; index <= 3; index += 1) {
    const result = rateLimit(key, 3, 60_000);
    assert.equal(result.ok, true, `第 ${index} 次应该放行`);
  }
  const blocked = rateLimit(key, 3, 60_000);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= 60, `重试秒数不合理:${blocked.retryAfter}`);
  assert.equal(blocked.remaining, 0);
});

test("不同 key 互不影响(换一个来源不该被别人拖累)", () => {
  const first = uniqueKey("a");
  const second = uniqueKey("b");
  for (let index = 0; index < 2; index += 1) rateLimit(first, 2, 60_000);
  assert.equal(rateLimit(first, 2, 60_000).ok, false);
  assert.equal(rateLimit(second, 2, 60_000).ok, true);
});

test("窗口过后自动恢复", async () => {
  const key = uniqueKey("w");
  assert.equal(rateLimit(key, 1, 30).ok, true);
  assert.equal(rateLimit(key, 1, 30).ok, false);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(rateLimit(key, 1, 30).ok, true);
});

test("来源取 X-Forwarded-For 的最右值(代理追加的那一跳)", () => {
  // 客户端可以自己写前面几段,所以最左不可信;代理会把真实来源追加在末尾。
  const request = new Request("http://localhost/api/auth/login", { headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.7" } });
  assert.equal(clientAddress(request), "203.0.113.7");
});

test("只有一段时就是它;没有 XFF 时退回 x-real-ip,再退回 unknown", () => {
  assert.equal(clientAddress(new Request("http://localhost/", { headers: { "x-forwarded-for": "9.9.9.9" } })), "9.9.9.9");
  assert.equal(clientAddress(new Request("http://localhost/", { headers: { "x-forwarded-for": " , 5.5.5.5 , " } })), "5.5.5.5");
  assert.equal(clientAddress(new Request("http://localhost/", { headers: { "x-real-ip": "7.7.7.7" } })), "7.7.7.7");
  assert.equal(clientAddress(new Request("http://localhost/")), "unknown");
});
test("只读判断(increment:false)不消耗额度 —— 正常登录不该被自己的限流拖住", () => {
  const key = uniqueKey("peek");
  for (let index = 0; index < 20; index += 1) {
    assert.equal(rateLimit(key, 3, 60_000, { increment: false }).ok, true, "只读判断不该把额度用掉");
  }
  // 真正记账之后才会被拦
  rateLimit(key, 3, 60_000);
  rateLimit(key, 3, 60_000);
  rateLimit(key, 3, 60_000);
  assert.equal(rateLimit(key, 3, 60_000, { increment: false }).ok, false);
});

test("resetRateLimit 清掉计数(登录成功后", () => {
  const key = uniqueKey("reset");
  rateLimit(key, 1, 60_000);
  assert.equal(rateLimit(key, 1, 60_000, { increment: false }).ok, false);
  resetRateLimit(key);
  assert.equal(rateLimit(key, 1, 60_000, { increment: false }).ok, true);
});
