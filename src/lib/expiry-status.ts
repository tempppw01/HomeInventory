// 到期状态:一份判定,多处共用。
//
// 起因:同一个「临期/过期」概念散落在 6 处,且**边界语义不一致**:
//   · 概览与提醒中心把「今天到期」(天数 = 0)算进**已过期**
//   · 物品详情页却把今天当成「警告」而不是「危险」
//   · 临期阈值有的写 30、有的写 7;AI 洞察用的是毫秒差(< 7 天),与「≤ 7 天」不等价
// 文案里明明区分了「今天到期」和「已过期 N 天」,所以今天不该算过期。

/** 临期窗口(天):还剩这么多天以内就算临期 */
export const EXPIRING_SOON_DAYS = 30;

/**
 * 距离「本地自然日」还有几天(负数=已过期几天)。
 *
 * 关键是**两侧都要先归到本地那一天的 00:00**,不能拿原始时间戳相减:
 * 保质期存的是本地 00:00(本地 11-24 = 2026-11-23T16:00:00Z),直接相减的话
 * 一件今天到期的东西在中午 12 点之后就会算成 -1(提示「已过期 1 天」),
 * 而明天到期的东西在傍晚会算成 0(提示「今天到期」)。
 * 应用里其它地方(shared.tsx 的 expiryDays)用的就是这个口径,这里保持一致。
 */
export function daysUntilLocalDay(dateLike: Date | string | number, now: Date | string | number = Date.now()): number {
  const target = new Date(dateLike);
  const today = new Date(now);
  if (Number.isNaN(target.getTime()) || Number.isNaN(today.getTime())) return Number.NaN;
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((startOfTarget - startOfToday) / 86400000);
}

/** 紧急窗口(天):概览「本周到期」用 */
export const EXPIRING_URGENT_DAYS = 7;

/** 还剩几天到期:0 = 今天,负数 = 已过期。 */
export type ExpiryDays = number;

/** 已过期:只有**过了今天**才算(今天到期不算过期)。 */
export function isExpiredDays(days: ExpiryDays): boolean {
  return days < 0;
}

/** 临期:今天起、窗口内。今天到期属于临期里最紧迫的一档。 */
export function isExpiringSoonDays(days: ExpiryDays, window = EXPIRING_SOON_DAYS): boolean {
  return days >= 0 && days <= window;
}

/** 紧急临期(本周内到期,含今天)。 */
export function isExpiringUrgentDays(days: ExpiryDays): boolean {
  return isExpiringSoonDays(days, EXPIRING_URGENT_DAYS);
}

/**
 * 落在到期窗口内(**含已过期**)—— 月报那份列表用的是这个:
 * 它把临期与已过期放在一起,再由调用方标记哪条已经过期。
 * 注意别用 isExpiringSoonDays 替代:那个要求 days >= 0,会把已过期的条目丢掉。
 */
export function isWithinExpiryWindowDays(days: ExpiryDays, window = EXPIRING_SOON_DAYS): boolean {
  return days <= window;
}

/** 界面色调:已过期用危险色、临期用警示色、其余不上色。 */
export function expiryToneFor(days: ExpiryDays | null): "danger" | "warning" | undefined {
  if (days === null) return undefined;
  if (isExpiredDays(days)) return "danger";
  if (isExpiringSoonDays(days)) return "warning";
  return undefined;
}

/**
 * 把「还有几天」说成人话。
 *
 * 为什么需要它:界面里多处自己拼天数,而且习惯性写成 `${Math.max(0, days)} 天后…` ——
 * 于是出现了「0 天后到期」「还有 0 天」这种句子(概览卡片与月报里都出现过)。
 * 0 与负数必须单独说:今天到期 / 明天到期 / 已过期 N 天。
 */
export function inDaysPhrase(days: number, action: "到期" | "用完" | "" = "到期", approximate = false): string {
  const prefix = approximate && days > 1 ? "约 " : "";
  if (days < 0) {
    if (action === "到期") return `已过期 ${Math.abs(days)} 天`;
    if (action === "用完") return "已经用完";
    return `已过去 ${Math.abs(days)} 天`;
  }
  if (days === 0) return action ? `今天${action}` : "今天";
  if (days === 1) return action ? `明天${action}` : "明天";
  return `${prefix}${days} 天后${action}`;
}
