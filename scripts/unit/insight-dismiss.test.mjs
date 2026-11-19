// 「忽略建议」逻辑的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { insightKey, filterDismissed, addDismissed, parseDismissed } from "../../src/lib/insight-dismiss.ts";

const insight = (patch) => ({ kind: patch.kind ?? "restock", title: patch.title ?? "该补货了", itemId: patch.itemId ?? null });

test("键由「类型 + 物品」组成,与文案无关", () => {
  assert.equal(insightKey(insight({ kind: "restock", itemId: "abc" })), "restock:abc");
  assert.equal(insightKey(insight({ kind: "restock", itemId: "abc", title: "完全不同的说法" })), "restock:abc");
  assert.equal(insightKey({ title: "通用建议" }), "general:all");
  assert.equal(insightKey(insight({ itemId: null })), "restock:all");
});

test("过滤掉被忽略的建议,保持顺序", () => {
  const list = [insight({ itemId: "a" }), insight({ itemId: "b" }), insight({ itemId: "c" })];
  const kept = filterDismissed(list, ["restock:b"]);
  assert.deepEqual(kept.map((row) => row.itemId), ["a", "c"]);
});

test("没有忽略记录时原样返回", () => {
  const list = [insight({ itemId: "a" })];
  assert.deepEqual(filterDismissed(list, []), list);
});

test("忽略记录去重且保留最近 50 条", () => {
  assert.deepEqual(addDismissed(["a"], "a"), ["a"]);
  assert.deepEqual(addDismissed(["a", "b"], "a"), ["b", "a"]);
  const many = Array.from({ length: 60 }, (_, index) => `k${index}`);
  const next = addDismissed(many, "latest");
  assert.equal(next.length, 50);
  assert.equal(next.at(-1), "latest");
});

test("解析本地记录:坏数据当空数组", () => {
  assert.deepEqual(parseDismissed(null), []);
  assert.deepEqual(parseDismissed("not json"), []);
  assert.deepEqual(parseDismissed('{"a":1}'), []);
  assert.deepEqual(parseDismissed('["a",2,"b"]'), ["a", "b"]);
});