// 相对时间文案 —— 纯函数,零依赖。
//
// 用来回答「这份 AI 结论是刚算的还是很久以前算的」,精确到分钟没有意义,
// 所以近处说「刚刚 / N 分钟前」,远处直接给日期。

export function relativeTimeText(value: string | Date | null | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;

  const diffMs = now.getTime() - time;
  // 未来时间(时区/时钟偏差)按「刚刚」处理,不要显示「-3 分钟前」这种怪话
  if (diffMs < 60_000) return "刚刚";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;

  return `${date.getMonth() + 1}/${date.getDate()}`;
}