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
