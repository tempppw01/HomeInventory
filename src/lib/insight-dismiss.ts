// AI 建议的「忽略」逻辑 —— 纯函数,零依赖。
//
// 建议是模型生成的,每次文案略有不同,所以不能用文案当键:
// 用「kind + 物品」做稳定标识,同一条建议换个说法也还是同一条。

export type DismissibleInsight = { kind?: string; title: string; itemId?: string | null };

/** 建议的稳定标识:同一类建议作用在同一件物品上,就算同一条。 */
export function insightKey(insight: DismissibleInsight): string {
  return `${insight.kind ?? "general"}:${insight.itemId ?? "all"}`;
}

/** 过滤掉被忽略的建议;保持原顺序。 */
export function filterDismissed<T extends DismissibleInsight>(insights: readonly T[], dismissed: readonly string[]): T[] {
  if (!dismissed.length) return [...insights];
  const hidden = new Set(dismissed);
  return insights.filter((insight) => !hidden.has(insightKey(insight)));
}

/** 记录一次忽略(去重,最多保留 50 条,避免无限增长)。 */
export function addDismissed(dismissed: readonly string[], key: string): string[] {
  const next = [...dismissed.filter((entry) => entry !== key), key];
  return next.slice(-50);
}

/** 解析本地存的记录:非法内容一律当作空。 */
export function parseDismissed(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string").slice(-50) : [];
  } catch {
    return [];
  }
}