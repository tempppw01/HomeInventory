import { z } from "zod";
import { PREFERENCE_LIMITS } from "@/lib/preference-limits";

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
//
// 消息必须是中文:这条经 CSV/JSON 导入会**原样显示给用户**(实测导入一行 imageUrl:"abc"
// 的 JSON,提示里出现的是 zod 的 Invalid url)。
const imageUrlSchema = z.union([
  z.string().url("图片地址要填完整链接,例如 https://… 或先上传一张图").max(1000, "图片地址最多 1000 个字"),
  z.string()
    .max(1000, "图片地址最多 1000 个字")
    .regex(/^\/api\/uploads\/[A-Za-z0-9/_-]+(?:\.[A-Za-z0-9_-]+)?$/, "本地上传的图片地址必须形如 /api/uploads/…")
    .refine((value) => !value.includes(".."), "图片地址里不能有 .."),
]);

/**
 * 可选文本字段:null / 空串 → null,长度越界与非字符串都给中文消息。
 *
 * 原先写的是 `z.union([z.string().max(N), z.null()]).optional()` —— 越界时 zod 吐的是
 * `String must contain at most N character(s)`,非字符串时吐的是 `Invalid input`,
 * 而这两句都会经导入**原样出现在用户面前的提示里**(实测:CSV 里一个 600 字的备注 →
 * 「跳过 1 处(第 2 行:String must contain at most 500 character(s))」)。
 */
const optionalText = (max: number, label: string) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? null : value),
    z.string({ invalid_type_error: `${label}要填文字` }).max(max, `${label}最多 ${max} 个字`).nullable(),
  ).transform((value) => value || null);

/**
 * 名字是不是「只有空白或不可见字符」。
 *
 * `z.string().trim().min(1)` 拦不住这个:`\u200b`(零宽空格)、`\u200c/\u200d`(连接符)、
 * `\ufeff`(BOM)都不是空白字符,`trim()` 也不会去掉它们。于是「名称全是零宽字符」的物品
 * 能真的存进库 —— 列表里那一条是一片空白,搜索按名字搜不到,只能靠一条条翻出来。
 * 实测:用纯零宽字符 POST /api/items 返回 201。
 */
export function isInvisibleName(value: string) {
  return /^[\s\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]*$/.test(value);
}

/** 名称类字段统一的「必须看得见」规则 */
const INVISIBLE_NAME_MESSAGE = "名称不能只有不可见字符,请填一个看得见的名字";

/**
 * 「没填」不是一个值 —— 把 null / undefined / 空串统一成「这个字段没出现」。
 *
 * `z.coerce.number()` 会把它们全算成 0(Number(null) === 0、Number("") === 0),于是「没填」
 * 和「0」在库里变成同一个东西。而这个 schema 里两个 0 都**有后果**:
 *   · 余量 0% → item-metrics 判「需补货」、item-forecast 按 0 算用量;
 *   · 数量 0 件 → 不出现在任何列表里(列表只取 quantity > 0)。
 * 实测(2026-11-28,对着真实接口打,对照「不传这个字段」):
 *   remainingPercent=null → 存 0(界面列表显示「需补货 0%」)、"" → 存 0;不传 → 100;
 *   quantity=null → 201 存 0、"" → 201 存 0(物品在界面上直接看不见)。
 *
 * 所以:显式的 0 一律保留(那是真的 0,消耗到最后一瓶也会产生它),
 * null / 空串按「没填」处理 —— 有默认值的走默认(余量 100),必填的给中文错误(数量),
 * 局部更新(PATCH / 批量)里则视为「不改这一项」。
 */
const missingWhenBlank = (value: unknown) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

