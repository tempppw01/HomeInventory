// 盘点历史趋势 —— 把「每次盘点的确认率」变成一根根柱子。
//
// 盘点历史此前只以一句话显示「最近盘点:…」,看不出是在变好还是变差。
// 数据来自浏览器本地(每次结束盘点时写入),这里只做纯计算。

export type AuditHistoryEntry = { at: string; total: number; confirmed: number; locationName: string };

/** 确认率(0~1)。total 为 0 时返回 0,避免除零。 */
export function confirmRate(entry: AuditHistoryEntry): number {
  if (!entry.total) return 0;
  return Math.max(0, Math.min(1, entry.confirmed / entry.total));
}

/**
 * 最近若干次盘点的确认率序列(按时间正序,便于从左到右看趋势)。
 * 默认取最近 6 次;不足两次时返回空数组 —— 一个点画不出趋势。
 */
export function auditTrend(history: readonly AuditHistoryEntry[], take = 6): Array<{ label: string; value: number; total: number; confirmed: number }> {
  if (history.length < 2) return [];
  return [...history]
    .slice(0, take)
    .reverse()
    .map((entry) => {
      const date = new Date(entry.at);
      const label = Number.isNaN(date.getTime()) ? "?" : `${date.getMonth() + 1}/${date.getDate()}`;
      return { label, value: Math.round(confirmRate(entry) * 100), total: entry.total, confirmed: entry.confirmed };
    });
}

/** 趋势文案:比较最近两次,说清是变好还是变差。 */
export function auditTrendText(trend: ReadonlyArray<{ value: number }>): string | null {
  if (trend.length < 2) return null;
  const current = trend[trend.length - 1].value;
  const previous = trend[trend.length - 2].value;
  if (current === previous) return `最近两次都是 ${current}%`;
  const delta = current - previous;
  return `最近一次 ${current}%,比上次${delta > 0 ? "高" : "低"} ${Math.abs(delta)} 个百分点`;
}