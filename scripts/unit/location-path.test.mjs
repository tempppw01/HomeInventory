// 空间路径解析的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseLocationPath, formatLocationPath, locationSegmentsById, resolveLocationPaths } from "../../src/lib/location-path.ts";

test("路径解析容忍全角斜杠与多余空格", () => {
  assert.deepEqual(parseLocationPath("厨房/吊柜"), ["厨房", "吊柜"]);
  assert.deepEqual(parseLocationPath(" 厨房 ／ 吊柜 "), ["厨房", "吊柜"]);
  assert.deepEqual(parseLocationPath(""), []);
  assert.deepEqual(parseLocationPath("///"), []);
});

test("路径拼接用 / 且不带空格(便于再次解析)", () => {
  assert.equal(formatLocationPath(["厨房", "吊柜"]), "厨房/吊柜");
  assert.equal(formatLocationPath(["厨房", "", "吊柜"]), "厨房/吊柜");
});

const LOCATIONS = [
  { id: "k", name: "厨房", parentId: null },
  { id: "b", name: "吊柜", parentId: "k" },
  { id: "y", name: "阳台", parentId: null },
  { id: "yb", name: "吊柜", parentId: "y" },
];

test("同名子空间在不同父级下是不同路径", () => {
  const segments = locationSegmentsById(LOCATIONS);
  assert.deepEqual(segments.get("b"), ["厨房", "吊柜"]);
  assert.deepEqual(segments.get("yb"), ["阳台", "吊柜"]);
});

test("已存在的路径直接给出 id,不产生创建", () => {
  const plan = resolveLocationPaths(LOCATIONS, ["厨房/吊柜", "阳台/吊柜"]);
  assert.equal(plan.pathToId.get("厨房/吊柜"), "b");
  assert.equal(plan.pathToId.get("阳台/吊柜"), "yb");
  assert.equal(plan.creations.length, 0);
});

test("缺失的层级按父在前排成创建计划", () => {
  const plan = resolveLocationPaths(LOCATIONS, ["厨房/抽屉/上层"]);
  assert.deepEqual(plan.creations.map((row) => `${row.parentPath}|${row.name}`), [
    "厨房|抽屉",
    "厨房/抽屉|上层",
  ]);
});

test("同一路径在多次请求中只排一次", () => {
  const plan = resolveLocationPaths(LOCATIONS, ["厨房/抽屉", "厨房/抽屉", "厨房/抽屉"]);
  assert.equal(plan.creations.length, 1);
});

test("扁平名字仍然可用(没有斜杠时就是一级)", () => {
  const plan = resolveLocationPaths(LOCATIONS, ["卫生间"]);
  assert.deepEqual(plan.creations.map((row) => row.path), ["卫生间"]);
  assert.equal(plan.creations[0].parentPath, "");
});

test("层级过深或空路径记入问题", () => {
  const deep = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].join("/");
  const plan = resolveLocationPaths([], [deep, "  "]);
  assert.equal(plan.issues.length, 2);
  assert.match(plan.issues[0].error, /层级太深/);
});