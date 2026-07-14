import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const [items, locations, shopping, priceRecords, fridgeSetting, fridgeReading] = await Promise.all([
      prisma.item.findMany({ include: { location: true }, orderBy: { updatedAt: "desc" } }),
      prisma.location.findMany({ include: { _count: { select: { items: true } } }, orderBy: { createdAt: "asc" } }),
      prisma.shoppingItem.findMany({ orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }] }),
      prisma.priceRecord.findMany({ where: { purchasedAt: { gte: sixMonthStart } }, orderBy: { purchasedAt: "desc" } }),
      prisma.fridgeSetting.findUnique({ where: { id: "default" } }),
      prisma.fridgeReading.findFirst({ orderBy: { recordedAt: "desc" } }),
    ]);

    const sixMonthTotal = priceRecords.reduce((sum, record) => sum + record.totalPrice, 0);
    const currentMonthTotal = priceRecords.filter((record) => record.purchasedAt >= currentMonthStart).reduce((sum, record) => sum + record.totalPrice, 0);
    const setting = fridgeSetting ?? { enabled: true, targetMin: 2, targetMax: 8 };
    const fridgeStatus = !setting.enabled ? "DISABLED" : !fridgeReading ? "UNKNOWN" : fridgeReading.temperature < setting.targetMin ? "TOO_COLD" : fridgeReading.temperature > setting.targetMax ? "TOO_WARM" : "NORMAL";

    return NextResponse.json({
      items,
      locations,
      shopping,
      finance: { currentMonthTotal, averageMonthly: sixMonthTotal / 6, recordCount: priceRecords.length, recent: priceRecords.slice(0, 5) },
      fridge: { setting, latest: fridgeReading, status: fridgeStatus },
    });
  } catch (error) {
    return apiError(error);
  }
}
