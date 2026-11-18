// 后台预测规则 —— 和存放建议一样,不需要用户点任何按钮,也不需要 AI Key。
//
// 两件事:
// 1. 补货预测:按「近期消耗速度」估算还能用几天,把「7 天内会用完」的物品挑出来;
// 2. 重复物品建议:把名字高度相似的物品归组,提示可以合并(避免同一件东西录了两遍)。
// 与 src/lib/item-metrics.ts 的 isLiquidConsumable 保持同一套规则;这里内联一份,
// 是为了让本模块零依赖 —— node 可以直接加载它跑单测(不需要别名/扩展名解析)。
function isLiquidConsumable(item: { type: string; name: string; category: string; unit: string }) {
  if (item.type !== "CONSUMABLE") return false;
  if (["饮品", "清洁"].includes(item.category) || ["瓶", "L", "ml"].includes(item.unit)) return true;
  return /水|奶|饮料|酒|油|液|露|乳|汁|酱|洗发|沐浴/.test(item.name);
}

export type ForecastInput = {
  id: string;
  name: string;
  category: string;
  type: "DURABLE" | "CONSUMABLE";
  unit: string;
  quantity: number;
  remainingPercent: number;
  consumeRate: number | null;
  expiryDate?: string | null;
  restockPausedUntil?: string | null;
};

/**
 * 从消耗事件学习「日均消耗」,供补货预测使用。
 * 事件形如 { at: 时间戳, units: 该次用掉的等效数量 }(液体按余量百分比折算)。
 * 至少 2 次才算「有规律」;用总量除以「距今实际跨度天数」,跨度至少按 1 天算。
 */
export function learnConsumeRate(events: ReadonlyArray<{ at: number; units: number }>, now = Date.now(), windowDays = 30) {
  if (events.length < 2) return null;
  const windowStart = now - windowDays * 86400000;
  const recent = events.filter((event) => event.at >= windowStart && event.units > 0);
  if (recent.length < 2) return null;
  const total = recent.reduce((sum, event) => sum + event.units, 0);
  const oldest = Math.min(...recent.map((event) => event.at));
  const spanDays = Math.max(1, Math.ceil((now - oldest) / 86400000));
  const rate = total / spanDays;
  return rate > 0 ? rate : null;
}
export type RestockForecast = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  /** 按当前速度还能用几天;无法估算时为 null */
  daysLeft: number;
  /** 为什么给出这个结论 */
  reason: string;
};

/**
 * 还能用几天。
 * 液体按「剩余量百分比」换算(用量体现在 remainingPercent,数量本身不变),
 * 计数单位直接按 数量 / 日均消耗。
 */
export function daysLeftFor(item: ForecastInput): number | null {
  if (item.type !== "CONSUMABLE") return null;
  if (item.quantity <= 0) return 0;
  const rate = item.consumeRate ?? 0;
  if (rate < 0.1) return null;

  if (isLiquidConsumable(item)) {
    const effective = item.quantity * (Math.max(0, Math.min(100, item.remainingPercent)) / 100);
    if (effective <= 0) return 0;
    return Math.max(1, Math.ceil(effective / rate));
  }
  return Math.max(1, Math.ceil(item.quantity / rate));
}

/** 挑出「快用完」的消耗品,按紧迫度排序。默认 7 天。 */
export function restockForecast(items: readonly ForecastInput[], withinDays = 7, now = Date.now()): RestockForecast[] {
  const rows: RestockForecast[] = [];
  for (const item of items) {
    if (item.restockPausedUntil && new Date(item.restockPausedUntil).getTime() > now) continue;
    const daysLeft = daysLeftFor(item);
    if (daysLeft === null || daysLeft > withinDays) continue;
    rows.push({
      id: item.id,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      daysLeft,
      reason: daysLeft === 0
        ? "已经用完了"
        : `按近期的用量,大约还能用 ${daysLeft} 天`,
    });
  }
  return rows.sort((left, right) => left.daysLeft - right.daysLeft);
}

/** 名称归一化:去掉括号注释、规格、空白与常见标点,便于比较「同一个东西」。 */
export function normalizeItemName(name: string) {
  return name
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\d+(\.\d+)?\s*(ml|l|g|kg|片|粒|卷|包|盒|瓶|罐|袋|个|件)/g, "")
    .replace(/[\s\-_/·,、,。.]+/g, "")
    .trim();
}

export type DuplicateGroup = {
  /** 归一化后的名字,作为分组的键 */
  key: string;
  items: Array<{ id: string; name: string; quantity: number; unit: string }>;
  /** 建议合并到的目标(数量最大的那条) */
  keepId: string;
};

/**
 * 找出可能重复的物品:归一化后同名,或一方包含另一方(如「洗洁精」与「洗洁精柠檬」)。
 * 只做提示,不自动合并 —— 合并是不可逆操作,必须由人确认。
 */
export function duplicateGroups(items: readonly ForecastInput[]): DuplicateGroup[] {
  const buckets = new Map<string, ForecastInput[]>();
  for (const item of items) {
    const key = normalizeItemName(item.name);
    if (!key) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.length > 1) {
      const sorted = [...bucket].sort((left, right) => right.quantity - left.quantity);
      groups.push({
        key,
        items: sorted.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, unit: item.unit })),
        keepId: sorted[0].id,
      });
    }
  }
  return groups.sort((left, right) => right.items.length - left.items.length);
}

export const FORECAST_LABEL = {
  urgent: "快用完了",
  soon: "这几天会用完",
} as const;