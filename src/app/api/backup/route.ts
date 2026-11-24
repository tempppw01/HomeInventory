import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireAdminUser } from "@/lib/api";
import { localDateString } from "@/lib/local-date";

// 日期字段导出成 YYYY-MM-DD。
// 直接序列化 Date 会得到 ISO 时间戳(本地零点 → UTC 前一天 16:00),
// 恢复时按日期部分解析就会**平移一天** —— 到期日错一天对药品/食品是硬伤。
const toDateOnly = (value: Date | null) => (value ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : null);
export const dynamic = "force-dynamic";

/** Export user data without credentials or AI/OSS secrets. */
export async function GET() {
  try {
    await requireAdminUser();
    const [items, locations, shopping, priceRecords, members, activities, tasks, audits, preferences] = await Promise.all([
      prisma.item.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.location.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.shoppingItem.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.priceRecord.findMany({ orderBy: { purchasedAt: "asc" } }),
      prisma.householdMember.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.activityLog.findMany({ orderBy: { createdAt: "asc" } }),
      // 任务 / 盘点记录 / 偏好设置此前**根本没有进备份** —— 换机恢复时会静默丢掉这三样。
      prisma.householdTask.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.auditRecord.findMany({ orderBy: { finishedAt: "asc" } }),
      prisma.householdPreference.findMany(),
    ]);
    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      items: items.map((row) => ({
        ...row,
        expiryDate: toDateOnly(row.expiryDate),
        purchaseDate: toDateOnly(row.purchaseDate),
      })),
      locations,
      shopping,
      priceRecords,
      members,
      activities,
      tasks,
      audits,
      preferences,
    };
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename=home-inventory-backup-${localDateString()}.json`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
