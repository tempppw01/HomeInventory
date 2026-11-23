// 本地日历日工具。
//
// 为什么不直接用 `new Date().toISOString().slice(0, 10)`:
// 那是 **UTC 日**。在东八区,UTC 的日界是早上 8 点 ——
// 于是 00:00~08:00 之间拿到的「今天」比用户的今天早一天:
//   · 凌晨录入物品 → 购买日期被记成昨天
//   · 今天到期的东西 → 被当成「还没到期」
//   · 导出文件名 / 自动备份标记 → 与用户看到的日期不一致
// 凡是给**人看**或按**用户的一天**判断的地方,都应该用本地日历日。

/** 把日期格式化成 `YYYY-MM-DD`(按本地时区取值,默认取当前时间)。 */
export function localDateString(value: Date = new Date()): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/**
 * 把「接口给的日期字符串」或 Date 转成本地 `YYYY-MM-DD`;**空值/非法返回空串**。
 *
 * 两种情况必须区分开:
 *   · 完整时间戳(2026-12-13T16:00:00.000Z = 本地 12-14 零点)→ 取**本地**那天;
 *   · 本来就是日期(2026-12-14,来自 CSV / 备份)→ 原样返回,
 *     否则按 UTC 零点解析在某些时区会往回退一天。
 */
export function localDateOf(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return localDateString(date);
}
