// 物品洞察规则引擎 —— 在后台自动运行,不需要用户点任何按钮。
//
// 为什么先是规则而不是模型调用:
// · 家庭内网的服务器常常没配 AI Key,后台任务不能因此失效;
// · 判定要可解释、可复现、可写单测("为什么建议冷藏"必须说得出来);
// · 单件物品的判定是毫秒级,放进写入事务里也不会拖慢保存。
// 配置了真 AI 时,由 `aiStorageAdvice` 那条既有链路补充文字说明,两者互不覆盖。
// 药品分类的命名约定是「医药·治疗方向」(见 src/lib/categories.ts 的 MEDICINE_CATEGORIES)。
// 这里只按前缀判定,保持本模块零依赖 —— 它是纯规则引擎,node 能直接加载跑单测。
function isMedicineCategory(category: string) {
  return category === "医药" || category.startsWith("医药·");
}

export type StorageAdvice = "COLD" | "COLD_AFTER_OPEN" | "ROOM";

export type ItemInsight = {
  storage: StorageAdvice;
  storageReason: string;
  /** 建议单位(仅在用户没手动改过单位时采用) */
  suggestedUnit?: string;
  /** 建议保质期天数(用于「一键填有效期」) */
  suggestedShelfLifeDays?: number;
  /** 自动标签(逗号分隔写入 autoTags) */
  tags: string[];
};

type InsightInput = {
  name: string;
  category: string;
  unit: string;
  type: "DURABLE" | "CONSUMABLE";
};

// 必须冷藏:未开封也放冰箱。
const MUST_COLD = [
  ["鲜奶", "巴氏鲜奶开封后几天就会变质,必须冷藏"],
  ["牛奶", "常温奶开封后需冷藏;鲜奶全程冷藏"],
  ["酸奶", "活性菌在常温下会继续发酵,必须冷藏"],
  ["奶酪", "乳制品,常温易霉变"],
  ["黄油", "乳脂在常温下会氧化变味"],
  ["豆腐", "豆制品水分高,常温几小时就会酸"],
  ["豆浆", "同豆腐"],
  ["熟食", "已烹调的食物常温易滋生细菌"],
  ["卤味", "同熟食"],
  ["三文鱼", "生鲜水产需冷藏"],
  ["虾", "生鲜水产需冷藏"],
  ["鸡胸", "生鲜肉类需冷藏"],
  ["牛排", "生鲜肉类需冷藏"],
  ["鸡蛋", "冷藏能显著延长保质期"],
  ["胰岛素", "胰岛素需 2-8℃ 冷藏,冷冻会失效"],
  ["疫苗", "需冷链保存"],
  ["沙拉", "生菜类常温很快萎蔫变质"],
  ["水果切", "切开的果蔬需冷藏"],
];

// 开封后冷藏(未开封常温即可)。
const COLD_AFTER_OPEN = [
  ["酱油", "开封后常温易长霉,建议冷藏"],
  ["蚝油", "开封后需冷藏"],
  ["番茄酱", "开封后需冷藏"],
  ["沙拉酱", "开封后需冷藏"],
  ["果酱", "开封后需冷藏"],
  ["花生酱", "开封后冷藏可防油脂氧化"],
  ["辣椒酱", "开封后建议冷藏"],
  ["果汁", "开封后需冷藏并尽快喝完"],
  ["啤酒", "冰镇更好喝,开封后尽快喝完"],
  ["椰奶", "开封后需冷藏"],
];

// 常温即可(明确给出理由,避免用户以为「没提示=不知道」)。
const ROOM_OK = [
  ["可乐", "碳酸饮料常温即可,冰镇更好喝"],
  ["雪碧", "碳酸饮料常温即可"],
  ["汽水", "碳酸饮料常温即可"],
  ["苏打水", "常温即可"],
  ["矿泉水", "常温避光即可"],
  ["纯净水", "常温避光即可"],
  ["咖啡", "未开封常温即可"],
  ["茶叶", "常温避光防潮"],
  ["白酒", "常温避光即可"],
  ["红酒", "阴凉避光即可"],
  ["方便面", "常温干燥即可"],
  ["饼干", "常温防潮即可"],
];

function match(name: string, table: ReadonlyArray<readonly string[]>) {
  const hit = table.find(([keyword]) => name.includes(keyword));
  return hit ?? null;
}

