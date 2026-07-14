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
