// 家庭任务的重复周期 —— 纯函数,便于单测。
//
// 之前只有 每天/每周/每月/每年,而应用自己举的例子是「每 3 个月清洁一次洗衣机」,
// 用户根本选不到这个周期。这里补上每季度与每半年,并把推进逻辑集中到一处。

export type TaskRecurrence = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY";

export const TASK_RECURRENCES: readonly TaskRecurrence[] = ["NONE", "DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"];

export const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  NONE: "一次性",
  DAILY: "每天",
  WEEKLY: "每周",
  MONTHLY: "每月",
  QUARTERLY: "每 3 个月",
  HALF_YEARLY: "每半年",
  YEARLY: "每年",
};

export function isTaskRecurrence(value: unknown): value is TaskRecurrence {
  return typeof value === "string" && (TASK_RECURRENCES as readonly string[]).includes(value);
}

/**
 * 完成一次后,下一次到期时间。
 * 月末用 setMonth 会溢出(1/31 + 1 个月 → 3/3),所以先把日期夹到目标月的最后一天再设置。
 */
export function nextDueDate(from: Date, recurrence: TaskRecurrence | string): Date {
  const next = new Date(from);
  const addMonths = (months: number) => {
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + months);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, lastDay));
  };

  switch (recurrence) {
    case "DAILY": next.setDate(next.getDate() + 1); break;
    case "WEEKLY": next.setDate(next.getDate() + 7); break;
    case "MONTHLY": addMonths(1); break;
    case "QUARTERLY": addMonths(3); break;
    case "HALF_YEARLY": addMonths(6); break;
    case "YEARLY": next.setFullYear(next.getFullYear() + 1); break;
    default: break; // NONE 与未知值:不动
  }
  return next;
}