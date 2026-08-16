import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { canAdmin, currentUser } from "@/lib/account-auth";

type Context = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Context) {
  try {
    const actor = await currentUser();
    if (!actor) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (!canAdmin(actor.role)) return NextResponse.json({ error: "只有管理员可以撤销扫码消耗" }, { status: 403 });
    const { id } = await params;

    const result = await prisma.$transaction(async (tx) => {
      const activity = await tx.activityLog.findUnique({ where: { id } });
      if (!activity || activity.action !== "CONSUME" || !activity.itemId) return { error: "找不到可撤销的扫码记录", status: 404 as const };
      if (activity.undoneAt) return { error: "这条扫码记录已经撤销", status: 409 as const };

      const item = await tx.item.findFirst({ where: { id: activity.itemId, deletedAt: null } });
      if (!item) return { error: "物品不存在或已在回收站", status: 409 as const };
      await tx.item.update({ where: { id: item.id }, data: { quantity: { increment: 1 } } });
      await tx.activityLog.update({ where: { id: activity.id }, data: { undoneAt: new Date() } });
      const undo = await tx.activityLog.create({
        data: { action: "CONSUME_UNDO", itemId: item.id, itemName: item.name, userId: actor.id, undoOfId: activity.id, detail: `管理员撤销扫码消耗 1 ${item.unit}` },
      });
      return { item, undo };
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, item: result.item, undo: result.undo });
  } catch (error) {
    return apiError(error);
  }
}
