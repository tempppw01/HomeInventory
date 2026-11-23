// encodeJsonResponse 的单测(纯函数,不依赖 Next)。
//
// 这里的价值在于把「什么情况下压、什么情况下不压」钉死:
// 该压不压是性能问题,小响应也压是白花 CPU,
// 而**没声明 vary** 会让中间缓存把压缩版喂给不接受 gzip 的客户端 —— 那是正确性问题。

import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";

import { encodeJsonResponse } from "../../src/lib/json-compression.ts";

const textOf = (encoded) => (encoded.compressed ? gunzipSync(encoded.body).toString() : encoded.body);

const bigPayload = {
  items: Array.from({ length: 400 }, (_, index) => ({
    id: `id-${index}`,
    name: `物品名称 ${index}`,
    category: "食品",
    notes: "一些重复出现的文本,用来让 gzip 有东西可压",
  })),
};
const smallPayload = { ok: true };

test("大响应 + 客户端接受 gzip:压,并且明显更小", () => {
  const encoded = encodeJsonResponse(bigPayload, "gzip, deflate, br");
  assert.equal(encoded.compressed, true);
  assert.equal(encoded.headers["content-encoding"], "gzip");
  const raw = JSON.stringify(bigPayload).length;
  const wire = Number(encoded.headers["content-length"]);
  assert.equal(wire, encoded.body.length);
  assert.ok(wire < raw / 3, `压缩后应当明显更小(原始 ${raw} → 传输 ${wire})`);
  assert.deepEqual(JSON.parse(textOf(encoded)), bigPayload, "解压后必须与原文逐字节等价");
});

test("客户端没说要 gzip:不压(否则它解不开)", () => {
  for (const accept of ["identity", "", null, undefined, "deflate, br"]) {
    const encoded = encodeJsonResponse(bigPayload, accept);
    assert.equal(encoded.compressed, false, `accept-encoding=${JSON.stringify(accept)} 时不该压`);
    assert.equal(encoded.headers["content-encoding"], undefined);
    assert.deepEqual(JSON.parse(textOf(encoded)), bigPayload);
  }
});

test("小响应不压:套一层 gzip 只是白花 CPU、多一个头部", () => {
  const encoded = encodeJsonResponse(smallPayload, "gzip");
  assert.equal(encoded.compressed, false);
  assert.equal(textOf(encoded), JSON.stringify(smallPayload));
});

test("无论压不压都声明 vary: accept-encoding(否则缓存会串味)", () => {
  for (const accept of ["gzip", "identity"]) {
    assert.match(encodeJsonResponse(bigPayload, accept).headers.vary, /accept-encoding/i);
  }
  assert.match(encodeJsonResponse(smallPayload, "gzip").headers.vary, /accept-encoding/i);
});

test("始终是 application/json,并且能带上调用方自己的状态码与头部", () => {
  const created = encodeJsonResponse({ error: "x" }, "gzip", { status: 400, headers: { "x-probe": "1" } });
  assert.equal(created.status, 400);
  assert.equal(created.headers["content-type"], "application/json");
  assert.equal(created.headers["x-probe"], "1");
  assert.match(created.headers.vary, /accept-encoding/i);
});

test("默认 200;不压时不写 content-length(交给运行时)", () => {
  const ok = encodeJsonResponse({ a: 1 }, "gzip");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers["content-length"], undefined);
});
