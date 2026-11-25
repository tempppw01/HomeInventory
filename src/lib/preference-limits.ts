// 偏好设置的取值范围 —— 设置接口与「恢复备份」共用一份。
//
// 由来(实测,修之前):界面上这两项是「提前 1~90 天提醒」「每周盘点 0~6(周一~周日)」,
// 设置接口也照着拒(返回 400)。但**恢复备份**那条路只查了 `Number.isFinite`,
// 于是一份 `expiryReminderDays: -3, weeklyReviewDay: 99` 的备份被原样写进库:
// 临期提醒窗口变成负数 → 家里有快过期的东西也不再提醒;每周盘点落在一个不存在的星期。
// 所以范围只写在这里:表单校验、设置接口、恢复备份都从这份取,不再有第二个定义。

export type PreferenceRange = { min: number; max: number; fallback: number };

export const PREFERENCE_LIMITS = {
  /** 提前多少天开始提醒到期 */
  expiryReminderDays: { min: 1, max: 90, fallback: 7 },
  /** 每周盘点放在周几(0 = 周一 … 6 = 周日,与 Date#getDay 无关,界面按此顺序排) */
  weeklyReviewDay: { min: 0, max: 6, fallback: 0 },
} as const satisfies Record<string, PreferenceRange>;

/**
 * 把外部来的数字夹到合法范围。
 * 不是数字/无穷 → 用默认值;小数 → 四舍五入;越界 → 夹到边界。
 * 恢复备份时用「夹」而不是「整条拒绝」:偏好只有这四项,修好其中越界的那一项,别把合法的也丢掉。
 */
export function clampPreferenceInt(value: unknown, range: PreferenceRange): number {
  // 注意 null / undefined / 空串要走默认值:**不能**交给 Number():
  // Number(null) 是 0、Number("") 也是 0,会被当成「用户填了 0」再夹到下限(单测抓到的就是这个)。
  if (value === null || value === undefined || value === "") return range.fallback;
  const asNumber = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(asNumber)) return range.fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(asNumber)));
}