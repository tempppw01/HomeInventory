import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser();
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const [items, locations, shopping, priceRecords, consumptionLogs, preferences] = await Promise.all([
      prisma.item.findMany({ where: { deletedAt: null }, include: { location: true }, orderBy: { updatedAt: "desc" } }),
      prisma.location.findMany({ include: { parent: { select: { id: true, name: true } }, _count: { select: { items: true } } }, orderBy: { createdAt: "asc" } }),
      prisma.shoppingItem.findMany({ orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }] }),
      prisma.priceRecord.findMany({ where: { purchasedAt: { gte: sixMonthStart } }, orderBy: { purchasedAt: "desc" } }),
      prisma.activityLog.findMany({ where: { action: "CONSUME", undoneAt: null }, select: { itemName: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 500 }),
      prisma.householdPreference.upsert({ where: { id: "default" }, create: {}, update: {} }),
    ]);

    const sixMonthTotal = priceRecords.reduce((sum, record) => sum + record.totalPrice, 0);
    const currentMonthTotal = priceRecords.filter((record) => record.purchasedAt >= currentMonthStart).reduce((sum, record) => sum + record.totalPrice, 0);
    const categoryTotals = new Map<string, number>();
    priceRecords.filter((record) => record.purchasedAt >= currentMonthStart).forEach((record) => categoryTotals.set(record.category, (categoryTotals.get(record.category) || 0) + record.totalPrice));
    const consumption = new Map<string, { itemName: string; count: number; lastUsedAt: string }>();
    consumptionLogs.forEach((entry) => {
      if (!entry.itemName) return;
      const previous = consumption.get(entry.itemName);
      consumption.set(entry.itemName, { itemName: entry.itemName, count: (previous?.count || 0) + 1, lastUsedAt: previous?.lastUsedAt || entry.createdAt.toISOString() });
    });
    return NextResponse.json({
      items,
      locations,
      shopping,
      finance: { currentMonthTotal, averageMonthly: sixMonthTotal / 6, recordCount: priceRecords.length, recent: priceRecords.slice(0, 5), byCategory: [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([category, total]) => ({ category, total })) },
      consumption: [...consumption.values()].sort((a, b) => b.count - a.count).slice(0, 5),
      preferences: { expiryReminderDays: preferences.expiryReminderDays, lowStockReminder: preferences.lowStockReminder, weeklyReviewEnabled: preferences.weeklyReviewEnabled, weeklyReviewDay: preferences.weeklyReviewDay },
    });
  } catch (error) {
    return apiError(error);
  }
}
