import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { createItemCode } from "@/lib/item-code";
import { batchItemSchema } from "@/lib/validation";
import { isLiquidConsumable } from "@/lib/item-metrics";

export async function POST(request: NextRequest) {
  try {
    const user = await requireWritableUser();
    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "请至少提供一件物品" }, { status: 400 });
    }
    if (body.items.length > 30) return NextResponse.json({ error: "单次最多新增 30 件物品" }, { status: 400 });
    const parsed: ReturnType<typeof batchItemSchema.parse>[] = [];
    const errors: string[] = [];
    body.items.forEach((value: unknown, index: number) => {
      const result = batchItemSchema.safeParse(value);
      if (result.success) parsed.push(result.data);
      else errors.push(`第 ${index + 1} 项：${result.error.issues[0]?.message || "数据不正确"}`);
    });
    if (!parsed.length) return NextResponse.json({ error: errors[0] || "没有可新增的物品", errors }, { status: 400 });

    const created = await prisma.$transaction(async (tx) => {
      const records = [];
      for (const data of parsed) {
        const normalized = data.type === "DURABLE" ? { ...data, expiryDate: null } : data;
        const item = await tx.item.create({ data: { ...normalized, itemCode: createItemCode() }, include: { location: true } });
        await tx.activityLog.create({ data: { action: "CREATE", itemId: item.id, itemName: item.name, userId: user.id, detail: "AI 批量录入物品" } });
        records.push(item);
      }
      return records;
    });
    for (const item of created) {
      const needsRestock = item.type === "CONSUMABLE" && ((item.minQuantity > 0 && item.quantity <= item.minQuantity) || (isLiquidConsumable(item) && item.remainingPercent <= 20));
      if (needsRestock) {
        const existing = await prisma.shoppingItem.findFirst({ where: { name: item.name, status: "PENDING" } });
        if (!existing) await prisma.shoppingItem.create({ data: { name: item.name, quantity: Math.max(item.minQuantity - item.quantity, 1), unit: item.unit, category: item.category, priority: 2, source: "low-stock" } });
      }
    }
    return NextResponse.json({ count: created.length, errors, items: created });
  } catch (error) {
    return apiError(error);
  }
}
