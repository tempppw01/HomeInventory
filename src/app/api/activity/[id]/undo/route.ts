import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { canAdmin, currentUser } from "@/lib/account-auth";

type Context = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Context) {
  try {
    const { id } = await params;
    const actor = await currentUser();
    if (!actor) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (!canAdmin(actor.role)) {
      const own = await prisma.activityLog.findUnique({ where: { id } });
      if (!own || own.userId !== actor.id || own.action !== "CONSUME" || own.createdAt.getTime() < Date.now() - 5 * 60_000) return NextResponse.json({ error: "只能在 5 分钟内撤销自己发起的消耗" }, { status: 403 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const activity = await tx.activityLog.findUnique({ where: { id } });
      if (!activity || activity.action !== "CONSUME" || !activity.itemId) return { error: "找不到可撤销的消耗记录", status: 404 as const };
      if (activity.undoneAt) return { error: "这条消耗记录已经撤销", status: 409 as const };

      const item = await tx.item.findFirst({ where: { id: activity.itemId, deletedAt: null } });
      if (!item) return { error: "物品不存在或已在回收站", status: 409 as const };
      await tx.item.update({ where: { id: item.id }, data: { quantity: { increment: 1 } } });
      const recentUses = await tx.activityLog.count({ where: { itemId: item.id, action: "CONSUME", undoneAt: null, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } } });
      await tx.item.update({ where: { id: item.id }, data: { consumeRate: recentUses / 30 } });
      const lowStockSuggestions = await tx.shoppingItem.findMany({ where: { status: "PENDING", source: "low-stock", name: item.name } });
      if (item.quantity + 1 > item.minQuantity && (!item.minQuantity || item.remainingPercent > 20)) {
        await tx.shoppingItem.deleteMany({ where: { id: { in: lowStockSuggestions.map((suggestion) => suggestion.id) } } });
      }
      await tx.activityLog.update({ where: { id: activity.id }, data: { undoneAt: new Date() } });
      const undo = await tx.activityLog.create({
        data: { action: "CONSUME_UNDO", itemId: item.id, itemName: item.name, userId: actor.id, undoOfId: activity.id, detail: `撤销消耗 1 ${item.unit}` },
      });
      return { item, undo };
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, item: result.item, undo: result.undo });
  } catch (error) {
    return apiError(error);
  }
}
