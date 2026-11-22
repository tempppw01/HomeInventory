// ListRow 的「trailing 里有没有控件」判定。
//
// 这是提醒中心那次事故的根因所在:整行是 <button>,trailing 又放了「处理掉」按钮,
// 渲染成 <button> 里套 <button> —— React 报 hydration 错误,点「处理掉」还会
// 冒泡触发整行的 onClick(移入回收站 + 编辑物品两个弹窗一起弹)。
// 判定错了就等于又把 hydration 错误放回来,所以这里逐种形状钉住。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, Fragment } from "react";

import { hasInteractiveNode } from "../../src/lib/interactive-nesting.ts";

test("trailing 是按钮时必须判定为控件(提醒中心的「处理掉」)", () => {
  assert.equal(hasInteractiveNode(createElement("button", { type: "button" }, "处理掉")), true);
});

test("trailing 是下拉 / 数字输入时必须判定为控件(打印工作室那些设置行)", () => {
  assert.equal(hasInteractiveNode(createElement("select", null, createElement("option", null, "A4"))), true);
  assert.equal(hasInteractiveNode(createElement("input", { type: "number" })), true);
  assert.equal(hasInteractiveNode(createElement("a", { href: "/x" }, "链接")), true);
});

test("控件藏在 <span> 或 Fragment 里也要认出来(概览最近更新的两个图标按钮)", () => {
  assert.equal(hasInteractiveNode(createElement("span", { className: "flex" }, createElement("button", null, "AI"))), true);
  assert.equal(hasInteractiveNode(createElement(Fragment, null, createElement("span", null, "共 6 罐"), createElement("button", null, "二维码"))), true);
  assert.equal(hasInteractiveNode([createElement("button", null, "AI")]), true);
});

test("只有 onClick 的 span 同样是控件 —— 鼠标可点但没有键盘入口,不能留在整行按钮里", () => {
  assert.equal(hasInteractiveNode(createElement("span", { onClick: () => {} }, "点我")), true);
});

test("自定义组件接了 onClick 就当它是控件(Button / Chip)", () => {
  const Fake = (props) => createElement("span", null, props.children);
  assert.equal(hasInteractiveNode(createElement(Fake, { onClick: () => {} }, "保存")), true);
});

test("纯文字、纯图标、数字这些不算控件(盘点的数量胶囊要留在按钮里)", () => {
  assert.equal(hasInteractiveNode(createElement("span", { className: "tabular-nums" }, "6 罐")), false);
  assert.equal(hasInteractiveNode(createElement("span", null, createElement("svg", null, createElement("path", null)))), false);
  assert.equal(hasInteractiveNode("6 罐"), false);
  assert.equal(hasInteractiveNode(0), false);
  assert.equal(hasInteractiveNode(null), false);
  assert.equal(hasInteractiveNode(undefined), false);
  assert.equal(hasInteractiveNode(false), false);
  assert.equal(hasInteractiveNode([]), false);
  // 没有 trailing 的行(只有 icon + 标题)不受影响
  assert.equal(hasInteractiveNode(createElement(Fragment, null)), false);
});