export const itemSchema = z.object({
  name: z.string().trim().min(1, "请输入物品名称").max(80, "物品名称最多 80 个字").refine((value) => !isInvisibleName(value), INVISIBLE_NAME_MESSAGE),
  category: z.string().trim().min(1, "请选择或输入分类").max(40, "分类最多 40 个字"),
  type: z.enum(["DURABLE", "CONSUMABLE"]),
  // 数量是必填:没填(null / 空串)按「没填」处理,回一句中文,而不是静默存成 0 件
  // ——0 件的物品不出现在任何列表里,「保存成功却查无此物」会被当成数据丢失。
  // 显式的 0 仍然接受:消耗到最后一瓶时应用自己会把数量写成 0(见 /api/items/[id]/consume
  // 与补货入库那条 updateMany),那不是脏数据。
  quantity: z.preprocess(
    missingWhenBlank,
    z.coerce.number({ invalid_type_error: "数量要填一个数字(至少 1)" }).min(0, "数量不能是负数").max(999999, "数量最多 999999"),
  ),
  minQuantity: z.coerce.number().min(0).max(999999).default(0),
  // 余量与单价是同一个坑:没填就不该等同于 0%(0% 会进「需补货」,并按 0 算用量)。
  // 不传该字段时 default(100) 生效,所以「没填」也走 100 —— 两种「没填」给同一个答案。
  // 注意 PATCH(itemSchema.partial())里的差别:不传 = 不改;显式传 null = 回到默认 100。
  remainingPercent: z.preprocess(
    missingWhenBlank,
    z.coerce.number({ invalid_type_error: "剩余量要填 0 到 100 之间的数字" }).min(0, "剩余量不能小于 0").max(100, "剩余量最多 100").default(100),
  ),
  unit: z.string().trim().min(1).max(12, "单位最多 12 个字"),
  // 「没填单价」必须存成 null。
  //
  // 此前写的是 z.union([z.coerce.number().min(0), z.literal(""), z.null()]):union 取**第一个通过**的支,
  // 而 z.coerce.number() 排在前面 —— Number(null) === 0、Number("") === 0,于是 null 和 "" 都被它
  // 吞成 0,永远走不到后面的 z.literal("") / z.null(),末尾那句 transform 也就看不到它们。
  // 实测(2026-11-27,对着真实接口打):price=null → 存成 0;price="" → 存成 0;price="19.90" → 19.9;
  // price="abc" → 400;显式 price=0 → 0。
  //
  // 两层后果:①「没填」与「0 元」在库里、界面上、财务里变成同一个东西;
  // ②创建路径的 recordPurchase && price != null 从此恒真 —— 每录一件不填价格的物品,
  //   就会写一条 ¥0 采购记录,概览的「最近记录」里看得到(家用库那行字曾是「双击检查-… · ¥0.00」)。
  // 所以先归一化再校验:空 → null,其余交给 z.number()(非数字字符串仍然 400)。
  price: z
    .preprocess((value) => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      if (trimmed === "") return null;
      const amount = Number(trimmed.replace(",", "."));
      return Number.isFinite(amount) ? amount : value;
    }, z.number({ invalid_type_error: "单价要填一个数字,例如 19.90" }).min(0, "单价不能是负数").max(99999999, "单价超出范围").nullable().optional())
    .transform((value) => (value == null ? null : value)),
  purchaseDate: optionalDate,
  expiryDate: optionalDate,
  imageUrl: z.union([imageUrlSchema, z.literal(""), z.null()]).optional().transform((value) => value || null),
  locationId: z.union([z.string(), z.literal(""), z.null()]).optional().transform((value) => value || null),
  notes: optionalText(500, "备注"),
  aiSummary: optionalText(800, "AI 结论"),
  aiStorageAdvice: optionalText(800, "存放建议"),
  aiUsageAdvice: optionalText(800, "用法建议"),
  aiReplenishmentAdvice: optionalText(800, "补货建议"),
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
  /**
   * 批量改数量(盘点后「这些都用掉一半」这类场景)。
   * 没填(null / 空串)= 这一项不改,不再被 coerce 成 0 把选中的物品全改成 0 件(0 件在界面上看不见)。
   */
  quantity: z.preprocess(missingWhenBlank, z.coerce.number({ invalid_type_error: "数量要填一个数字" }).min(0, "数量不能是负数").max(999999, "数量最多 999999").optional()),
  /** 批量改剩余百分比(液体消耗品)。没填 = 这一项不改(此前会被 coerce 成 0%,等于把选中的全标成「需补货」)。 */
  remainingPercent: z.preprocess(missingWhenBlank, z.coerce.number({ invalid_type_error: "剩余量要填 0 到 100 之间的数字" }).min(0, "剩余量不能小于 0").max(100, "剩余量最多 100").optional()),
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
  name: z.string().trim().min(1, "请输入成员名称").max(30).refine((value) => !isInvisibleName(value), INVISIBLE_NAME_MESSAGE),
  color: z.string().trim().max(20).optional(),
});

/** 新建账号:用户名规则与前端提示保持一致。 */
/**
 * 用户自助修改密码:必须给当前密码(服务端会再验一次),新密码沿用建号时的长度下限。
 * 与「管理员重置别人密码」不同 —— 那条不需要当前密码,因为管理员本来就有权限。
 */
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "请填写当前密码").max(200),
  newPassword: z.string().min(8, "新密码至少 8 位").max(200),
});

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
  name: z.string().trim().min(1, "请输入采购项").max(80).refine((value) => !isInvisibleName(value), INVISIBLE_NAME_MESSAGE),
  quantity: z.coerce.number().positive().max(999999).default(1),
  unit: z.string().trim().min(1).max(12).default("件"),
  category: z.union([z.string().max(40), z.null()]).optional().transform((value) => value || null),
  priority: z.coerce.number().int().min(0).max(2).default(1),
  source: z.string().max(30).default("manual"),
});

export const locationSchema = z.object({
  name: z.string().trim().min(1, "请输入空间名称").max(30).refine((value) => !isInvisibleName(value), INVISIBLE_NAME_MESSAGE),
  icon: z.string().max(30).default("Package"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#7c3aed"),
  thumbnailUrl: z.union([z.string().url().max(1000), z.literal(""), z.null()]).optional().transform((value) => value || null),
  parentId: z.union([z.string().trim().min(1).max(80), z.literal(""), z.null()]).optional().transform((value) => value || null),
});

export const householdPreferenceSchema = z.object({
  // 范围来自 lib/preference-limits:恢复备份那条路也从同一份取,避免两处各说各话
  expiryReminderDays: z.coerce.number().int().min(PREFERENCE_LIMITS.expiryReminderDays.min).max(PREFERENCE_LIMITS.expiryReminderDays.max).default(PREFERENCE_LIMITS.expiryReminderDays.fallback),
  lowStockReminder: z.boolean().default(true),
  weeklyReviewEnabled: z.boolean().default(true),
  weeklyReviewDay: z.coerce.number().int().min(PREFERENCE_LIMITS.weeklyReviewDay.min).max(PREFERENCE_LIMITS.weeklyReviewDay.max).default(PREFERENCE_LIMITS.weeklyReviewDay.fallback),
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
