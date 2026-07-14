import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { itemPatchSchema } from "@/lib/validation";
import { apiError } from "@/lib/api";
import { isLiquidConsumable } from "@/lib/item-metrics";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const item = await prisma.item.findFirst({
      where: { OR: [{ id }, { itemCode: id }] },
      include: { location: true },
    });
    if (!item) return NextResponse.json({ error: "物品不存在" }, { status: 404 });
    return NextResponse.json(item);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { recordPurchase, purchaseStore, ...parsed } = itemPatchSchema.parse(await request.json());
    const item = await prisma.$transaction(async (tx) => {
      const existing = await tx.item.findUniqueOrThrow({ where: { id } });
      const nextType = parsed.type ?? existing.type;
      const data = nextType === "DURABLE" ? { ...parsed, expiryDate: null } : parsed;
      const updated = await tx.item.update({ where: { id }, data, include: { location: true } });
      if (recordPurchase && updated.price != null) {
        const quantity = Math.max(data.quantity ?? updated.quantity, 1);
        await tx.priceRecord.create({ data: { itemId: updated.id, itemName: updated.name, category: updated.category, unitPrice: updated.price, quantity, totalPrice: updated.price * quantity, purchasedAt: data.purchaseDate || new Date(), store: purchaseStore } });
      }
      return updated;
    });

    const needsRestock = item.type === "CONSUMABLE" && ((item.minQuantity > 0 && item.quantity <= item.minQuantity) || (isLiquidConsumable(item) && item.remainingPercent <= 20));
    if (needsRestock) {
      const existing = await prisma.shoppingItem.findFirst({ where: { name: item.name, status: "PENDING" } });
      if (!existing) {
        await prisma.shoppingItem.create({
          data: { name: item.name, quantity: Math.max(item.minQuantity - item.quantity, 1), unit: item.unit, category: item.category, priority: 2, source: "low-stock" },
        });
      }
    }
    return NextResponse.json(item);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    await prisma.item.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
