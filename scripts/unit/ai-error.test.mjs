// 上游 AI 报错的统一解读。
//
// 起因是实测撞到的:批量识别用「图片链接」时报 400,而界面只显示「AI 接口请求失败(400)」——
// 上游其实说得清清楚楚(取不到这个 URL、要么用公开直链要么内联发送),但那条详情被扔掉了,
// 用户不知道该改什么。而且批量识别 / AI 助手两条路各写一份文案,单件分析又是第三份。
// 现在解读只有这一份,并且逐种情况钉住文案里有没有「接下来该做什么」。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { providerErrorDetail, providerFailure, isConnectionFailure, connectionFailureMessage, AiConnectionError } from "../../src/lib/ai-error.ts";

// 实测抓到的原文(deepseek 渠道拒绝远程图片链接时的 400 响应)
const imageUrlRejected = JSON.stringify({
  error: {
    message: "A file in this request could not be fetched from its URL, or could not be read. Use a publicly reachable http(s) URL to a file the model accepts, or send the file inline as a data: URL.",
    type: "invalid_request_error",
  },
});

test("图片链接取不到时,要直接告诉用户「下载后上传」而不是只报 400", () => {
  const message = providerFailure(400, imageUrlRejected);
  assert.match(message, /取不到这个图片链接/);
  assert.match(message, /下载/);
  assert.match(message, /公开可访问/);
  // 上游原文仍要保留,便于排查
  assert.match(message, /could not be fetched/);
});

test("上游换了个说法(unsupported_media / 只收 inline base64)也要认出是同一件事", () => {
  // 实测第二次复现时 deepseek 换成了这句话,靠猜措辞就会漏 —— 所以路由传上下文。
  const raw = JSON.stringify({ error: { message: "Upstream request failed: [unsupported_media] this model accepts text and inline (base64 data URL) images only" } });
  assert.match(providerFailure(400, raw), /取不到这个图片链接/);
  assert.match(providerFailure(400, "The model rejected this request as invalid.", { remoteImages: true }), /取不到这个图片链接/);
});

test("没带图片链接时,不把普通 400 误判成图片问题", () => {
  const message = providerFailure(400, JSON.stringify({ error: { message: "messages: too long" } }));
  assert.match(message, /AI 接口请求失败\(400\)/);
  assert.doesNotMatch(message, /图片链接/);
});

test("Key 不对 / 没权限:说清是 Key 的问题", () => {
  assert.match(providerFailure(401, JSON.stringify({ error: { message: "Invalid API key" } })), /API Key 无效或已过期/);
  assert.match(providerFailure(403, JSON.stringify({ error: { message: "Forbidden" } })), /没有访问当前模型的权限/);
});

test("限流与模型名写错也各有说法", () => {
  assert.match(providerFailure(429, "rate limited"), /限流/);
  assert.match(providerFailure(404, JSON.stringify({ error: { message: "model not found" } })), /检查模型名/);
});

test("没见过的错误:带上状态码与上游详情,不吞掉原因", () => {
  const message = providerFailure(500, JSON.stringify({ error: { message: "internal boom" } }));
  assert.match(message, /AI 接口请求失败\(500\)/);
  assert.match(message, /internal boom/);
});

test("上游返回 HTML 错误页时去掉标签", () => {
  const message = providerFailure(502, "<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>");
  assert.match(message, /502 Bad Gateway/);
  assert.doesNotMatch(message, /<h1>/);
});

test("上游什么都没说时给一句兜底,不留空", () => {
  assert.equal(providerErrorDetail(""), "上游接口未提供错误详情");
  assert.match(providerFailure(500, ""), /上游接口未提供错误详情/);
});

test("详情过长要截断(避免把整页响应塞进界面)", () => {
  const detail = providerErrorDetail(`{"error":{"message":"${"x".repeat(1000)}"}}`);
  assert.equal(detail.length, 400);
});

test("没有路由再自己拼失败文案(否则又会把上游详情丢掉)", () => {
  // 这次修的就是这件事:批量识别与 AI 助手各自写着 `AI 接口请求失败(${status})`,
  // 把上游给的原因整个扔掉。文案只允许来自 providerFailure。
  const routes = [
    "src/app/api/ai/batch-identify/route.ts",
    "src/app/api/ai/chat/route.ts",
    "src/app/api/ai/analyze-item/route.ts",
    "src/app/api/settings/ai/models/route.ts",
  ];
  for (const route of routes) {
    const text = readFileSync(route, "utf8");
    assert.doesNotMatch(text, /`AI 接口请求失败/, `${route} 又自己拼了失败文案 —— 应改用 providerFailure`);
  }
});
test("网络层连不上的识别与文案:要能照做,不能只说「失败了」", () => {
  const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  const dns = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
  const businessError = new Error("AI 没有返回回答");

  assert.equal(isConnectionFailure(refused), true);
  assert.equal(isConnectionFailure(dns), true);
  assert.equal(isConnectionFailure(businessError), false);

  const message = connectionFailureMessage(refused, "http://127.0.0.1:9/v1/chat/completions");
  assert.match(message, /连不上 AI 接口/);
  assert.match(message, /接口地址/);
  assert.match(message, /127\.0\.0\.1:9/);
});

test("AiConnectionError 的 name 能被 apiError 认出来(它是 502 分支的判据)", () => {
  const error = new AiConnectionError("连不上 AI 接口(x)");
  assert.equal(error.name, "AiConnectionError");
  assert.equal(error.detail, "连不上 AI 接口(x)");
});

test("四个会调用上游的 AI 路由都必须有限流(实测 insights 曾漏掉)", () => {
  for (const route of [
    "src/app/api/ai/batch-identify/route.ts",
    "src/app/api/ai/chat/route.ts",
    "src/app/api/ai/analyze-item/route.ts",
    "src/app/api/ai/insights/route.ts",
  ]) {
    const text = readFileSync(route, "utf8");
    assert.match(text, /rateLimit\(/, `${route} 没有限流 —— 用户自填的 Key 会被循环调用烧掉`);
  }
});
