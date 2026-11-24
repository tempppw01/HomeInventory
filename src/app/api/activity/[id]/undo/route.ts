import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { canAdmin, currentUser } from "@/lib/account-auth";
import { refreshConsumeRate } from "@/lib/consume-rate";
import { planConsumeUndo } from "@/lib/consume-undo";
import { needsRestock } from "@/lib/item-metrics";

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

      const plan = planConsumeUndo(activity);
      if (plan.kind === "legacy-percent") {
        // 旧记录没把当时的余量存下来。宁可让用户手动调回去,也不猜 —— 猜错了就是改库存。
        return { error: "这条消耗是按余量刻度记的(旧记录没存下当时的余量),撤销会让库存对不上,请直接把余量调回原来的位置", status: 409 as const };
      }

      let nextQuantity = item.quantity;
      let nextPercent = item.remainingPercent;

      if (plan.kind === "percent") {
        // 余量只能退回「最近一次」:这之后还有消耗的话,回退会把它们一起抹掉。
        const newest = await tx.activityLog.findFirst({
          where: { itemId: item.id, action: "CONSUME", undoneAt: null },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        if (newest?.id !== activity.id) return { error: "只能撤销最近一次「余量」消耗:这之后还有新的消耗记录", status: 409 as const };
        nextPercent = plan.percentBefore;
        await tx.item.update({ where: { id: item.id }, data: { remainingPercent: nextPercent } });
      } else {
        nextQuantity = item.quantity + 1;
        await tx.item.update({ where: { id: item.id }, data: { quantity: { increment: 1 } } });
      }

      // 顺序要紧:先把 undoneAt 写进去,再按流水重算消耗速度。
      // 反过来的话,刚撤销的这一次还在分子里 —— 实测数量退回了、consumeRate 却停在原值。
      await tx.activityLog.update({ where: { id: activity.id }, data: { undoneAt: new Date() } });
      const consumeRate = await refreshConsumeRate(tx, item.id);

      // 退回去之后不再需要补货了,才撤掉自动生成的待采购建议;
      // 仍低于最低库存(或余量仍 ≤20%)就留着 —— 判定与生成建议时用的是同一个 needsRestock。
      const stillLow = needsRestock({ ...item, quantity: nextQuantity, remainingPercent: nextPercent, restockPausedUntil: null });
      let removedSuggestions = 0;
      if (!stillLow) {
        const removed = await tx.shoppingItem.deleteMany({ where: { name: item.name, status: "PENDING", source: "low-stock" } });
        removedSuggestions = removed.count;
      }

      const undo = await tx.activityLog.create({
        data: {
          action: "CONSUME_UNDO",
          itemId: item.id,
          itemName: item.name,
          userId: actor.id,
          undoOfId: activity.id,
          detail: plan.kind === "percent" ? `撤销余量消耗(余量回到 ${Math.round(plan.percentBefore)}%)` : `撤销消耗 1 ${item.unit}`,
        },
      });
      // 回给调用方的必须是**撤销之后**的物品:此前返回的是撤销前读到的快照,
      // 数量比库里少 1(界面靠刷新盖过去了,但接口本身是错的)。
      const updated = await tx.item.findUniqueOrThrow({ where: { id: item.id }, include: { location: true } });
      return { item: updated, undo, consumeRate, removedSuggestions, restoredPercent: plan.kind === "percent" ? plan.percentBefore : null };
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, item: result.item, undo: result.undo, consumeRate: result.consumeRate, restoredPercent: result.restoredPercent, removedSuggestions: result.removedSuggestions });
  } catch (error) {
    return apiError(error);
  }
}
