import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [items, locations, shopping] = await Promise.all([
      prisma.item.findMany({ include: { location: true }, orderBy: { updatedAt: "desc" } }),
      prisma.location.findMany({ include: { _count: { select: { items: true } } }, orderBy: { createdAt: "asc" } }),
      prisma.shoppingItem.findMany({ orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }] }),
    ]);

    return NextResponse.json({ items, locations, shopping });
  } catch (error) {
    return apiError(error);
  }
}
