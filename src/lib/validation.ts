import { z } from "zod";

// 日期字段接受两种写法:
//   · 2026-11-20            —— 界面日期控件提交的格式
//   · 2026-11-20T03:00:00Z  —— 接口调用、脚本、备份数据里的 ISO 写法
// 之前只允许前者(z.string().date()),传 ISO 会被 400 拒掉,
// 而错误信息是英文的「Invalid date」,调用方看不出该怎么改。
// 这里统一按**日期部分**解析(忽略时间与时区),避免 UTC 偏移把日期挪错一天。
const optionalDate = z
  .union([z.string(), z.literal(""), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value == null || value === "") return null;
    const raw = String(value).trim();
    // 只认标准 ISO 8601 时间(可带时区)。不能用「JS 能解析就算数」:
    // 那样 2026/12/31、Dec 31 2026 之类也会被接受,非法输入就漏过去了。
    const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    let year; let month; let day;
    if (dateOnly) {
      [, year, month, day] = dateOnly;
    } else if (isoDateTime.test(raw)) {
      // 兼容 ISO 时间戳(旧备份、外部调用):按 **UTC 日历日**取值。
      //
      // 为什么不按「本地日」:服务器时区会变(本机 Windows 是 +08,生产 Docker 是 UTC),
      // 同一份备份在两处会恢复出不同日期。UTC 是唯一机器无关的取法。
      // 局限:旧备份由 +08 的服务器导出时是「本地零点 → UTC 前一天 16:00」,
      // 这类记录按 UTC 取值会比原意早一天;新导出的备份已改为 YYYY-MM-DD,不再有歧义。
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "日期格式不正确,应为 2026-11-20" });
        return z.NEVER;
      }
      year = String(parsed.getUTCFullYear());
      month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
      day = String(parsed.getUTCDate()).padStart(2, "0");
    } else {
      // 既不是 YYYY-MM-DD,也不是标准 ISO 时间 → 明确拒绝(不要落到下面按 NaN 处理)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "日期格式不正确,应为 2026-11-20" });
      return z.NEVER;
    }
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    // 2026-02-31 这类「格式对但日子不存在」的日期会被自动进位,这里挡掉。
    if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "这个日期不存在,请检查" });
      return z.NEVER;
    }
    return date;
  });

// Images can be hosted by OSS (absolute URL) or served by the local upload
// route. Keep local paths scoped to that route so arbitrary relative paths and
// traversal segments cannot be persisted as image URLs.
const imageUrlSchema = z.union([
  z.string().url().max(1000),
  z.string()
    .max(1000)
    .regex(/^\/api\/uploads\/[A-Za-z0-9/_-]+(?:\.[A-Za-z0-9_-]+)?$/)
    .refine((value) => !value.includes("..")),
]);

export const itemSchema = z.object({
  name: z.string().trim().min(1, "请输入物品名称").max(80, "物品名称最多 80 个字"),
  category: z.string().trim().min(1, "请选择或输入分类").max(40, "分类最多 40 个字"),
  type: z.enum(["DURABLE", "CONSUMABLE"]),
  quantity: z.coerce.number().min(0).max(999999),
  minQuantity: z.coerce.number().min(0).max(999999).default(0),
  remainingPercent: z.coerce.number().min(0).max(100).default(100),
  unit: z.string().trim().min(1).max(12, "单位最多 12 个字"),
  price: z.union([z.coerce.number().min(0), z.literal(""), z.null()]).optional().transform((value) => value === "" || value == null ? null : value),
  purchaseDate: optionalDate,
  expiryDate: optionalDate,
  imageUrl: z.union([imageUrlSchema, z.literal(""), z.null()]).optional().transform((value) => value || null),
  locationId: z.union([z.string(), z.literal(""), z.null()]).optional().transform((value) => value || null),
  notes: z.union([z.string().max(500), z.null()]).optional().transform((value) => value || null),
  aiSummary: z.union([z.string().max(800), z.null()]).optional().transform((value) => value || null),
  aiStorageAdvice: z.union([z.string().max(800), z.null()]).optional().transform((value) => value || null),
  aiUsageAdvice: z.union([z.string().max(800), z.null()]).optional().transform((value) => value || null),
  aiReplenishmentAdvice: z.union([z.string().max(800), z.null()]).optional().transform((value) => value || null),
  recordPurchase: z.boolean().optional().default(false),
  purchaseStore: z.union([z.string().trim().max(80), z.literal(""), z.null()]).optional().transform((value) => value || null),
  restockPausedUntil: z.union([z.string().datetime(), z.literal(""), z.null()]).optional().transform((value) => value ? new Date(value) : null),
  consumeRate: z.coerce.number().min(0).max(999999).optional(),
  // 注意:这个字段是**时间点**,不是日期。
  // 服务端补货入库时写的是 new Date()(完整时间戳),若按 optionalDate 处理会被截断到当天零点、
  // 并在 UTC 取值时挪一天 —— 于是「3 天前补的货」会显示成「4 天前」。
  // 这里与 restockPausedUntil 用同一种处理:保留时刻。
  lastRestockedAt: z.union([z.string().datetime(), z.literal(""), z.null()]).optional().transform((value) => (value ? new Date(value) : null)),
});

