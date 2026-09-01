import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { isLiquidConsumable } from "@/lib/item-metrics";

type Context = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Context) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.item.findFirst({ where: { id, deletedAt: null } });
      if (!current) return { error: "物品不存在", status: 404 as const };
      if (current.type !== "CONSUMABLE") return { error: "耐用品不能直接消耗", status: 409 as const };
      if (isLiquidConsumable(current)) return { error: "液体请通过余量刻度记录使用进度", status: 409 as const };
      const changed = await tx.item.updateMany({ where: { id, deletedAt: null, type: "CONSUMABLE", quantity: { gte: 1 } }, data: { quantity: { decrement: 1 } } });
      if (changed.count !== 1) return { error: "库存不足，无法消耗", status: 409 as const };
      const item = await tx.item.findUniqueOrThrow({ where: { id }, include: { location: true } });
      const activity = await tx.activityLog.create({ data: { action: "CONSUME", itemId: item.id, itemName: item.name, userId: user.id, detail: `手动消耗 1 ${item.unit}` } });
      const needsRestock = (item.minQuantity > 0 && item.quantity <= item.minQuantity);
      if (needsRestock && !(await tx.shoppingItem.findFirst({ where: { name: item.name, status: "PENDING" } }))) {
        await tx.shoppingItem.create({ data: { name: item.name, quantity: Math.max(item.minQuantity - item.quantity, 1), unit: item.unit, category: item.category, priority: 2, source: "low-stock" } });
      }
      return { item, activityId: activity.id };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