/** 按品类/关键词推断「该不该放冰箱」,并给出人能看懂的依据。 */
export function storageAdviceFor(input: InsightInput): { storage: StorageAdvice; storageReason: string } {
  const name = (input.name ?? "").trim();
  const category = (input.category ?? "").trim();
  const isDrink = category === "饮品" || /水|奶|汁|酒|可乐|汽水|咖啡|茶/.test(name);

  const cold = match(name, MUST_COLD);
  if (cold) return { storage: "COLD", storageReason: cold[1] };

  // 药品里只有明确需要冷链的才建议冷藏(由上面的关键词命中)。
  if (isMedicineCategory(category)) {
    return { storage: "ROOM", storageReason: "常规药品常温避光即可;说明书要求冷藏的除外" };
  }

  const afterOpen = match(name, COLD_AFTER_OPEN);
  if (afterOpen) return { storage: "COLD_AFTER_OPEN", storageReason: afterOpen[1] };

  const roomOk = match(name, ROOM_OK);
  if (roomOk) return { storage: "ROOM", storageReason: roomOk[1] };

  // 兜底:饮料默认「常温即可、冰镇更好喝」,不要瞎建议冷藏。
  if (isDrink) return { storage: "ROOM", storageReason: "饮料未开封可常温存放,冰镇风味更好" };

  return {
    storage: "ROOM",
    storageReason: input.type === "CONSUMABLE" ? "常温干燥避光保存即可" : "常规存放即可",
  };
}

/** 建议单位:饮料优先瓶/罐,乳制品多半是盒。 */
export function suggestedUnitFor(name: string, category: string): string | undefined {
  if (category !== "饮品" && !/水|奶|汁|酒|可乐|汽水/.test(name)) return undefined;
  if (/罐/.test(name)) return "罐";
  if (/盒|纸盒|杯/.test(name)) return "盒";
  if (/桶|大瓶|瓶装/.test(name)) return "瓶";
  if (/\d+\s*L|升/.test(name)) return "L";
  // 乳制品绝大多数是盒装(酸奶/牛奶/豆奶),比「瓶」更贴近真实货架。
  if (/酸奶|牛奶|豆奶|奶/.test(name)) return "盒";
  return "瓶";
}

/** 常见饮食的建议保质期(天)。用于「一键填有效期」,只是建议,可改。 */
const SHELF_LIFE: readonly (readonly [string, number])[] = [
  ["鲜奶", 7],
  ["巴氏", 7],
  ["牛奶", 30],
  ["酸奶", 21],
  ["豆腐", 3],
  ["豆浆", 3],
  ["熟食", 3],
  ["卤味", 3],
  ["鸡蛋", 40],
  ["果汁", 10],
  ["啤酒", 180],
  ["可乐", 270],
  ["汽水", 270],
  ["咖啡", 365],
  ["茶叶", 730],
  ["白酒", 3650],
];

export function suggestedShelfLifeDays(name: string): number | undefined {
  const hit = SHELF_LIFE.find(([keyword]) => name.includes(keyword));
  return hit ? hit[1] : undefined;
}

/** 自动标签:写进 autoTags,让搜索也能命中(例如搜「冷藏」能找出所有需冷藏的物品)。 */
export function autoTagsFor(input: InsightInput): string[] {
  const name = (input.name ?? "").trim();
  const category = (input.category ?? "").trim();
  const tags = new Set<string>();

  if (category === "饮品" || /水|奶|汁|酒|可乐|汽水|咖啡|茶/.test(name)) tags.add("饮料");
  if (/可乐|雪碧|汽水|苏打/.test(name)) tags.add("碳酸");
  if (/奶|酸奶|奶酪|黄油/.test(name)) tags.add("乳制品");
  if (/啤酒|白酒|红酒|黄酒|洋酒/.test(name)) tags.add("酒精");
  if (/鲜|生|熟食|卤味|沙拉/.test(name)) tags.add("易变质");
  if (isMedicineCategory(category)) tags.add("药品");
  if (input.type === "DURABLE") tags.add("耐用品");
  if (input.type === "CONSUMABLE") tags.add("消耗品");

  const { storage } = storageAdviceFor(input);
  if (storage === "COLD") tags.add("需冷藏");
  if (storage === "COLD_AFTER_OPEN") tags.add("开封后冷藏");

  return [...tags];
}

/** 一次算出全部后台洞察(写入时调用,或按需在界面上做即时预览)。 */
export function itemInsight(input: InsightInput): ItemInsight {
  const { storage, storageReason } = storageAdviceFor(input);
  return {
    storage,
    storageReason,
    suggestedUnit: suggestedUnitFor(input.name, input.category),
    suggestedShelfLifeDays: suggestedShelfLifeDays(input.name),
    tags: autoTagsFor(input),
  };
}

export const STORAGE_LABEL: Record<StorageAdvice, string> = {
  COLD: "需冷藏",
  COLD_AFTER_OPEN: "开封后冷藏",
  ROOM: "常温即可",
};