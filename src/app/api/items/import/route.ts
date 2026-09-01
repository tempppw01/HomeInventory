import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { createItemCode } from "@/lib/item-code";
import { itemSchema } from "@/lib/validation";
import { normalizeItemQuantity } from "@/lib/item-metrics";

export async function POST(request: NextRequest) {
  try {
    const user = await requireWritableUser();
    const body = await request.json();
    const rows = Array.isArray(body) ? body : body.items;
    if (!Array.isArray(rows)) return NextResponse.json({ error: "导入文件格式不正确" }, { status: 400 });
    const errors: { row: number; error: string }[] = [];
    const parsedRows = rows.slice(0, 1000).flatMap((row: unknown, index: number) => {
      if (!row || typeof row !== "object") {
        errors.push({ row: index + 1, error: "行数据不是对象" });
        return [];
      }
      const source = row as Record<string, unknown>;
      const dateOnly = (value: unknown) => typeof value === "string" && value ? value.slice(0, 10) : value;
      const result = itemSchema.safeParse({
        name: source.name,
        category: source.category,
        type: source.type === "CONSUMABLE" ? "CONSUMABLE" : "DURABLE",
        quantity: source.quantity ?? 1,
        minQuantity: source.minQuantity ?? 0,
        remainingPercent: source.remainingPercent ?? 100,
        unit: source.unit ?? "件",
        price: source.price ?? null,
        purchaseDate: dateOnly(source.purchaseDate),
        expiryDate: dateOnly(source.expiryDate),
        imageUrl: source.imageUrl ?? null,
        locationId: source.locationId ?? null,
        notes: source.notes ?? null,
        aiSummary: source.aiSummary ?? null,
        aiStorageAdvice: source.aiStorageAdvice ?? null,
        aiUsageAdvice: source.aiUsageAdvice ?? null,
        aiReplenishmentAdvice: source.aiReplenishmentAdvice ?? null,
        restockPausedUntil: source.restockPausedUntil ?? null,
      });
      if (!result.success) {
        errors.push({ row: index + 1, error: result.error.issues[0]?.message || "数据校验失败" });
        return [];
      }
      return [result.data];
    });
    if (!parsedRows.length && errors.length) return NextResponse.json({ count: 0, errors }, { status: 400 });
    const count = await prisma.$transaction(async (tx) => {
      let createdCount = 0;
      for (const data of parsedRows) {
        const { recordPurchase, purchaseStore, ...itemData } = data;
        const normalized = { ...itemData, quantity: normalizeItemQuantity(itemData.quantity, itemData.unit) };
        const item = await tx.item.create({ data: { ...normalized, expiryDate: normalized.type === "DURABLE" ? null : normalized.expiryDate, itemCode: createItemCode() } });
        if (recordPurchase && normalized.price != null) {
          const quantity = Math.max(normalized.quantity, 1);
          await tx.priceRecord.create({ data: { itemId: item.id, itemName: item.name, category: item.category, unitPrice: normalized.price, quantity, totalPrice: normalized.price * quantity, purchasedAt: normalized.purchaseDate || new Date(), store: purchaseStore } });
        }
        await tx.activityLog.create({ data: { action: "CREATE", itemId: item.id, itemName: item.name, userId: user.id, detail: "JSON 导入" } });
        createdCount += 1;
      }
      return createdCount;
    });
    return NextResponse.json({ count, errors, truncated: rows.length > 1000 }, { status: 201 });
  } catch (error) { return apiError(error); }
}
