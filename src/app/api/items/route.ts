import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { itemSchema } from "@/lib/validation";
import { apiError } from "@/lib/api";
import { createItemCode } from "@/lib/item-code";
import { isLiquidConsumable } from "@/lib/item-metrics";

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
    const { recordPurchase, purchaseStore, ...parsed } = itemSchema.parse(await request.json());
    const data = parsed.type === "DURABLE" ? { ...parsed, expiryDate: null } : parsed;
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.item.create({ data: { ...data, itemCode: createItemCode() }, include: { location: true } });
      if (recordPurchase && data.price != null) {
        await tx.priceRecord.create({ data: { itemId: created.id, itemName: created.name, category: created.category, unitPrice: data.price, quantity: Math.max(data.quantity, 1), totalPrice: data.price * Math.max(data.quantity, 1), purchasedAt: data.purchaseDate || new Date(), store: purchaseStore } });
      }
      return created;
    });

    const needsRestock = item.type === "CONSUMABLE" && ((item.minQuantity > 0 && item.quantity <= item.minQuantity) || (isLiquidConsumable(item) && item.remainingPercent <= 20));
    if (needsRestock) {
      await prisma.shoppingItem.create({
        data: { name: item.name, quantity: Math.max(item.minQuantity - item.quantity, 1), unit: item.unit, category: item.category, priority: 2, source: "low-stock" },
      });
    }
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
