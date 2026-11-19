// AI 结论是否已过时 —— 纯函数,零依赖。
//
// 物品改了(数量、到期、备注…),之前生成的结论就不再准确。
// 这里只做判断,不涉及任何 UI,便于单测。

export type StalenessInput = {
  updatedAt?: string | Date | null;
  aiAnalyzedAt?: string | Date | null;
};

function timeOf(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * 结论是否已过时。
 * - 没有分析过:返回 false(这不是「过时」,是「还没算」,界面用另一种方式表达)
 * - 分析过且之后被改动过:返回 true
 * - 时间相等(同一秒内写入):不算过时,避免刚分析完就提示过时
 */
export function aiConclusionStale(input: StalenessInput): boolean {
  const updated = timeOf(input.updatedAt);
  const analyzed = timeOf(input.aiAnalyzedAt);
  if (updated === null || analyzed === null) return false;
  return updated > analyzed;
}
