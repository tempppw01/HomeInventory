// AI 结论过时判断的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { aiConclusionStale } from "../../src/lib/item-staleness.ts";

test("分析之后被改过 → 过时", () => {
  assert.equal(aiConclusionStale({ updatedAt: "2026-11-19T12:00:00", aiAnalyzedAt: "2026-11-19T10:00:00" }), true);
});

test("先改动、后分析 → 不过时", () => {
  assert.equal(aiConclusionStale({ updatedAt: "2026-11-19T10:00:00", aiAnalyzedAt: "2026-11-19T12:00:00" }), false);
});

test("从未分析过不算过时(那是「还没算」)", () => {
  assert.equal(aiConclusionStale({ updatedAt: "2026-11-19T12:00:00", aiAnalyzedAt: null }), false);
  assert.equal(aiConclusionStale({ updatedAt: "2026-11-19T12:00:00" }), false);
});

test("同一时刻不算过时(刚分析完不该提示)", () => {
  assert.equal(aiConclusionStale({ updatedAt: "2026-11-19T12:00:00", aiAnalyzedAt: "2026-11-19T12:00:00" }), false);
});

test("接受 Date 对象", () => {
  assert.equal(
    aiConclusionStale({ updatedAt: new Date("2026-11-19T12:00:00"), aiAnalyzedAt: new Date("2026-11-19T10:00:00") }),
    true,
  );
});

test("坏数据不崩", () => {
  assert.equal(aiConclusionStale({ updatedAt: "not-a-date", aiAnalyzedAt: "2026-11-19T10:00:00" }), false);
  assert.equal(aiConclusionStale({}), false);
});