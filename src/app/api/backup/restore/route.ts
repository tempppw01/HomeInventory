import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireAdminUser } from "@/lib/api";
import { createItemCode } from "@/lib/item-code";
import { normalizeItemQuantity } from "@/lib/item-metrics";
import { itemSchema, locationSchema, shoppingSchema } from "@/lib/validation";

type BackupPayload = { items?: unknown[]; locations?: unknown[]; shopping?: unknown[]; priceRecords?: unknown[] };

/** Safely merges a trusted export into the current household without deleting existing records. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAdminUser();
    const body = await request.json() as BackupPayload;
    if (!Array.isArray(body.items) && !Array.isArray(body.locations) && !Array.isArray(body.shopping)) {
      return NextResponse.json({ error: "备份文件中没有可恢复的数据" }, { status: 400 });
    }
    const result = await prisma.$transaction(async (tx) => {
      const locationIdMap = new Map<string, string>();
      let locations = 0, items = 0, shopping = 0, priceRecords = 0;
      for (const row of (body.locations || []).slice(0, 200)) {
        const source = row as Record<string, unknown>;
        const parsed = locationSchema.safeParse({ name: source.name, icon: source.icon, color: source.color, thumbnailUrl: source.thumbnailUrl });
        if (!parsed.success) continue;
        const location = await tx.location.upsert({ where: { name: parsed.data.name }, create: parsed.data, update: { icon: parsed.data.icon, color: parsed.data.color, thumbnailUrl: parsed.data.thumbnailUrl } });
        if (typeof source.id === "string") locationIdMap.set(source.id, location.id);
        locations += 1;
      }
      for (const row of (body.items || []).slice(0, 2000)) {
        const source = row as Record<string, unknown>;
        const parsed = itemSchema.safeParse({ ...source, purchaseDate: typeof source.purchaseDate === "string" ? source.purchaseDate.slice(0, 10) : source.purchaseDate, expiryDate: typeof source.expiryDate === "string" ? source.expiryDate.slice(0, 10) : source.expiryDate, locationId: typeof source.locationId === "string" ? locationIdMap.get(source.locationId) || null : null });
        if (!parsed.success) continue;
        const data = parsed.data;
        const duplicate = await tx.item.findFirst({ where: { name: data.name, locationId: data.locationId, deletedAt: null } });
        if (duplicate) continue;
        await tx.item.create({ data: { ...data, quantity: normalizeItemQuantity(data.quantity, data.unit), itemCode: createItemCode() } });
        items += 1;
      }
      for (const row of (body.shopping || []).slice(0, 1000)) {
        const source = row as Record<string, unknown>;
        const parsed = shoppingSchema.safeParse(source);
        if (!parsed.success) continue;
        const duplicate = await tx.shoppingItem.findFirst({ where: { name: parsed.data.name, status: "PENDING" } });
        if (duplicate) continue;
        await tx.shoppingItem.create({ data: { ...parsed.data, status: source.status === "PURCHASED" ? "PURCHASED" : "PENDING" } });
        shopping += 1;
      }
      for (const row of (body.priceRecords || []).slice(0, 5000)) {
        const source = row as Record<string, unknown>;
        if (typeof source.itemName !== "string" || typeof source.category !== "string" || typeof source.unitPrice !== "number" || typeof source.totalPrice !== "number") continue;
        await tx.priceRecord.create({ data: { itemName: source.itemName, category: source.category, unitPrice: source.unitPrice, quantity: typeof source.quantity === "number" ? source.quantity : 1, totalPrice: source.totalPrice, purchasedAt: typeof source.purchasedAt === "string" ? new Date(source.purchasedAt) : new Date(), store: typeof source.store === "string" ? source.store : null, notes: typeof source.notes === "string" ? source.notes : null } });
        priceRecords += 1;
      }
      await tx.activityLog.create({ data: { action: "BACKUP_RESTORE", userId: user.id, detail: `合并恢复：${items} 件物品、${locations} 个空间、${shopping} 条采购` } });
      return { locations, items, shopping, priceRecords };
    });
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
