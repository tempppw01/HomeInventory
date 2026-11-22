// 物品详情页「AI 说」面板与底部「AI 识别信息」块的同源判定。
//
// 这两块读的是同一批字段(aiSummary / aiStorageAdvice / …)。摘要存在时两块内容一字不差,
// 页面上同一个摘要要读两遍、还要多滚一屏,所以底部那块只在能额外给出信息时才渲染。
import { test } from "node:test";
import assert from "node:assert/strict";

import { itemAiHighlights, aiHighlightsAddNewInfo } from "../../src/lib/item-ai.ts";

const full = {
  notes: null,
  aiSummary: "可口可乐罐装为可消耗饮品,现有 6 罐。",
  aiStorageAdvice: "阴凉干燥避光。",
  aiUsageAdvice: "先进先出。",
  aiReplenishmentAdvice: "余量过半再补。",
};

test("AI 摘要与三条建议都来自 AI 时,底部那块不再渲染(避免重复一整段)", () => {
  assert.equal(itemAiHighlights(full).hasHighlights, true);
  assert.equal(aiHighlightsAddNewInfo(full), false);
});

test("只有 AI 摘要、三条建议都在笔记里时,底部那块要渲染(它以旧笔记为来源,不重复)", () => {
  const item = {
    ...full,
    aiStorageAdvice: null,
    aiUsageAdvice: null,
    aiReplenishmentAdvice: null,
    notes: "存储建议:冷藏\n使用建议:开封后 3 天喝完\n补货建议:见底再买",
  };
  const highlights = itemAiHighlights(item);
  assert.equal(highlights.storage, "冷藏");
  assert.equal(aiHighlightsAddNewInfo(item), true);
});

test("没有 AI 摘要时,底部那块照常渲染(此时没有「AI 说」面板可读)", () => {
  const item = { notes: null, aiSummary: null, aiStorageAdvice: "常温即可。", aiUsageAdvice: null, aiReplenishmentAdvice: null };
  assert.equal(aiHighlightsAddNewInfo(item), true);
});

test("什么 AI 信息都没有时两块都不渲染", () => {
  const empty = { notes: null, aiSummary: null, aiStorageAdvice: null, aiUsageAdvice: null, aiReplenishmentAdvice: null };
  assert.equal(itemAiHighlights(empty).hasHighlights, false);
  assert.equal(aiHighlightsAddNewInfo(empty), false);
});

test("建议内容与 AI 字段完全一致时不渲染;只要有一条不同就渲染(不吞掉信息)", () => {
  const same = { ...full };
  assert.equal(aiHighlightsAddNewInfo(same), false);
  // 笔记里有一条 AI 没给的建议 → 底部那块仍然有新内容
  const extra = { ...full, aiUsageAdvice: null, notes: "使用建议:先给孩子喝" };
  assert.equal(aiHighlightsAddNewInfo(extra), true);
});
