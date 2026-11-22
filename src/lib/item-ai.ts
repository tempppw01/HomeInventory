import type { Item } from "@/types";

function noteValue(notes: string | null, label: string) {
  if (!notes) return null;
  const line = notes.split(/\r?\n/).find((entry) => entry.trim().startsWith(`${label}：`) || entry.trim().startsWith(`${label}:`));
  return line?.replace(new RegExp(`^${label}[：:]\\s*`), "").trim() || null;
}

export function itemAiHighlights(item: Pick<Item, "notes" | "aiSummary" | "aiStorageAdvice" | "aiUsageAdvice" | "aiReplenishmentAdvice">) {
  const storage = item.aiStorageAdvice || noteValue(item.notes, "存储建议");
  const usage = item.aiUsageAdvice || noteValue(item.notes, "使用建议");
  const replenishment = item.aiReplenishmentAdvice || noteValue(item.notes, "补货建议");
  return {
    summary: item.aiSummary,
    storage,
    usage,
    replenishment,
    hasHighlights: Boolean(item.aiSummary || storage || usage || replenishment),
  };
}

/**
 * 详情页底部那块「AI 识别信息」是否还值得渲染。
 *
 * 它和上面的「AI 说」面板读同一批字段(aiSummary / aiStorageAdvice / …):
 * AI 摘要存在、三个建议也都来自 AI 字段时,两块内容一字不差 —— 同一个摘要要读两遍,
 * 页面还白长 520px(390px 实测 3020 → 2498)。只有底部这块能额外给出信息时才渲染它:
 * 没有 AI 摘要(没有「AI 说」面板),或者建议只存在于旧笔记里。
 */
export function aiHighlightsAddNewInfo(item: Pick<Item, "notes" | "aiSummary" | "aiStorageAdvice" | "aiUsageAdvice" | "aiReplenishmentAdvice">): boolean {
  const highlights = itemAiHighlights(item);
  if (!highlights.hasHighlights) return false;
  return (
    !item.aiSummary ||
    highlights.storage !== item.aiStorageAdvice ||
    highlights.usage !== item.aiUsageAdvice ||
    highlights.replenishment !== item.aiReplenishmentAdvice
  );
}
