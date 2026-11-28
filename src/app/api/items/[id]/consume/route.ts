import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { isLiquidConsumable } from "@/lib/item-metrics";
import { ensureRestockSuggestion } from "@/lib/restock-suggestion";
import { refreshConsumeRate } from "@/lib/consume-rate";
import { withWriteRetry } from "@/lib/write-retry";
import { normalizeOpId, runOnce } from "@/lib/idempotency";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;
    // 客户端(含离线队列重放)带上唯一操作号:同一个号只扣一次。
    const opId = normalizeOpId(request.headers.get("x-guiwu-op-id"));
    const outcome = await runOnce(opId, "item.consume", () => withWriteRetry(() => prisma.$transaction(async (tx) => {
      const current = await tx.item.findFirst({ where: { id } });
      if (!current) return { error: "物品不存在", status: 404 as const };
      // 在回收站里的物品:说清它在哪,别说「不存在」—— 这台设备只是页面还开着,
      // 另一台已经把它扔了;用户看到「不存在」会以为数据丢了。
      if (current.deletedAt) return { error: "这件物品已在回收站,请先从回收站恢复再消耗", status: 409 as const };
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
    })));
    if (outcome.replay) {
      // 重放:上次已经做过。有结果就把上次的结果原样回给他(多一个 deduplicated 标记);
      // 结果还没写回来(上一次还在处理,或进程中途死掉)就说清楚 —— **绝不重复扣减**。
      if (outcome.result) return NextResponse.json({ ...outcome.result, deduplicated: true });
      return NextResponse.json({ error: "这次操作已经在处理了,请稍后刷新", deduplicated: true }, { status: 409 });
    }
    const result = outcome.result;
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
