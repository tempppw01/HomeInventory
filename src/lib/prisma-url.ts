/**
 * 给 DATABASE_URL 补上连接池参数 —— **只对 SQLite 生效**。
 *
 * 为什么只给 SQLite:它只有一个写者,Prisma 默认按 CPU 数开连接池,并发写会让后到的请求
 * 拿到 SQLITE_BUSY 并最终以 P1008 失败(实测 20 个并发创建挂掉 12 个)。所以压到 1 条连接、放宽超时。
 * MySQL 不同:它能并发,强制 connection_limit=1 只会让请求排队 —— 不报错,但白丢并发。
 *
 * 已经带了 connection_limit 的 URL 原样返回(不覆盖用户/部署方的设置)。
 */
export function withPoolParams(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw.includes("connection_limit")) return raw;
  // 只有 SQLite(file: 前缀)才需要这套调参
  if (!raw.startsWith("file:")) return raw;
  const separator = raw.includes("?") ? "&" : "?";
  return `${raw}${separator}connection_limit=1&socket_timeout=20`;
}
