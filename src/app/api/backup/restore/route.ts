import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { localDateOf } from "@/lib/local-date";
import { prisma } from "@/lib/prisma";
import { apiError, requireAdminUser } from "@/lib/api";
import { backupDir, isBackupFileName } from "@/lib/backup-files";
import { MAX_BACKUP_BYTES, backupTooLargeMessage } from "@/lib/backup-limits";
import { auditCountRangeMessage, clampAuditConfirmed, isAuditCount } from "@/lib/audit-limits";
import { usableAmount, usablePercent } from "@/lib/restore-guards";
import { PREFERENCE_LIMITS, clampPreferenceInt } from "@/lib/preference-limits";
import { createItemCode } from "@/lib/item-code";
import { normalizeItemQuantity } from "@/lib/item-metrics";
import { itemSchema, locationSchema, shoppingSchema } from "@/lib/validation";

type BackupPayload = { items?: unknown[]; locations?: unknown[]; shopping?: unknown[]; priceRecords?: unknown[]; members?: unknown[]; activities?: unknown[]; tasks?: unknown[]; audits?: unknown[]; preferences?: unknown[] };

/**
 * 每类数据单次恢复的上限。超过上限的部分**必须如实回报** —— 此前只有活动记录报了
 * notImported,其余几类直接 slice 掉、响应里 skipped 还是 0:
 * 实测提交 2050 条物品,只导入 2000 条,响应却像「全都恢复了」,用户少了 50 件也不知道。
 */
const RESTORE_LIMITS = {
  locations: 200,
  items: 2000,
  shopping: 1000,
  priceRecords: 5000,
  members: 100,
  tasks: 500,
  audits: 500,
  activities: 2000,
  preferences: 1,
} as const;

