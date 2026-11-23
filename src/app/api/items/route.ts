import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { itemSchema } from "@/lib/validation";
import { apiError, requireWritableUser } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { createItemCode } from "@/lib/item-code";
import { normalizeItemQuantity } from "@/lib/item-metrics";
import { itemInsight } from "@/lib/item-insight";
import { enqueueItemAnalysis } from "@/lib/ai-queue";
import { ensureRestockSuggestion } from "@/lib/restock-suggestion";
import { compressedJson } from "@/lib/next-json";

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
    // 导出分支**一个字节都不动**:那是备份用的完整转储,格式就是契约
    if (exportData) return new NextResponse(JSON.stringify(items, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": "attachment; filename=home-inventory-items.json" } });
    // 列表响应只需要位置的名字:界面读 item.location 的地方全都在读 .name,
    // 而整份位置实体(icon/color/parentId/时间戳)在**每一行**里重复出现,
    // 1200 件物品时占了整份载荷的约 1/5。完整字段请走 /api/dashboard 的 locations。
    return compressedJson(items.map(({ location, ...rest }) => ({ ...rest, location: location ? { id: location.id, name: location.name } : null })), request);
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

    // 放进事务里:此前是「先查后建」,并发请求会各建一条(实测 6 个并发 → 6 条重复建议)
    await prisma.$transaction((tx) => ensureRestockSuggestion(tx, item));
    // 后台自动分析:不 await,保存立刻返回;结果稍后写回 aiSummary 等字段。
    enqueueItemAnalysis(item.id);
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
