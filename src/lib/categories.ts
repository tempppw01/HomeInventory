/** 可复用的物品分类词表。药品使用“医药·治疗方向”格式，既便于一眼识别，也保留了可扩展性。 */
export const MEDICINE_CATEGORIES = [
  "医药·感冒发热",
  "医药·消化系统",
  "医药·呼吸过敏",
  "医药·疼痛炎症",
  "医药·皮肤外用",
  "医药·眼耳鼻喉",
  "医药·心脑血管",
  "医药·妇儿健康",
  "医药·慢病管理",
  "医药·医疗用品",
  "医药·其他",
] as const;

export type MedicineCategory = (typeof MEDICINE_CATEGORIES)[number];

/** 兼容历史数据中的“医药”，同时识别新的治疗方向分类。 */
export function isMedicineCategory(category: string | null | undefined) {
  return category === "医药" || Boolean(category?.startsWith("医药·"));
}

export function medicineCategoryLabel(category: string | null | undefined) {
  if (!isMedicineCategory(category)) return category || "";
  return category === "医药" ? "医药" : category!.replace(/^医药·/, "");
}

/** 根据常见药品名称给出保守的治疗方向建议；仅用于分类提示，不代表医学诊断。 */
export function suggestMedicineCategory(name: string | null | undefined): MedicineCategory {
  const value = (name || "").toLowerCase();
  if (/退烧|发热|感冒|流感|鼻炎|咳嗽|止咳/.test(value)) return "医药·感冒发热";
  if (/胃|肠|消化|腹泻|便秘|益生菌|蒙脱石/.test(value)) return "医药·消化系统";
  if (/过敏|氯雷他定|西替利嗪|鼻炎|哮喘|喷雾/.test(value)) return "医药·呼吸过敏";
  if (/止痛|镇痛|布洛芬|对乙酰氨基酚|炎症|跌打/.test(value)) return "医药·疼痛炎症";
  if (/皮炎|软膏|乳膏|创可贴|碘伏|湿疹|烧伤/.test(value)) return "医药·皮肤外用";
  if (/眼|滴眼|耳|鼻|咽|喉/.test(value)) return "医药·眼耳鼻喉";
  if (/降压|心脏|血糖|胰岛素|血脂|阿司匹林|脑/.test(value)) return "医药·心脑血管";
  if (/妇科|孕|儿童|小儿|婴儿|维生素/.test(value)) return "医药·妇儿健康";
  if (/血压计|血糖仪|体温计|口罩|试纸|医用/.test(value)) return "医药·医疗用品";
  return "医药·其他";
}
