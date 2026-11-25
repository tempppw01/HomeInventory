// 空间层级环检测的单测。
//   npm run test:unit
//
// 由来(实测,修之前):服务端只查了「父的父是不是自己」这一层。
// 于是 厨房 → 橱柜 → 抽屉 之后,把厨房的上级设成**抽屉**会被放行,
// 变成绕不完的环 —— 界面下拉框把除自己以外的空间都列出来,所以一次编辑就能造成。
// 后果:空间卡片上的路径开始重复(实测「抽屉 / 橱柜 / 厨房」重复三遍,被 16 层护栏截断)。

import { test } from "node:test";
import assert from "node:assert/strict";

import { wouldFormLocationCycle } from "../../src/lib/location-tree.ts";

const nodes = (...pairs) => pairs.map(([id, parentId]) => ({ id, parentId }));

test("设成顶级(null)永远不会成环", () => {
  const tree = nodes(["a", "b"], ["b", null]);
  assert.equal(wouldFormLocationCycle(tree, "a", null), false);
  assert.equal(wouldFormLocationCycle(tree, "a", undefined), false);
  assert.equal(wouldFormLocationCycle(tree, "a", ""), false);
});

test("自己当自己的上级 → 环", () => {
  assert.equal(wouldFormLocationCycle(nodes(["a", null]), "a", "a"), true);
});

test("直接把上级设成自己的子空间 → 环(A→B,再把 A 的上级设成 B)", () => {
  assert.equal(wouldFormLocationCycle(nodes(["a", null], ["b", "a"]), "a", "b"), true);
});

test("把孙子设成上级 → 环(修之前这条被放行:厨房→橱柜→抽屉,再把厨房的上级设成抽屉)", () => {
  const tree = nodes(["厨房", null], ["橱柜", "厨房"], ["抽屉", "橱柜"]);
  assert.equal(wouldFormLocationCycle(tree, "厨房", "抽屉"), true);
  // 四层也一样
  const deep = nodes(["l1", null], ["l2", "l1"], ["l3", "l2"], ["l4", "l3"]);
  assert.equal(wouldFormLocationCycle(deep, "l1", "l4"), true);
});

test("正常调整层级不会被误伤", () => {
  const tree = nodes(["厨房", null], ["橱柜", "厨房"], ["抽屉", "橱柜"], ["储物间", null]);
  // 把抽屉挪到储物间下
  assert.equal(wouldFormLocationCycle(tree, "抽屉", "储物间"), false);
  // 把橱柜提成顶级
  assert.equal(wouldFormLocationCycle(tree, "橱柜", null), false);
  // 把储物间放到最深一层下面
  assert.equal(wouldFormLocationCycle(tree, "储物间", "抽屉"), false);
});

test("不存在的上级不算环(由接口另行报「上级空间不存在」)", () => {
  assert.equal(wouldFormLocationCycle(nodes(["a", null]), "a", "不在库里"), false);
});

test("库里已经有环时不会原地打转,而是判为环(不写更多脏数据)", () => {
  // 老数据里就存在的三节点环:a→b→c→a
  const broken = nodes(["a", "c"], ["b", "a"], ["c", "b"]);
  assert.equal(wouldFormLocationCycle(broken, "d", "a"), true);
  // 即使编辑的是环外的节点也一样
  const withNew = nodes(["a", "c"], ["b", "a"], ["c", "b"], ["d", null]);
  assert.equal(wouldFormLocationCycle(withNew, "d", "b"), true);
});