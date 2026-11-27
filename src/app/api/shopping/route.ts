import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shoppingSchema } from "@/lib/validation";
import { apiError, requireWritableUser } from "@/lib/api";
import { normalizedPurchaseName } from "@/lib/shopping-list";

export async function POST(request: NextRequest) {
  try {
    const user = await requireWritableUser();
    const data = shoppingSchema.parse(await request.json());
    const result = await prisma.$transaction(async (tx) => {
      // A shopping list should stay useful at a glance. Merge only entries
      // with the same normalised name *and* unit, so "2 bottles" is never
      // accidentally combined with "2 boxes".
      // 归一的写法收口在 lib/shopping-list:界面判定「在不在清单里」必须与这里的键完全一致,
      // 否则又会出现「界面说没有、点下去被合并(数量翻倍)」这种两处不一样的说法。
      const normalizedName = normalizedPurchaseName(data.name);
      const pending = await tx.shoppingItem.findMany({ where: { status: "PENDING", unit: data.unit } });
      const existing = pending.find((entry) => normalizedPurchaseName(entry.name) === normalizedName);
      if (existing) {
        const item = await tx.shoppingItem.update({
          where: { id: existing.id },
          data: {
            quantity: existing.quantity + data.quantity,
            priority: Math.max(existing.priority, data.priority),
            category: existing.category || data.category,
          },
        });
        await tx.activityLog.create({ data: { action: "SHOPPING_MERGE", itemName: item.name, userId: user.id, detail: "合并重复采购项" } });
        return { item, merged: true };
      }
      const item = await tx.shoppingItem.create({ data });
      await tx.activityLog.create({ data: { action: "SHOPPING_CREATE", itemName: item.name, userId: user.id, detail: "添加采购项" } });
      return { item, merged: false };
    });
    return NextResponse.json(result, { status: result.merged ? 200 : 201 });
  } catch (error) {
    return apiError(error);
  }
}
