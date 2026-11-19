import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { getAiConfig } from "@/lib/ai";
import { monthlyBuckets } from "@/lib/chart";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser();
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const [items, locations, shopping, priceRecords, consumptionLogs, preferences, tasks] = await Promise.all([
      prisma.item.findMany({ where: { deletedAt: null }, include: { location: true }, orderBy: { updatedAt: "desc" } }),
      prisma.location.findMany({ include: { parent: { select: { id: true, name: true } }, _count: { select: { items: true } } }, orderBy: { createdAt: "asc" } }),
      prisma.shoppingItem.findMany({ orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }] }),
      prisma.priceRecord.findMany({ where: { purchasedAt: { gte: sixMonthStart } }, orderBy: { purchasedAt: "desc" } }),
      prisma.activityLog.findMany({ where: { action: "CONSUME", undoneAt: null }, select: { itemName: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 500 }),
      prisma.householdPreference.upsert({ where: { id: "default" }, create: {}, update: {} }),
      prisma.householdTask.findMany({ where: { status: "OPEN" }, orderBy: { dueAt: "asc" }, take: 8 }),
    ]);

    // 每件物品最近一次 AI 分析的时间:物品列表据此提示「结论已过时」。
    const aiAnalyzedAtMap = new Map<string, Date>(
      (await prisma.activityLog.groupBy({ by: ["itemId"], where: { action: "AI_ANALYZE", itemId: { not: null } }, _max: { createdAt: true } }))
        .flatMap((row) => (row.itemId && row._max.createdAt ? [[row.itemId, row._max.createdAt] as [string, Date]] : [])),
    );
    const itemsWithAiTime = items.map((item) => ({ ...item, aiAnalyzedAt: aiAnalyzedAtMap.get(item.id)?.toISOString() ?? null }));

    const sixMonthTotal = priceRecords.reduce((sum, record) => sum + record.totalPrice, 0);
    const currentMonthTotal = priceRecords.filter((record) => record.purchasedAt >= currentMonthStart).reduce((sum, record) => sum + record.totalPrice, 0);
    // 近 6 个月支出序列:前端直接画柱状图,不在浏览器里再聚合一遍。
    const monthly = monthlyBuckets(priceRecords, now, 6).map((row) => ({ label: row.label, value: row.total }));

    const categoryTotals = new Map<string, number>();
    priceRecords.filter((record) => record.purchasedAt >= currentMonthStart).forEach((record) => categoryTotals.set(record.category, (categoryTotals.get(record.category) || 0) + record.totalPrice));
    const consumption = new Map<string, { itemName: string; count: number; lastUsedAt: string }>();
    consumptionLogs.forEach((entry) => {
      if (!entry.itemName) return;
      const previous = consumption.get(entry.itemName);
      consumption.set(entry.itemName, { itemName: entry.itemName, count: (previous?.count || 0) + 1, lastUsedAt: previous?.lastUsedAt || entry.createdAt.toISOString() });
    });
    return NextResponse.json({
      items: itemsWithAiTime,
      locations,
      shopping,
      finance: { currentMonthTotal, averageMonthly: sixMonthTotal / 6, recordCount: priceRecords.length, monthly, recent: priceRecords.slice(0, 5), byCategory: [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([category, total]) => ({ category, total })) },
      consumption: [...consumption.values()].sort((a, b) => b.count - a.count).slice(0, 5),
      // AI 未配置时前端把按钮换成「去设置」引导,而不是让用户点了才看到报错。
      aiAvailable: Boolean(await getAiConfig()),
      preferences: { expiryReminderDays: preferences.expiryReminderDays, lowStockReminder: preferences.lowStockReminder, weeklyReviewEnabled: preferences.weeklyReviewEnabled, weeklyReviewDay: preferences.weeklyReviewDay },
      tasks,
    });
  } catch (error) {
    return apiError(error);
  }
}
