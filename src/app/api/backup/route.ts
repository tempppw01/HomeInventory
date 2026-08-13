import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Export user data without credentials or AI/OSS secrets. */
export async function GET() {
  try {
    const [items, locations, shopping, priceRecords, members, activities] = await Promise.all([
      prisma.item.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.location.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.shoppingItem.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.priceRecord.findMany({ orderBy: { purchasedAt: "asc" } }),
      prisma.householdMember.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.activityLog.findMany({ orderBy: { createdAt: "asc" } }),
    ]);
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      items,
      locations,
      shopping,
      priceRecords,
      members,
      activities,
    };
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename=home-inventory-backup-${new Date().toISOString().slice(0, 10)}.json`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
