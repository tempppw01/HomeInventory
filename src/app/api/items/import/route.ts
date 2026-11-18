import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { createItemCode } from "@/lib/item-code";
import { itemSchema } from "@/lib/validation";
import { normalizeItemQuantity } from "@/lib/item-metrics";
import { itemInsight } from "@/lib/item-insight";

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
      // itemSchema 不包含 locationName(zod 会剥掉未声明字段),所以在这里显式带上,
      // 交给后面的「按名字解析空间」使用。
      const locationName = typeof source.locationName === "string" ? source.locationName.trim() : "";
      return [locationName ? { ...result.data, locationName } : result.data];
    });
    if (!parsedRows.length && errors.length) return NextResponse.json({ count: 0, errors }, { status: 400 });

    // 「存放位置」列只给了名字:按名字匹配已有空间,缺失的在事务里创建(并在响应里回报),
    // 否则从表格导入的物品会全部失去位置信息,冰箱清单/空间页都看不到它们。
    const wantedNames = [...new Set(parsedRows
      .map((row) => String((row as Record<string, unknown>).locationName ?? "").trim())
      .filter(Boolean))];
    const existingLocations = wantedNames.length
      ? await prisma.location.findMany({ where: { name: { in: wantedNames } }, select: { id: true, name: true } })
      : [];
    const locationIdByName = new Map(existingLocations.map((row) => [row.name, row.id]));
    const missingNames = wantedNames.filter((name) => !locationIdByName.has(name));
    const count = await prisma.$transaction(async (tx) => {
      let createdCount = 0;
      // 表格里出现、但系统里还没有的空间:直接建出来,并在响应里回报,避免用户以为位置丢了。
      for (const name of missingNames) {
        const created = await tx.location.create({ data: { name, icon: "Package", color: "#7c3aed" } });
        locationIdByName.set(name, created.id);
      }
      for (const data of parsedRows) {
        const { recordPurchase, purchaseStore, locationName, ...itemData } = data as typeof data & { locationName?: string };
        const wantedLocation = String(locationName ?? "").trim();
        const resolvedLocationId = wantedLocation ? (locationIdByName.get(wantedLocation) ?? null) : null;
        const normalized = { ...itemData, ...(resolvedLocationId ? { locationId: resolvedLocationId } : {}), quantity: normalizeItemQuantity(itemData.quantity, itemData.unit) };
        // 导入也要跑一遍后台洞察,否则这批物品在「需冷藏」「自动标签」里是隐形的。
        const insight = itemInsight({ name: normalized.name, category: normalized.category, unit: normalized.unit, type: normalized.type });
        const item = await tx.item.create({ data: { ...normalized, expiryDate: normalized.type === "DURABLE" ? null : normalized.expiryDate, itemCode: createItemCode(), storage: insight.storage, storageReason: insight.storageReason, autoTags: insight.tags.join(",") } });
        if (recordPurchase && normalized.price != null) {
          const quantity = Math.max(normalized.quantity, 1);
          await tx.priceRecord.create({ data: { itemId: item.id, itemName: item.name, category: item.category, unitPrice: normalized.price, quantity, totalPrice: normalized.price * quantity, purchasedAt: normalized.purchaseDate || new Date(), store: purchaseStore } });
        }
        await tx.activityLog.create({ data: { action: "CREATE", itemId: item.id, itemName: item.name, userId: user.id, detail: "JSON 导入" } });
        createdCount += 1;
      }
      return createdCount;
    });
    return NextResponse.json({ count, errors, truncated: rows.length > 1000, createdLocations: missingNames }, { status: 201 });
  } catch (error) { return apiError(error); }
}
