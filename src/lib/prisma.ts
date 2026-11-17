import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// SQLite 只有一个写者。Prisma 默认按 CPU 数开连接池,并发写会让后到的请求拿到
// SQLITE_BUSY 并最终以 P1008「Socket timeout」失败(实测 20 个并发创建会挂掉 12 个)。
// 这里显式把连接数压到 1 并放宽超时:写请求排队而不是失败;读只要十几毫秒,
// 对家庭应用这种量级完全够用。参数已存在时不重复追加。
function datasourceUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  if (raw.includes("connection_limit")) return raw;
  const separator = raw.includes("?") ? "&" : "?";
  return `${raw}${separator}connection_limit=1&socket_timeout=20`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: datasourceUrl(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
