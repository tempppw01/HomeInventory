import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { shoppingPatchSchema } from "@/lib/validation";
import { withWriteRetry } from "@/lib/write-retry";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;
    const body = shoppingPatchSchema.parse(await request.json());
    const status = body.status === "PURCHASED" ? "PURCHASED" : "PENDING";

    const item = await withWriteRetry(() => prisma.$transaction(async (tx) => {
      const previous = await tx.shoppingItem.findUnique({ where: { id }, select: { status: true } });
      const previousStatus = previous?.status ?? null;
      const updated = await tx.shoppingItem.update({ where: { id }, data: { status, ...(typeof body.isFavorite === "boolean" ? { isFavorite: body.isFavorite } : {}) } });
      const replenishItemId = typeof body.replenishItemId === "string" ? body.replenishItemId : null;
      // 采购入库只做一次:之前只要收到 PURCHASED+replenishItemId 就无条件 +库存,
      // 于是「再点一次已购买」「撤销后再标记」都会再加一次(实测 10 → 13 → 16 → 19),
      // 而用户每次看到的都是「采购已完成,并已入库」——账实不符。
      // 现在用 stockedAt / stockedQuantity / stockedItemId 记账:重复点不会再加,撤销会把量退回去。
      if (status === "PURCHASED" && replenishItemId) {
        const inventoryItem = await tx.item.findUnique({ where: { id: replenishItemId } });
        if (inventoryItem) {
          // **认领**必须原子:此前是「读 updated.stockedAt 再决定」,MySQL 上两个并发请求会同时
          // 读到 null,于是两个都去入库 —— 实测两个响应都说「已入库」(库存只加一次纯属巧合)。
          // 谁把 stockedAt 从 NULL 写成有值,谁才入库;其余请求如实回 stocked:false。
          const claimed = await tx.shoppingItem.updateMany({
            where: { id: updated.id, stockedAt: null },
            data: { stockedAt: new Date(), stockedQuantity: updated.quantity, stockedItemId: inventoryItem.id },
          });
          if (claimed.count === 1) {
            // 用 increment 而不是「读出来 + 数量再写回」:后者在并发下会丢掉别人的那次入库。
            await tx.item.update({ where: { id: inventoryItem.id }, data: { quantity: { increment: updated.quantity }, lastRestockedAt: new Date() } });
            await tx.activityLog.create({ data: { action: "SHOPPING_UPDATE", itemId: inventoryItem.id, itemName: updated.name, userId: user.id, detail: "采购完成并补货入库" } });
          }
          // 返回**入库之后**的那一行(此前返回入库前的快照,接口自己在说谎)。
          const stocked = await tx.shoppingItem.findUniqueOrThrow({ where: { id: updated.id } });
          return { ...stocked, stocked: claimed.count === 1 };
        }
      }
      // 撤销(从已购买改回待购)且当初入过库:把加进去的量退回去,别让库存虚高。
      if (status === "PENDING" && previousStatus === "PURCHASED" && updated.stockedAt && updated.stockedItemId && updated.stockedQuantity) {
        const stockedItemId = updated.stockedItemId;
        const stockedQuantity = updated.stockedQuantity;
        // 同样先认领:并发撤销时只该有一个请求退回库存。
        const claimed = await tx.shoppingItem.updateMany({
          where: { id: updated.id, stockedAt: { not: null } },
          data: { stockedAt: null, stockedQuantity: null, stockedItemId: null },
        });
        if (claimed.count === 1) {
          // decrement 不会丢更新;再用一条带条件的语句兜住「退到负数」。
          const lowered = await tx.item.updateMany({ where: { id: stockedItemId, quantity: { gte: stockedQuantity } }, data: { quantity: { decrement: stockedQuantity } } });
          if (lowered.count === 0) await tx.item.updateMany({ where: { id: stockedItemId, quantity: { lt: stockedQuantity } }, data: { quantity: 0 } });
          await tx.activityLog.create({ data: { action: "SHOPPING_UPDATE", itemId: stockedItemId, itemName: updated.name, userId: user.id, detail: "撤销采购入库,库存已退回" } });
        }
        const cleared = await tx.shoppingItem.findUniqueOrThrow({ where: { id: updated.id } });
        return { ...cleared, stocked: false, reverted: claimed.count === 1 };
      }
      await tx.activityLog.create({ data: { action: "SHOPPING_UPDATE", itemName: updated.name, userId: user.id, detail: status === "PURCHASED" ? "采购项已完成" : "采购项恢复待购" } });
      return { ...updated, stocked: false };
    }));
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
