import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { itemPatchSchema } from "@/lib/validation";
import { apiError, requireWritableUser } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { isLiquidConsumable, normalizeItemQuantity } from "@/lib/item-metrics";
import { deleteStoredImage } from "@/lib/oss";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Context) {
  try {
    await requireUser();
    const { id } = await params;
    const item = await prisma.item.findFirst({
      where: { deletedAt: null, OR: [{ id }, { itemCode: id }] },
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
    const user = await requireWritableUser();
    const { id } = await params;
    const { recordPurchase, purchaseStore, ...parsed } = itemPatchSchema.parse(await request.json());
    const item = await prisma.$transaction(async (tx) => {
      const existing = await tx.item.findUniqueOrThrow({ where: { id } });
      const nextType = parsed.type ?? existing.type;
      const nextUnit = parsed.unit ?? existing.unit;
      const normalized = parsed.quantity === undefined ? parsed : { ...parsed, quantity: normalizeItemQuantity(parsed.quantity, nextUnit) };
      const data = nextType === "DURABLE" ? { ...normalized, expiryDate: null } : normalized;
      const updated = await tx.item.update({ where: { id }, data, include: { location: true } });
      await tx.activityLog.create({ data: { action: "UPDATE", itemId: updated.id, itemName: updated.name, userId: user.id, detail: "更新物品信息" } });
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

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;
    const item = await prisma.item.findUnique({ where: { id } });
    if (!item) return NextResponse.json({ error: "物品不存在" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (body.permanent === true) {
      await prisma.activityLog.create({ data: { action: "DELETE_PERMANENT", itemName: item.name, userId: user.id, detail: "永久删除物品（历史关联已保留为名称快照）" } });
      await prisma.item.delete({ where: { id } });
      await deleteStoredImage(item.imageUrl);
    }
    else {
      await prisma.item.update({ where: { id }, data: { deletedAt: new Date() } });
      await prisma.activityLog.create({ data: { action: "DELETE", itemId: item.id, itemName: item.name, userId: user.id, memberId: typeof body.memberId === "string" ? body.memberId : null, detail: "移入回收站" } });
    }
    return NextResponse.json({ ok: true, deletedAt: new Date().toISOString() });
  } catch (error) {
    return apiError(error);
  }
}
