// 「每周盘点」提醒。
//
// 这个偏好此前是个**死开关**:能存、能在设置里改、接口也返回,
// 但没有任何地方消费它 —— 打开之后什么都不会发生。
// 这里定义「今天是不是用户设定的盘点日」,由提醒中心据此给出入口。

/** 星期几的中文名(0 = 周日,与 Date.getDay() 一致) */
export const WEEKDAY_LABELS: Record<number, string> = {
  0: "周日",
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
};

export function weekdayLabel(day: number): string {
  return WEEKDAY_LABELS[day] ?? "";
}

export type WeeklyReviewPreference = {
  weeklyReviewEnabled: boolean;
  weeklyReviewDay: number;
};

/** 今天是不是用户设定的「每周盘点」日。 */
export function isWeeklyReviewDay(preference: WeeklyReviewPreference | null | undefined, now: Date = new Date()): boolean {
  if (!preference?.weeklyReviewEnabled) return false;
  const day = Number(preference.weeklyReviewDay);
  if (!Number.isInteger(day) || day < 0 || day > 6) return false;
  return now.getDay() === day;
}
