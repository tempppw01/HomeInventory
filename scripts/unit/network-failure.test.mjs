// 「失败提示」翻译的单测:
//   npm run test:unit
//
// 守的是用户离线时看到的那一句话。2026-11-28 真机实测:断网点「加入清单」得到的是
//   「网络响应不完整,请重试;已保存的内容不会丢失」
// 而请求根本没发出去(net::ERR_INTERNET_DISCONNECTED)、队列 0 条 —— 原因说错、承诺说过头,
// 还让人反复点一个当前必然失败的动作。这三条断言就是把这种话钉死。
import { test } from "node:test";
import assert from "node:assert/strict";

import { networkFailureMessage, OFFLINE_WRITE_MESSAGE } from "../../src/lib/network-failure.ts";

test("断网时说「离线」,并且不说「已保存」", () => {
  const message = networkFailureMessage("Failed to fetch", false);
  assert.equal(message, OFFLINE_WRITE_MESSAGE);
  assert.match(message, /离线/);
  assert.doesNotMatch(message, /已保存/);
});

test("浏览器的各种网络层报错都认得出来(不能只认 Chromium 那句)", () => {
  for (const raw of [
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
    "net::ERR_INTERNET_DISCONNECTED",
    "net::ERR_CONNECTION_REFUSED",
  ]) {
    assert.equal(networkFailureMessage(raw, false), OFFLINE_WRITE_MESSAGE, `没认出来:${raw}`);
  }
});

test("在线但连不上服务器:让人稍后重试,而不是说响应不完整", () => {
  const message = networkFailureMessage("Failed to fetch", true);
  assert.match(message, /没(能)?连上服务器|稍后重试/);
  assert.doesNotMatch(message, /已保存/);
});

test("响应被截断才说「已保存的内容不会丢失」(服务端很可能已经处理了)", () => {
  assert.match(networkFailureMessage("content-length mismatch", true), /已保存的内容不会丢失/);
});

test("服务端自己给的错误原样放行(不能翻译成网络问题)", () => {
  for (const raw of ["名称不能为空", "登录已过期,请刷新页面后重新登录", "物品不存在"]) {
    assert.equal(networkFailureMessage(raw, true), null, `被误翻译:${raw}`);
    assert.equal(networkFailureMessage(raw, false), null, `离线时被误翻译:${raw}`);
  }
});

test("离线也不会把服务端错误说成「这一项还没保存」", () => {
  // 离线时理论上收不到服务端错误;真出现了也必须原样抛,别改写用户已看到的语义。
  assert.equal(networkFailureMessage("没有权限执行这个操作", false), null);
});
