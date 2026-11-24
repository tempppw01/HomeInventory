import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { shoppingPatchSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;
    const body = shoppingPatchSchema.parse(await request.json());
    const status = body.status === "PURCHASED" ? "PURCHASED" : "PENDING";

    const item = await prisma.$transaction(async (tx) => {
      const previous = await tx.shoppingItem.findUnique({ where: { id }, select: { status: true } });
      const previousStatus = previous?.status ?? null;
      const updated = await tx.shoppingItem.update({ where: { id }, data: { status, ...(typeof body.isFavorite === "boolean" ? { isFavorite: body.isFavorite } : {}) } });
      const replenishItemId = typeof body.replenishItemId === "string" ? body.replenishItemId : null;
      // 采购入库只做一次:之前只要收到 PURCHASED+replenishItemId 就无条件 +库存,
      // 于是「再点一次已购买」「撤销后再标记」都会再加一次(实测 10 → 13 → 16 → 19),
      // 而用户每次看到的都是「采购已完成,并已入库」——账实不符。
      // 现在用 stockedAt / stockedQuantity / stockedItemId 记账:重复点不会再加,撤销会把量退回去。
      if (status === "PURCHASED" && replenishItemId && !updated.stockedAt) {
        const inventoryItem = await tx.item.findUnique({ where: { id: replenishItemId } });
        if (inventoryItem) {
          await tx.item.update({
            where: { id: inventoryItem.id },
            data: { quantity: inventoryItem.quantity + updated.quantity, lastRestockedAt: new Date() },
          });
          await tx.shoppingItem.update({
            where: { id: updated.id },
            data: { stockedAt: new Date(), stockedQuantity: updated.quantity, stockedItemId: inventoryItem.id },
          });
          await tx.activityLog.create({ data: { action: "SHOPPING_UPDATE", itemId: inventoryItem.id, itemName: updated.name, userId: user.id, detail: "采购完成并补货入库" } });
          return { ...updated, stocked: true };
        }
      }
      // 撤销(从已购买改回待购)且当初入过库:把加进去的量退回去,别让库存虚高。
      if (status === "PENDING" && previousStatus === "PURCHASED" && updated.stockedAt && updated.stockedItemId && updated.stockedQuantity) {
        const inventoryItem = await tx.item.findUnique({ where: { id: updated.stockedItemId } });
        if (inventoryItem) {
          await tx.item.update({
            where: { id: inventoryItem.id },
            data: { quantity: Math.max(0, inventoryItem.quantity - updated.stockedQuantity) },
          });
          await tx.activityLog.create({ data: { action: "SHOPPING_UPDATE", itemId: inventoryItem.id, itemName: updated.name, userId: user.id, detail: "撤销采购入库,库存已退回" } });
        }
        await tx.shoppingItem.update({ where: { id: updated.id }, data: { stockedAt: null, stockedQuantity: null, stockedItemId: null } });
        return { ...updated, stocked: false, reverted: true };
      }
      await tx.activityLog.create({ data: { action: "SHOPPING_UPDATE", itemName: updated.name, userId: user.id, detail: status === "PURCHASED" ? "采购项已完成" : "采购项恢复待购" } });
      return { ...updated, stocked: false };
    });
    return NextResponse.json(item);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: NextRequest, { params }: Context) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;
    await prisma.$transaction(async (tx) => {
      const item = await tx.shoppingItem.findUnique({ where: { id } });
      await tx.shoppingItem.delete({ where: { id } });
      if (item) await tx.activityLog.create({ data: { action: "SHOPPING_DELETE", itemName: item.name, userId: user.id, detail: "删除采购项" } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
