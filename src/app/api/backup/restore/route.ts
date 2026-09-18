import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireAdminUser } from "@/lib/api";
import { createItemCode } from "@/lib/item-code";
import { normalizeItemQuantity } from "@/lib/item-metrics";
import { itemSchema, locationSchema, shoppingSchema } from "@/lib/validation";

type BackupPayload = { items?: unknown[]; locations?: unknown[]; shopping?: unknown[]; priceRecords?: unknown[]; members?: unknown[] };

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
      const itemIdMap = new Map<string, string>();
      const locationParentMap = new Map<string, string | null>();
      let locations = 0, items = 0, shopping = 0, priceRecords = 0, members = 0;
      for (const row of (body.locations || []).slice(0, 200)) {
        const source = row as Record<string, unknown>;
        const parsed = locationSchema.safeParse({ name: source.name, icon: source.icon, color: source.color, thumbnailUrl: source.thumbnailUrl });
        if (!parsed.success) continue;
        const location = await tx.location.upsert({ where: { name: parsed.data.name }, create: parsed.data, update: { icon: parsed.data.icon, color: parsed.data.color, thumbnailUrl: parsed.data.thumbnailUrl } });
        if (typeof source.id === "string") {
          locationIdMap.set(source.id, location.id);
          locationParentMap.set(location.id, typeof source.parentId === "string" ? source.parentId : null);
        }
        locations += 1;
      }
      for (const [locationId, sourceParentId] of locationParentMap) {
        const parentId = sourceParentId ? locationIdMap.get(sourceParentId) || null : null;
        if (parentId && parentId !== locationId) await tx.location.update({ where: { id: locationId }, data: { parentId } });
      }
      for (const row of (body.items || []).slice(0, 2000)) {
        const source = row as Record<string, unknown>;
        const parsed = itemSchema.omit({ recordPurchase: true, purchaseStore: true }).safeParse({ ...source, purchaseDate: typeof source.purchaseDate === "string" ? source.purchaseDate.slice(0, 10) : source.purchaseDate, expiryDate: typeof source.expiryDate === "string" ? source.expiryDate.slice(0, 10) : source.expiryDate, locationId: typeof source.locationId === "string" ? locationIdMap.get(source.locationId) || null : null });
        if (!parsed.success) continue;
        const data = parsed.data;
        const duplicate = await tx.item.findFirst({ where: { name: data.name, locationId: data.locationId, deletedAt: null } });
        const restored = duplicate || await tx.item.create({ data: { ...data, quantity: normalizeItemQuantity(data.quantity, data.unit), itemCode: createItemCode() } });
        if (typeof source.id === "string") itemIdMap.set(source.id, restored.id);
        if (duplicate) continue;
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
        const purchasedAt = typeof source.purchasedAt === "string" ? new Date(source.purchasedAt) : new Date();
        if (Number.isNaN(purchasedAt.getTime())) continue;
        const quantity = typeof source.quantity === "number" ? source.quantity : 1;
        const store = typeof source.store === "string" ? source.store : null;
        const notes = typeof source.notes === "string" ? source.notes : null;
        const itemId = typeof source.itemId === "string" ? itemIdMap.get(source.itemId) || null : null;
        const duplicate = await tx.priceRecord.findFirst({ where: { itemId, itemName: source.itemName, unitPrice: source.unitPrice, quantity, totalPrice: source.totalPrice, purchasedAt, store } });
        if (duplicate) continue;
        await tx.priceRecord.create({ data: { itemId, itemName: source.itemName, category: source.category, unitPrice: source.unitPrice, quantity, totalPrice: source.totalPrice, purchasedAt, store, notes } });
        priceRecords += 1;
      }
      for (const row of (body.members || []).slice(0, 100)) {
        const source = row as Record<string, unknown>;
        if (typeof source.name !== "string" || !source.name.trim()) continue;
        const existing = await tx.householdMember.findFirst({ where: { name: source.name.trim() } });
        if (existing) continue;
        await tx.householdMember.create({ data: { name: source.name.trim(), color: typeof source.color === "string" ? source.color : "#7c3aed" } });
        members += 1;
      }
      await tx.activityLog.create({ data: { action: "BACKUP_RESTORE", userId: user.id, detail: `合并恢复：${items} 件物品、${locations} 个空间、${shopping} 条采购、${priceRecords} 条价格记录、${members} 位成员` } });
      return { locations, items, shopping, priceRecords, members };
    });
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