export const itemPatchSchema = itemSchema.partial();

// Used by the AI import flow. Keep purchase bookkeeping out of this endpoint so
// importing a set of recognised items remains a single atomic inventory change.
export const batchItemSchema = itemSchema.omit({ recordPurchase: true, purchaseStore: true });

export const bulkItemPatchSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(80)).min(1, "请选择物品").max(100, "单次最多更新 100 件物品"),
  type: z.enum(["DURABLE", "CONSUMABLE"]).optional(),
  unit: z.string().trim().min(1).max(12).optional(),
  minQuantity: z.coerce.number().min(0).max(999999).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  locationId: z.union([z.string().trim().min(1).max(80), z.null()]).optional(),
  restockPausedUntil: z.union([z.string().datetime(), z.null()]).optional().transform((value) => value ? new Date(value) : value),
  /** 撤销「批量移入回收站」:把这些物品从回收站恢复。 */
  restore: z.boolean().optional(),
  /** 批量改数量(盘点后「这些都用掉一半」这类场景)。 */
  quantity: z.coerce.number().min(0).max(999999).optional(),
  /** 批量改剩余百分比(液体消耗品)。 */
  remainingPercent: z.coerce.number().min(0).max(100).optional(),
}).refine((value) => Object.keys(value).some((key) => key !== "ids" && value[key as keyof typeof value] !== undefined), { message: "没有可更新的内容" });

/** 采购项的局部更新:状态、常买标记,以及「已购买后补货到原物品」。 */
export const shoppingPatchSchema = z.object({
  status: z.enum(["PENDING", "PURCHASED"]).optional(),
  isFavorite: z.boolean().optional(),
  quantity: z.coerce.number().min(0).max(999999).optional(),
  replenishItemId: z.union([z.string().trim().min(1).max(80), z.null()]).optional(),
});

/** 任务的增删改。recurrence 用宽松字符串,非法值在路由里降级为 NONE(既有行为)。 */
export const taskCreateSchema = z.object({
  title: z.string().trim().min(1, "请输入任务名称").max(80),
  description: z.string().max(500).optional().nullable(),
  dueAt: z.string().trim().min(1, "请选择有效日期"),
  recurrence: z.string().max(20).optional(),
});

export const taskPatchSchema = z.object({
  id: z.string().trim().min(1).max(80),
  action: z.enum(["toggle", "delete", "undo"]).optional(),
  previousDueAt: z.string().optional(),
});

/** 家庭成员:只需要名字(与颜色)。 */
export const memberSchema = z.object({
  name: z.string().trim().min(1, "请输入成员名称").max(30),
  color: z.string().trim().max(20).optional(),
});

/** 新建账号:用户名规则与前端提示保持一致。 */
export const userCreateSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/, "请填写有效用户名、显示名称和至少 8 位密码"),
  displayName: z.string().trim().min(1, "请填写有效用户名、显示名称和至少 8 位密码").max(40),
  password: z.string().min(8, "请填写有效用户名、显示名称和至少 8 位密码").max(200),
  // 新建账号只允许「成员 / 只读」:管理员由现有管理员在创建后单独授予(界面流程也是如此)。
  // 之前这里接受 ADMIN,而服务端会悄悄降级成 MEMBER —— 传 ADMIN 的人拿到普通成员却毫无提示。
  role: z
    .enum(["MEMBER", "VIEWER"], { message: "新建账号只能是成员或只读;管理员可在创建后再授予" })
    .optional(),
});

/** 管理员对账号的局部更新:停用、改角色、重置密码。 */
export const userPatchSchema = z.object({
  active: z.boolean().optional(),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).optional(),
  password: z.string().min(8).max(200).optional(),
});

/** 搜索历史写入:只要一个非空查询词。 */
export const searchHistorySchema = z.object({
  query: z.string().trim().min(1, "搜索词不能为空").max(120),
});
export const shoppingSchema = z.object({
  name: z.string().trim().min(1, "请输入采购项").max(80),
  quantity: z.coerce.number().positive().max(999999).default(1),
  unit: z.string().trim().min(1).max(12).default("件"),
  category: z.union([z.string().max(40), z.null()]).optional().transform((value) => value || null),
  priority: z.coerce.number().int().min(0).max(2).default(1),
  source: z.string().max(30).default("manual"),
});

