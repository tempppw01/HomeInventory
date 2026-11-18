import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { itemSchema } from "@/lib/validation";
import { apiError, requireWritableUser } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { createItemCode } from "@/lib/item-code";
import { needsRestock, normalizeItemQuantity, restockQuantity } from "@/lib/item-metrics";
import { itemInsight } from "@/lib/item-insight";

export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const search = request.nextUrl.searchParams.get("q")?.trim();
    const deleted = request.nextUrl.searchParams.get("deleted") === "1";
    const exportData = request.nextUrl.searchParams.get("export") === "1";
    const includeDeleted = request.nextUrl.searchParams.get("includeDeleted") === "1";
    const items = await prisma.item.findMany({
      // 搜索也覆盖后台自动标签:搜「冷藏」「饮料」这类词也能命中。
      where: { deletedAt: deleted ? { not: null } : includeDeleted ? undefined : null, ...(search ? { OR: [{ name: { contains: search } }, { category: { contains: search } }, { notes: { contains: search } }, { autoTags: { contains: search } }] } : {}) },
      include: { location: true },
      orderBy: { updatedAt: "desc" },
    });
    if (exportData) return new NextResponse(JSON.stringify(items, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": "attachment; filename=home-inventory-items.json" } });
    return NextResponse.json(items);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireWritableUser();
    const { recordPurchase, purchaseStore, ...parsed } = itemSchema.parse(await request.json());
    const normalized = { ...parsed, quantity: normalizeItemQuantity(parsed.quantity, parsed.unit) };
    const data = normalized.type === "DURABLE" ? { ...normalized, expiryDate: null } : normalized;
    const item = await prisma.$transaction(async (tx) => {
      // 后台自动洞察:不依赖任何用户操作,保存时就把存放建议与标签算好。
      const insight = itemInsight({ name: data.name, category: data.category, unit: data.unit, type: data.type as unknown as "DURABLE" | "CONSUMABLE" });
      const created = await tx.item.create({ data: { ...data, itemCode: createItemCode(), storage: insight.storage, storageReason: insight.storageReason, autoTags: insight.tags.join(",") }, include: { location: true } });
      if (recordPurchase && data.price != null) {
        await tx.priceRecord.create({ data: { itemId: created.id, itemName: created.name, category: created.category, unitPrice: data.price, quantity: Math.max(data.quantity, 1), totalPrice: data.price * Math.max(data.quantity, 1), purchasedAt: data.purchaseDate || new Date(), store: purchaseStore } });
      }
      await tx.activityLog.create({ data: { action: "CREATE", itemId: created.id, itemName: created.name, userId: user.id, detail: "录入物品" } });
      return created;
    });

    if (needsRestock(item)) {
      const existing = await prisma.shoppingItem.findFirst({ where: { name: item.name, status: "PENDING" } });
      if (!existing) await prisma.shoppingItem.create({
        data: { name: item.name, quantity: restockQuantity(item), unit: item.unit, category: item.category, priority: 2, source: "low-stock" },
      });
    }
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
