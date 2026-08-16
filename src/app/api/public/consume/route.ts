import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isLiquidConsumable } from "@/lib/item-metrics";
import { apiError } from "@/lib/api";

const consumeSchema = z.object({ itemId: z.string().trim().min(1).max(80) });

export async function POST(request: NextRequest) {
  try {
    const { itemId } = consumeSchema.parse(await request.json());
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.item.findFirst({ where: { id: itemId, deletedAt: null } });
      if (!current) return { error: "物品不存在", status: 404 as const };
      if (current.type !== "CONSUMABLE") return { error: "耐用品不能通过扫码消耗", status: 409 as const };

      const changed = await tx.item.updateMany({
        where: { id: itemId, deletedAt: null, type: "CONSUMABLE", quantity: { gte: 1 } },
        data: { quantity: { decrement: 1 } },
      });
      if (changed.count !== 1) return { error: "库存不足，无法消耗", status: 409 as const };

      const item = await tx.item.findUniqueOrThrow({ where: { id: itemId }, include: { location: true } });
      await tx.activityLog.create({
        data: { action: "CONSUME", itemId: item.id, itemName: item.name, detail: `扫码消耗 1 ${item.unit}` },
      });

      const needsRestock = (item.minQuantity > 0 && item.quantity <= item.minQuantity) || (isLiquidConsumable(item) && item.remainingPercent <= 20);
      if (needsRestock) {
        const pending = await tx.shoppingItem.findFirst({ where: { name: item.name, status: "PENDING" } });
        if (!pending) {
          await tx.shoppingItem.create({
            data: { name: item.name, quantity: Math.max(item.minQuantity - item.quantity, 1), unit: item.unit, category: item.category, priority: 2, source: "low-stock" },
          });
        }
      }
      return { item };
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, item: result.item, consumed: 1 });
  } catch (error) {
    return apiError(error);
  }
}
