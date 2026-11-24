/**
 * 完整备份的负载 —— **手动导出与每日自动备份共用这一份**。
 *
 * 此前两条路径各写一套,结果漂开了:自动备份还停在 version 1、不含任务/盘点/偏好,
 * 而手动导出已经是 version 2 —— 用户真要在灾难后恢复的那份,反而少东西。
 *
 * 日期字段一律导成 YYYY-MM-DD:直接序列化 Date 会得到 ISO 时间戳(本地零点 → UTC 前一天 16:00),
 * 恢复时按日期部分解析就会**平移一天** —— 到期日错一天对药品/食品是硬伤。
 */
import type { PrismaClient } from "@prisma/client";

export const BACKUP_VERSION = 2;

const toDateOnly = (value: Date | null) => (value ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : null);

export async function buildBackupPayload(prisma: PrismaClient) {
  const [items, locations, shopping, priceRecords, members, activities, tasks, audits, preferences] = await Promise.all([
    prisma.item.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.location.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.shoppingItem.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.priceRecord.findMany({ orderBy: { purchasedAt: "asc" } }),
    prisma.householdMember.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.activityLog.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.householdTask.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.auditRecord.findMany({ orderBy: { finishedAt: "asc" } }),
    prisma.householdPreference.findMany(),
  ]);
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    items: items.map((row) => ({ ...row, expiryDate: toDateOnly(row.expiryDate), purchaseDate: toDateOnly(row.purchaseDate) })),
    locations,
    shopping,
    priceRecords,
    members,
    activities,
    tasks,
    audits,
    preferences,
  };
}

/** 自动备份保留份数(默认 14 天);BACKUP_KEEP 可调。 */
export const BACKUP_KEEP = (() => {
  const raw = Number(process.env.BACKUP_KEEP ?? 14);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 14;
})();
