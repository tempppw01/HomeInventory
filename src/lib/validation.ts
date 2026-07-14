import { z } from "zod";

const optionalDate = z
  .union([z.string().date(), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value ? new Date(value) : null));

export const itemSchema = z.object({
  name: z.string().trim().min(1, "请输入物品名称").max(80),
  category: z.string().trim().min(1, "请选择或输入分类").max(40),
  type: z.enum(["DURABLE", "CONSUMABLE"]),
  quantity: z.coerce.number().min(0).max(999999),
  minQuantity: z.coerce.number().min(0).max(999999).default(0),
  unit: z.string().trim().min(1).max(12),
  price: z.union([z.coerce.number().min(0), z.literal(""), z.null()]).optional().transform((value) => value === "" || value == null ? null : value),
  purchaseDate: optionalDate,
  expiryDate: optionalDate,
  imageUrl: z.union([z.string().url().max(1000), z.literal(""), z.null()]).optional().transform((value) => value || null),
  locationId: z.union([z.string(), z.literal(""), z.null()]).optional().transform((value) => value || null),
  notes: z.union([z.string().max(500), z.null()]).optional().transform((value) => value || null),
  recordPurchase: z.boolean().optional().default(false),
  purchaseStore: z.union([z.string().trim().max(80), z.literal(""), z.null()]).optional().transform((value) => value || null),
});

export const itemPatchSchema = itemSchema.partial();

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
});

export const ossSettingSchema = z.object({
  region: z.string().trim().min(1, "请输入 OSS Region").max(80),
  endpoint: z.union([z.string().trim().max(200), z.literal(""), z.null()]).optional().transform((value) => value || null),
  bucket: z.string().trim().min(1, "请输入 Bucket").max(100),
  accessKeyId: z.string().trim().min(1, "请输入 AccessKey ID").max(200),
  accessKeySecret: z.string().max(300).optional(),
  publicBaseUrl: z.union([z.string().url().max(500), z.literal(""), z.null()]).optional().transform((value) => value ? value.replace(/\/$/, "") : null),
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
  imageUrl: z.string().url().nullable().optional(),
  hint: z.string().max(500).optional(),
});

export const fridgeReadingSchema = z.object({
  temperature: z.coerce.number().min(-10).max(30),
  note: z.union([z.string().trim().max(200), z.literal(""), z.null()]).optional().transform((value) => value || null),
});

export const fridgeSettingSchema = z.object({
  enabled: z.boolean(),
  targetMin: z.coerce.number().min(-5).max(15),
  targetMax: z.coerce.number().min(-5).max(20),
}).refine((value) => value.targetMax > value.targetMin, { message: "最高温度必须大于最低温度" });

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
