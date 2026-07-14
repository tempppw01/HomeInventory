import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { itemSchema } from "@/lib/validation";
import { apiError } from "@/lib/api";
import { createItemCode } from "@/lib/item-code";

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams.get("q")?.trim();
    const items = await prisma.item.findMany({
      where: search
        ? { OR: [{ name: { contains: search } }, { category: { contains: search } }, { notes: { contains: search } }] }
        : undefined,
      include: { location: true },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json(items);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = itemSchema.parse(await request.json());
    const item = await prisma.item.create({ data: { ...data, itemCode: createItemCode() }, include: { location: true } });

    if (item.type === "CONSUMABLE" && item.minQuantity > 0 && item.quantity <= item.minQuantity) {
      await prisma.shoppingItem.create({
        data: { name: item.name, quantity: Math.max(item.minQuantity - item.quantity, 1), unit: item.unit, category: item.category, priority: 2, source: "low-stock" },
      });
    }
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
