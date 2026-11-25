// 图片解码失败的翻译单测:
//   npm run test:unit
//
// 由来(实测):损坏内容 / 零字节 / 像素超上限,三种情况此前都落成
// 500「服务器暂时开小差了」—— 用户只会反复重试。尤其像素超上限:
// 应用的上限是 4000 万像素,而很多手机的高像素模式一拍就超。

import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, sharpFailureMessage } from "../../src/lib/image-limits.ts";

test("像素超上限:说的是「像素太多」并给出上限,还点出手机高像素模式这个常见原因", () => {
  const message = sharpFailureMessage(new Error("Input image exceeds pixel limit"));
  assert.ok(message, "应该给出一条中文");
  assert.match(message, /像素/);
  assert.match(message, /4000 万/);
  assert.match(message, /手机/);
});

test("损坏 / 格式不认识:让用户换一张图,而不是让他等一会儿重试", () => {
  for (const raw of ["Input buffer contains unsupported image format", "premature end of file", "corrupt data"]) {
    const message = sharpFailureMessage(new Error(raw));
    assert.ok(message, `「${raw}」应该被翻译`);
    assert.match(message, /不是有效的图片/);
    assert.doesNotMatch(message, /稍后重试/);
  }
});

test("不认识的错误返回 null(交给通用处理,不假装什么都知道)", () => {
  assert.equal(sharpFailureMessage(new Error("ENOSPC: no space left on device")), null);
  assert.equal(sharpFailureMessage(new Error("boom")), null);
});

test("上限常量只有一处:5MB / 4000 万像素", () => {
  assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
  assert.equal(MAX_IMAGE_PIXELS, 40_000_000);
});