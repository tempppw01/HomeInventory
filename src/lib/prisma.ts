import { PrismaClient } from "@prisma/client";
import { withPoolParams } from "@/lib/prisma-url";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// 连接池调参只对 SQLite 生效(它只有一个写者);MySQL 能并发,不该被压成 1 条连接。
// 具体规则与理由见 lib/prisma-url.ts。
const datasourceUrl = () => withPoolParams(process.env.DATABASE_URL);
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: datasourceUrl(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
