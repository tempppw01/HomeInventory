import { NextRequest, NextResponse } from "next/server";
import { localDateOf } from "@/lib/local-date";
import { prisma } from "@/lib/prisma";
import { apiError, requireAdminUser } from "@/lib/api";
import { createItemCode } from "@/lib/item-code";
import { normalizeItemQuantity } from "@/lib/item-metrics";
import { itemSchema, locationSchema, shoppingSchema } from "@/lib/validation";

type BackupPayload = { items?: unknown[]; locations?: unknown[]; shopping?: unknown[]; priceRecords?: unknown[]; members?: unknown[]; activities?: unknown[]; tasks?: unknown[]; audits?: unknown[]; preferences?: unknown[] };

/** Safely merges a trusted export into the current household without deleting existing records. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAdminUser();
    const body = await request.json() as BackupPayload;
    if (!Array.isArray(body.items) && !Array.isArray(body.locations) && !Array.isArray(body.shopping)) {
      return NextResponse.json({ error: "备份文件中没有可恢复的数据" }, { status: 400 });
    }
    // 逐行处理几千行时,Prisma 交互式事务的默认上限(5 秒)远远不够 —— 大备份会直接 P2028。
    // 这里放宽到 2 分钟,并把等待连接的时间也放宽(默认 2 秒)。
    const result = await prisma.$transaction(async (tx) => {
      const locationIdMap = new Map<string, string>();
      const itemIdMap = new Map<string, string>();
      const locationParentMap = new Map<string, string | null>();
      let locations = 0, items = 0, shopping = 0, priceRecords = 0, members = 0, activities = 0, tasks = 0, audits = 0, preferences = 0;
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
      // ---------- 任务 / 盘点记录 / 偏好设置 / 活动记录 ----------
      // 用户/成员 id 在别的安装上没有意义,一律置空;物品 id 通过 itemIdMap 映射到新库。
      const parseDate = (value: unknown) => {
        if (typeof value !== "string" || !value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
      };
      for (const row of (body.tasks || []).slice(0, 500)) {
        const source = row as Record<string, unknown>;
        const title = typeof source.title === "string" ? source.title.trim() : "";
        const dueAt = parseDate(source.dueAt);
        if (!title || !dueAt) { noteSkipped("tasks", (body.tasks || []).indexOf(row), source.title, "缺少标题或到期时间"); continue; }
        const duplicate = await tx.householdTask.findFirst({ where: { title, dueAt } });
        if (duplicate) continue;
        await tx.householdTask.create({ data: {
          title,
          description: typeof source.description === "string" ? source.description : null,
          dueAt,
          recurrence: typeof source.recurrence === "string" ? source.recurrence : "NONE",
          status: source.status === "DONE" ? "DONE" : "OPEN",
          completedAt: parseDate(source.completedAt),
          nextDueAt: parseDate(source.nextDueAt),
        } });
        tasks += 1;
      }
      for (const row of (body.audits || []).slice(0, 500)) {
        const source = row as Record<string, unknown>;
        const finishedAt = parseDate(source.finishedAt);
        const total = Number(source.total);
        if (!finishedAt || !Number.isFinite(total)) { noteSkipped("audits", (body.audits || []).indexOf(row), null, "缺少结束时间或总数"); continue; }
        const locationName = typeof source.locationName === "string" ? source.locationName : "全部空间";
        const duplicate = await tx.auditRecord.findFirst({ where: { finishedAt, locationName, total } });
        if (duplicate) continue;
        await tx.auditRecord.create({ data: { total, confirmed: Number.isFinite(Number(source.confirmed)) ? Number(source.confirmed) : 0, locationName, finishedAt } });
        audits += 1;
      }
      for (const row of (body.preferences || []).slice(0, 1)) {
        const source = row as Record<string, unknown>;
        const data = {
          expiryReminderDays: Number.isFinite(Number(source.expiryReminderDays)) ? Number(source.expiryReminderDays) : 7,
          lowStockReminder: source.lowStockReminder !== false,
          weeklyReviewEnabled: source.weeklyReviewEnabled !== false,
          weeklyReviewDay: Number.isFinite(Number(source.weeklyReviewDay)) ? Number(source.weeklyReviewDay) : 0,
        };
        await tx.householdPreference.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
        preferences += 1;
      }
      // 活动记录:备份文件里一直都有,但此前恢复端**完全没处理**。这里导入最近 2000 条,
      // 并把「还有多少条没导」如实回报 —— 不假装全都恢复了。
      const ACTIVITY_LIMIT = 2000;
      const activityRows = (body.activities || []);
      const recentActivities = activityRows.slice(-ACTIVITY_LIMIT).reverse();
      for (const row of recentActivities) {
        const source = row as Record<string, unknown>;
        const createdAt = parseDate(source.createdAt);
        const action = typeof source.action === "string" ? source.action : "";
        if (!action || !createdAt) continue;
        const duplicate = await tx.activityLog.findFirst({ where: { action, createdAt, itemName: typeof source.itemName === "string" ? source.itemName : null } });
        if (duplicate) continue;
        await tx.activityLog.create({ data: {
          action,
          createdAt,
          itemId: typeof source.itemId === "string" ? itemIdMap.get(source.itemId) ?? null : null,
          itemName: typeof source.itemName === "string" ? source.itemName : null,
          detail: typeof source.detail === "string" ? source.detail : null,
        } });
        activities += 1;
      }
      const activitiesNotImported = Math.max(0, activityRows.length - recentActivities.length);
      await tx.activityLog.create({ data: { action: "BACKUP_RESTORE", userId: user.id, detail: `合并恢复：${items} 件物品、${locations} 个空间、${shopping} 条采购、${priceRecords} 条价格记录、${members} 位成员` } });
      return { locations, items, shopping, priceRecords, members, activities, tasks, audits, preferences, notImported: { activities: activitiesNotImported }, skipped: { total: skippedTotal, examples: skippedExamples } };
    }, { timeout: 120_000, maxWait: 10_000 });
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
