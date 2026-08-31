import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const body = await request.json();
    const status = body.status === "PURCHASED" ? "PURCHASED" : "PENDING";
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.shoppingItem.update({ where: { id }, data: { status } });
      const replenishItemId = typeof body.replenishItemId === "string" ? body.replenishItemId : null;
      if (status === "PURCHASED" && replenishItemId && updated.source === "restock-suggestion") {
        const inventoryItem = await tx.item.findUnique({ where: { id: replenishItemId } });
        if (inventoryItem) {
          await tx.item.update({
            where: { id: inventoryItem.id },
            data: { quantity: inventoryItem.quantity + updated.quantity, lastRestockedAt: new Date() },
          });
          await tx.activityLog.create({ data: { action: "SHOPPING_UPDATE", itemId: inventoryItem.id, itemName: updated.name, detail: "采购完成并补货入库" } });
          return updated;
        }
      }
      await tx.activityLog.create({ data: { action: "SHOPPING_UPDATE", itemName: updated.name, detail: status === "PURCHASED" ? "采购项已完成" : "采购项恢复待购" } });
      return updated;
    });
    return NextResponse.json(item);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    await prisma.$transaction(async (tx) => {
      const item = await tx.shoppingItem.findUnique({ where: { id } });
      await tx.shoppingItem.delete({ where: { id } });
      if (item) await tx.activityLog.create({ data: { action: "SHOPPING_DELETE", itemName: item.name, detail: "删除采购项" } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