export const locationSchema = z.object({
  name: z.string().trim().min(1).max(30),
  icon: z.string().max(30).default("Package"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#7c3aed"),
  thumbnailUrl: z.union([z.string().url().max(1000), z.literal(""), z.null()]).optional().transform((value) => value || null),
  parentId: z.union([z.string().trim().min(1).max(80), z.literal(""), z.null()]).optional().transform((value) => value || null),
});

export const householdPreferenceSchema = z.object({
  expiryReminderDays: z.coerce.number().int().min(1).max(90).default(7),
  lowStockReminder: z.boolean().default(true),
  weeklyReviewEnabled: z.boolean().default(true),
  weeklyReviewDay: z.coerce.number().int().min(0).max(6).default(0),
});

export const ossSettingSchema = z.object({
  storageMode: z.enum(["local", "oss", "both"]).default("oss"),
  localDirectory: z.string().trim().min(1, "请输入本地图片目录").max(300),
  region: z.string().trim().max(80).default(""),
  endpoint: z.union([z.string().trim().max(200), z.literal(""), z.null()]).optional().transform((value) => value || null),
  bucket: z.string().trim().max(100).default(""),
  directory: z.string().trim().min(1, "请输入 OSS 存储目录").max(120).regex(/^[a-zA-Z0-9/_-]+$/, "目录只能包含字母、数字、斜杠、下划线和短横线").refine((value) => value.replace(/^\/+|\/+$/g, "").length > 0, "请输入 OSS 存储目录").refine((value) => !value.split("/").includes(".."), "目录不能包含 ..").transform((value) => value.replace(/^\/+|\/+$/g, "")),
  accessKeyId: z.string().trim().max(200).default(""),
  accessKeySecret: z.string().max(300).optional(),
  publicBaseUrl: z.union([z.string().url().max(500), z.literal(""), z.null()]).optional().transform((value) => value ? value.replace(/\/$/, "") : null),
}).superRefine((value, context) => {
  if (value.storageMode === "oss" || value.storageMode === "both") {
    if (!value.region) context.addIssue({ code: "custom", path: ["region"], message: "请输入 OSS Region" });
    if (!value.bucket) context.addIssue({ code: "custom", path: ["bucket"], message: "请输入 Bucket" });
    if (!value.accessKeyId) context.addIssue({ code: "custom", path: ["accessKeyId"], message: "请输入 AccessKey ID" });
  }
});

export const aiSettingSchema = z.object({
  baseUrl: z.string().trim().url("请输入有效的接口地址").max(500).transform((value) => value.replace(/\/$/, "")),
  apiKey: z.string().trim().max(500).optional(),
  model: z.string().trim().min(1, "请输入模型名称").max(120),
});

export const aiModelsSchema = aiSettingSchema.pick({ baseUrl: true, apiKey: true });

export const aiAnalyzeSchema = z.object({
  action: z.enum(["identify", "shelf_life", "full"]).default("full"),
  item: z.object({
    id: z.string().optional(),
    name: z.string().max(100).optional(),
    category: z.string().max(50).optional(),
    type: z.enum(["DURABLE", "CONSUMABLE"]).optional(),
    quantity: z.number().optional(),
    minQuantity: z.number().optional(),
    unit: z.string().max(20).optional(),
    purchaseDate: z.string().nullable().optional(),
    expiryDate: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  }).optional(),
  imageUrl: imageUrlSchema.nullable().optional(),
  hint: z.string().max(500).optional(),
});

export const priceRecordSchema = z.object({
  itemId: z.union([z.string(), z.literal(""), z.null()]).optional().transform((value) => value || null),
  itemName: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(40),
  unitPrice: z.coerce.number().min(0).max(99999999),
  quantity: z.coerce.number().positive().max(999999).default(1),
  purchasedAt: optionalDate,
  store: z.union([z.string().trim().max(80), z.literal(""), z.null()]).optional().transform((value) => value || null),
  notes: z.union([z.string().max(300), z.null()]).optional().transform((value) => value || null),
});

// 「忘记密码」用恢复码自助重置。用户名统一小写,恢复码允许带分隔符与大小写差异。
export const recoveryResetSchema = z.object({
  username: z.string({ required_error: "请输入用户名" }).trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/, "请输入有效的用户名"),
  code: z.string({ required_error: "请输入恢复码" }).trim().min(8, "请输入完整的恢复码"),
  password: z.string({ required_error: "请输入新密码" }).min(8, "新密码至少 8 位").max(72, "新密码最多 72 位"),
});

// 在设置里生成/重置自己的恢复码时,需要先用当前密码确认身份。
export const recoveryMintSchema = z.object({
  password: z.string({ required_error: "请输入当前密码" }).min(1, "请输入当前密码"),
});
