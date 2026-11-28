import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { itemSchema } from "@/lib/validation";
import { apiError, requireWritableUser } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { createItemCode } from "@/lib/item-code";
import { normalizeItemQuantity } from "@/lib/item-metrics";
import { itemInsightFields } from "@/lib/item-insight";
import { enqueueItemAnalysis } from "@/lib/ai-queue";
import { ensureRestockSuggestion } from "@/lib/restock-suggestion";
import { compressedJson } from "@/lib/next-json";
import { normalizeOpId, runOnce } from "@/lib/idempotency";

export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const search = request.nextUrl.searchParams.get("q")?.trim();
    const deleted = request.nextUrl.searchParams.get("deleted") === "1";
    const exportData = request.nextUrl.searchParams.get("export") === "1";
    const includeDeleted = request.nextUrl.searchParams.get("includeDeleted") === "1";
    const items = await prisma.item.findMany({
      // 搜索字段与界面共用一份定义(lib/item-search):名称/编号/分类/备注/自动标签/空间名。
      // 此前这里有备注却没有编号与空间名,而界面正好相反 —— 输入编号时下拉有建议、接口零结果。
      where: { deletedAt: deleted ? { not: null } : includeDeleted ? undefined : null, ...(search ? { OR: [{ name: { contains: search } }, { itemCode: { contains: search } }, { category: { contains: search } }, { notes: { contains: search } }, { autoTags: { contains: search } }, { location: { name: { contains: search } } }] } : {}) },
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
    // 客户端(含离线队列重放)带的唯一操作号:同一个号只录入一次。
    // 断网时记下的「录入物品」会在恢复网络后重放,而重放多一次就是家里凭空多一件东西。
    const opId = normalizeOpId(request.headers.get("x-guiwu-op-id"));
    const outcome = await runOnce(opId, "item.create", () => prisma.$transaction(async (tx) => {
      // 后台自动洞察:不依赖任何用户操作,保存时就把存放建议与标签算好。
      const created = await tx.item.create({ data: { ...data, itemCode: createItemCode(), ...itemInsightFields({ name: data.name, category: data.category, unit: data.unit, type: data.type as unknown as "DURABLE" | "CONSUMABLE" }) }, include: { location: true } });
      if (recordPurchase && data.price != null) {
        await tx.priceRecord.create({ data: { itemId: created.id, itemName: created.name, category: created.category, unitPrice: data.price, quantity: Math.max(data.quantity, 1), totalPrice: data.price * Math.max(data.quantity, 1), purchasedAt: data.purchaseDate || new Date(), store: purchaseStore } });
      }
      await tx.activityLog.create({ data: { action: "CREATE", itemId: created.id, itemName: created.name, userId: user.id, detail: "录入物品" } });
      return created;
    }));
    if (outcome.replay) {
      // 重放:上次已经录进去了。有结果就把上次那条原样回给他(多一个 deduplicated 标记);
      // 结果还没写回来时说清「在处理」,**绝不重复建一件**。
      if (outcome.result) return NextResponse.json({ ...outcome.result, deduplicated: true }, { status: 201 });
      return NextResponse.json({ error: "这件物品正在录入,请稍后刷新", deduplicated: true }, { status: 503 });
    }
    const item = outcome.result;

    // 放进事务里:此前是「先查后建」,并发请求会各建一条(实测 6 个并发 → 6 条重复建议)
    await prisma.$transaction((tx) => ensureRestockSuggestion(tx, item));
    // 后台自动分析:不 await,保存立刻返回;结果稍后写回 aiSummary 等字段。
    enqueueItemAnalysis(item.id);
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
