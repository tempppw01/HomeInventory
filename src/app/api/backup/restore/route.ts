import { NextRequest, NextResponse } from "next/server";
import { localDateOf } from "@/lib/local-date";
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
      // 校验不过的行会被跳过 —— 必须记下来并回报,否则用户以为全都恢复了。
      let skippedTotal = 0;
      const skippedExamples: { collection: string; row: number; name: string | null; reason: string }[] = [];
      // 把 zod 的英文原文翻成中文,并点出是哪个字段 —— 用户要按这个去改备份文件。
      const FIELD_LABELS: Record<string, string> = {
        name: "名称", category: "分类", type: "类型", quantity: "数量", minQuantity: "最低数量",
        remainingPercent: "剩余量", unit: "单位", price: "单价", purchaseDate: "购入日期",
        expiryDate: "到期日期", locationId: "存放位置", notes: "备注", status: "状态", color: "颜色", icon: "图标",
      };
      const describeIssue = (issue: { path?: (string | number)[]; code?: string; message?: string }) => {
        const field = Array.isArray(issue.path) && issue.path.length ? String(issue.path[0]) : "";
        const label = FIELD_LABELS[field] ?? field;
        const message = issue.message ?? "";
        if (/required/i.test(message) || issue.code === "invalid_type" && /undefined|null/i.test(message)) return `缺少「${label}」`;
        if (issue.code === "invalid_enum_value" || /invalid enum value/i.test(message)) return `「${label}」只能是 DURABLE 或 CONSUMABLE`;
        if (/expected number|received nan/i.test(message)) return `「${label}」不是有效的数字`;
        if (/too small|too big|at least|at most/i.test(message)) return `「${label}」${message}`;
        return label ? `「${label}」${message}` : message || "格式不认识";
      };
      const noteSkipped = (collection: string, rowIndex: number, name: unknown, reason: string) => {
        skippedTotal += 1;
        if (skippedExamples.length < 10) skippedExamples.push({ collection, row: rowIndex + 1, name: typeof name === "string" ? name.slice(0, 40) : null, reason });
      };
      for (const row of (body.locations || []).slice(0, 200)) {
        const source = row as Record<string, unknown>;
        const parsed = locationSchema.safeParse({ name: source.name, icon: source.icon, color: source.color, thumbnailUrl: source.thumbnailUrl });
        if (!parsed.success) { noteSkipped("locations", (body.locations || []).indexOf(row), source.name, describeIssue(parsed.error.issues[0] ?? {})); continue; }
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
        const parsed = itemSchema.omit({ recordPurchase: true, purchaseStore: true }).safeParse({ ...source, purchaseDate: typeof source.purchaseDate === "string" ? localDateOf(source.purchaseDate) : source.purchaseDate, expiryDate: typeof source.expiryDate === "string" ? localDateOf(source.expiryDate) : source.expiryDate, locationId: typeof source.locationId === "string" ? locationIdMap.get(source.locationId) || null : null });
        if (!parsed.success) { noteSkipped("items", (body.items || []).indexOf(row), source.name, describeIssue(parsed.error.issues[0] ?? {})); continue; }
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
        if (!parsed.success) { noteSkipped("shopping", (body.shopping || []).indexOf(row), source.name, describeIssue(parsed.error.issues[0] ?? {})); continue; }
        const duplicate = await tx.shoppingItem.findFirst({ where: { name: parsed.data.name, status: "PENDING" } });
        if (duplicate) continue;
        await tx.shoppingItem.create({ data: { ...parsed.data, status: source.status === "PURCHASED" ? "PURCHASED" : "PENDING" } });
        shopping += 1;
      }
      for (const row of (body.priceRecords || []).slice(0, 5000)) {
        const source = row as Record<string, unknown>;
        if (typeof source.itemName !== "string" || typeof source.category !== "string" || typeof source.unitPrice !== "number" || typeof source.totalPrice !== "number") { noteSkipped("priceRecords", (body.priceRecords || []).indexOf(row), source.itemName, "价格记录缺少必填字段"); continue; }
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
      return { locations, items, shopping, priceRecords, members, skipped: { total: skippedTotal, examples: skippedExamples } };
    });
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