/** Safely merges a trusted export into the current household without deleting existing records. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAdminUser();
    // 1 先按声明的长度拦超限请求:实测 70 MB 的备份会**在解析前被截断**,
    //   request.json() 抛 SyntaxError,而 apiError 把它翻成「请求内容不是合法的 JSON」——
    //   用户的文件明明是合法的,却被告知文件坏了。这里如实说「太大了」并给出可照做的建议。
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BACKUP_BYTES) {
      return NextResponse.json(
        { error: backupTooLargeMessage(declared), code: "BACKUP_TOO_LARGE", limit: MAX_BACKUP_BYTES },
        { status: 413 },
      );
    }
    const parsedBody = await request.json() as BackupPayload & { fromFile?: unknown };
    // 2 也允许「从服务器上的那份自动备份恢复」:备份超过请求上限时这是唯一可行的路
    //   (服务器本来就每天写一份到磁盘,不必再上传一遍)。
    let body: BackupPayload = parsedBody;
    let sourceFile: string | null = null;
    if (typeof parsedBody.fromFile === "string") {
      const name = parsedBody.fromFile.trim();
      if (!isBackupFileName(name)) {
        return NextResponse.json({ error: "备份文件名不合法(只接受 home-inventory-年-月-日.json)" }, { status: 400 });
      }
      const file = path.join(backupDir(), name);
      const text = await readFile(file, "utf8").catch(() => null);
      if (text === null) return NextResponse.json({ error: `服务器上找不到这份备份:${name}` }, { status: 404 });
      try {
        body = JSON.parse(text) as BackupPayload;
      } catch {
        return NextResponse.json({ error: `服务器上这份备份不是合法的 JSON:${name}` }, { status: 400 });
      }
      sourceFile = name;
    }
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
      // 「与库里已有记录重复」而跳过的,也要计数 —— 否则换机迁移时用户完全看不出少了什么。
      let duplicatedTotal = 0;
      const duplicatedExamples: { collection: string; name: string | null }[] = [];
      const noteDuplicated = (collection: string, name: unknown) => {
        duplicatedTotal += 1;
        if (duplicatedExamples.length < 10) duplicatedExamples.push({ collection, name: typeof name === "string" ? name.slice(0, 40) : null });
      };
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
        // 优先按 itemCode 判重:它唯一且备里就有 —— 换机到空库时同名物品不会被误判成「重复」。
        // 只有老备份(没有 itemCode)才退回按名称+位置判重。
        const sourceCode = typeof source.itemCode === "string" && source.itemCode.trim() ? source.itemCode.trim() : null;
        const duplicate = sourceCode
          ? await tx.item.findFirst({ where: { itemCode: sourceCode } })
          : await tx.item.findFirst({ where: { name: data.name, locationId: data.locationId, deletedAt: null } });
        // 保留备份里的编号(用户可能已经把编号贴成标签);没有编号的老备份才新生成。
        // 编号被占用的情况在去重那一步已经排除了(按编号判重)。
        const restored = duplicate || await tx.item.create({ data: { ...data, quantity: normalizeItemQuantity(data.quantity, data.unit), itemCode: sourceCode ?? createItemCode() } });
        if (typeof source.id === "string") itemIdMap.set(source.id, restored.id);
        if (duplicate) { noteDuplicated("items", data.name); continue; }
        items += 1;
      }
      for (const row of (body.shopping || []).slice(0, 1000)) {
        const source = row as Record<string, unknown>;
        const parsed = shoppingSchema.safeParse(source);
        if (!parsed.success) { noteSkipped("shopping", (body.shopping || []).indexOf(row), source.name, describeIssue(parsed.error.issues[0] ?? {})); continue; }
        const duplicate = await tx.shoppingItem.findFirst({ where: { name: parsed.data.name, status: "PENDING" } });
        if (duplicate) { noteDuplicated("shopping", parsed.data.name); continue; }
        await tx.shoppingItem.create({ data: { ...parsed.data, status: source.status === "PURCHASED" ? "PURCHASED" : "PENDING" } });
        shopping += 1;
      }
      for (const row of (body.priceRecords || []).slice(0, 5000)) {
        const source = row as Record<string, unknown>;
        if (typeof source.itemName !== "string" || typeof source.category !== "string" || typeof source.unitPrice !== "number" || typeof source.totalPrice !== "number") { noteSkipped("priceRecords", (body.priceRecords || []).indexOf(row), source.itemName, "价格记录缺少必填字段"); continue; }
        const purchasedAt = typeof source.purchasedAt === "string" ? new Date(source.purchasedAt) : new Date();
        if (Number.isNaN(purchasedAt.getTime())) continue;
        const quantity = typeof source.quantity === "number" ? source.quantity : 1;
        // 金额与数量都不可能是负数(界面里最小就是 0)。恢复是外部文件进库的唯一通道,
        // 实测修之前:`unitPrice: -100, totalPrice: -100, quantity: -2` 一路写进库,
        // 月报支出与估算价值会被这些负数拉低 —— 而界面上根本没有能录负价的入口。
        if (![source.unitPrice, source.totalPrice, quantity].every((value) => usableAmount(value))) {
          noteSkipped("priceRecords", (body.priceRecords || []).indexOf(row), source.itemName, "单价 / 总价 / 数量不能为负");
          continue;
        }
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
        // 接口会拒绝的数值,从备份里也不该写得进去(实测修之前:10 亿原样落库,永久留在盘点历史)。
        const confirmedSource = Number.isFinite(Number(source.confirmed)) ? Number(source.confirmed) : 0;
        if (!isAuditCount(total) || !isAuditCount(confirmedSource)) { noteSkipped("audits", (body.audits || []).indexOf(row), null, auditCountRangeMessage()); continue; }
        const locationName = typeof source.locationName === "string" ? source.locationName : "全部空间";
        const duplicate = await tx.auditRecord.findFirst({ where: { finishedAt, locationName, total } });
        if (duplicate) continue;
        await tx.auditRecord.create({ data: { total: Math.round(total), confirmed: clampAuditConfirmed(total, confirmedSource), locationName, finishedAt } });
        audits += 1;
      }
      for (const row of (body.preferences || []).slice(0, 1)) {
        const source = row as Record<string, unknown>;
        // 值域与设置接口共用一份(实测修之前:负数提醒窗口、99 这样的星期都被原样写进库,
        // 而同样的值走设置接口会被 400 拒掉)。越界夹到边界,非法值用默认值;合法的字段原样保留。
        const data = {
          expiryReminderDays: clampPreferenceInt(source.expiryReminderDays, PREFERENCE_LIMITS.expiryReminderDays),
          lowStockReminder: source.lowStockReminder !== false,
          weeklyReviewEnabled: source.weeklyReviewEnabled !== false,
          weeklyReviewDay: clampPreferenceInt(source.weeklyReviewDay, PREFERENCE_LIMITS.weeklyReviewDay),
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
          // 余量型消耗的两个标记也要一起搬过去:丢了它们,迁移后的「撤销消耗」就只能拒绝
          // (见 lib/consume-undo 的 legacy 分支),用户会以为换机把功能弄坏了。
          // 但只搬**合理范围**内的值:实测修之前,备份里一条 `percentBefore: 150` 恢复进库后,
          // 点「撤销消耗」会把物品余量写成 150%(任何正常写入路径都产生不了的状态)。
          // 越界就当没有这两个标记 —— 宁可让撤销按「旧记录」拒绝,也不要拿越界值去改库存。
          percentBefore: usablePercent(source.percentBefore),
          percentAfter: usablePercent(source.percentAfter),
        } });
        activities += 1;
      }
      const activitiesNotImported = Math.max(0, activityRows.length - recentActivities.length);
            // 逐类算出「因为超过上限而没恢复」的条数:静默丢数据比恢复失败更糟 ——
            // 恢复失败用户会重试,静默丢数据用户永远不知道。
            // 实测(修之前)提交 2050 条物品:只导入 2000 条,响应里 skipped 仍是 0、
            // notImported 只提活动记录,看起来像「全都恢复了」。
            const truncated: Record<string, number> = {};
            for (const [collection, limit] of Object.entries(RESTORE_LIMITS)) {
              if (collection === "activities") continue; // 活动记录另有 notImported 口径
              const rows = (body as Record<string, unknown>)[collection];
              const total = Array.isArray(rows) ? rows.length : 0;
              if (total > limit) truncated[collection] = total - limit;
            }
            const truncatedTotal = Object.values(truncated).reduce((sum, value) => sum + value, 0);
            const notImported: Record<string, number> = { activities: activitiesNotImported };
            for (const [collection, count] of Object.entries(truncated)) notImported[collection] = count;
            await tx.activityLog.create({ data: { action: "BACKUP_RESTORE", userId: user.id, detail: `合并恢复:${items} 件物品、${locations} 个空间、${shopping} 条采购、${priceRecords} 条价格记录、${members} 位成员` } });
            return {
              locations, items, shopping, priceRecords, members, activities, tasks, audits, preferences,
              notImported,
              // 超过单次上限而没恢复的条数(按类别);truncatedTotal 为 0 才代表备份里每一行都处理过了。
              truncated,
              truncatedTotal,
              sourceFile,
        skipped: { total: skippedTotal, examples: skippedExamples },
              duplicated: { total: duplicatedTotal, examples: duplicatedExamples },
            };
    }, { timeout: 120_000, maxWait: 10_000 });
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
