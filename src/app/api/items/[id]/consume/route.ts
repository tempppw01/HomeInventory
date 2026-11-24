import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { isLiquidConsumable } from "@/lib/item-metrics";
import { ensureRestockSuggestion } from "@/lib/restock-suggestion";
import { refreshConsumeRate } from "@/lib/consume-rate";
import { withWriteRetry } from "@/lib/write-retry";

type Context = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Context) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;
    const result = await withWriteRetry(() => prisma.$transaction(async (tx) => {
      const current = await tx.item.findFirst({ where: { id, deletedAt: null } });
      if (!current) return { error: "物品不存在", status: 404 as const };
      if (current.type !== "CONSUMABLE") return { error: "耐用品不能直接消耗", status: 409 as const };
      if (isLiquidConsumable(current)) return { error: "液体请通过余量刻度记录使用进度", status: 409 as const };
      const changed = await tx.item.updateMany({ where: { id, deletedAt: null, type: "CONSUMABLE", quantity: { gte: 1 } }, data: { quantity: { decrement: 1 } } });
      if (changed.count !== 1) return { error: "库存不足,无法消耗", status: 409 as const };
      const item = await tx.item.findUniqueOrThrow({ where: { id }, include: { location: true } });
      const activity = await tx.activityLog.create({ data: { action: "CONSUME", itemId: item.id, itemName: item.name, userId: user.id, detail: `手动消耗 1 ${item.unit}` } });
      // 先建流水、再按流水算消耗速度(见 lib/consume-rate):算法只有这一处,
      // 撤销与扫码消耗走同一条,免得三处各算一套、彼此漂移。
      await refreshConsumeRate(tx, item.id);
      await ensureRestockSuggestion(tx, item);
      const withRate = await tx.item.findUniqueOrThrow({ where: { id: item.id }, include: { location: true } });

      return { item: withRate, activityId: activity.id };
    }));
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
