import { isRestockPaused } from "@/lib/low-stock";
type ItemMetricsInput = {
  type: "DURABLE" | "CONSUMABLE";
  name: string;
  category: string;
  unit: string;
  price: number | null;
  purchaseDate: string | Date | null;
};

const dayMs = 86400000;

export function usageDays(purchaseDate: string | Date | null, now = new Date()) {
  if (!purchaseDate) return null;
  const start = new Date(purchaseDate);
  if (Number.isNaN(start.getTime()) || start.getTime() > now.getTime()) return null;
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const currentDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.floor((currentDay - startDay) / dayMs) + 1);
}

export function dailyUsageCost(item: Pick<ItemMetricsInput, "type" | "price" | "purchaseDate">, now = new Date()) {
  if (item.type !== "DURABLE" || item.price == null) return null;
  const days = usageDays(item.purchaseDate, now);
  return days ? { days, cost: item.price / days } : null;
}

export function isLiquidConsumable(item: Pick<ItemMetricsInput, "type" | "name" | "category" | "unit">) {
  if (item.type !== "CONSUMABLE") return false;
  if (["饮品", "清洁"].includes(item.category) || ["瓶", "L", "ml"].includes(item.unit)) return true;
  return /水|奶|饮料|酒|油|液|露|乳|汁|酱|洗发|沐浴/.test(item.name);
}

/** 消耗品按近期消耗速度还能用几天;液体按整瓶记录,不参与估算。 */
export function estimatedUseDays(item: Pick<ItemMetricsInput, "type" | "name" | "category" | "unit"> & { quantity: number; consumeRate: number | null }) {
  if (item.type !== "CONSUMABLE" || isLiquidConsumable(item) || !item.consumeRate || item.consumeRate < 0.1 || item.quantity <= 0) return null;
  return Math.max(1, Math.ceil(item.quantity / item.consumeRate));
}

/**
 * Physical count units must not be stored as fractions. Liquids sold by the
 * bottle are still counted as whole bottles; their in-use amount belongs in
 * remainingPercent instead of quantity.
 */
export function isCountUnit(unit: string) {
  return ["件", "个", "盒", "瓶", "罐", "袋", "卷", "包", "台"].includes(unit);
}

export function normalizeItemQuantity(quantity: number, unit: string) {
  return isCountUnit(unit) ? Math.max(0, Math.round(quantity)) : quantity;
}

/**
 * 是否应该出现在**采购建议**里(服务端在创建 / 更新 / 消耗物品后据此自动生成)。
 *
 * 它与客户端展示用的 isLowStock 有意不同:这里**用完(数量 0)也要建议补货** ——
 * 东西用完了正是该买的时候;而客户端那个「该补货」角标不重复提示已经用完的。
 *
 * 但「暂停补货提醒」两边都必须生效:此前服务端完全没判断这个字段,
 * 于是用户在客户端暂停了提醒,后台却还在悄悄生成采购项。
 */
export function needsRestock(
  item: Pick<ItemMetricsInput, "type" | "name" | "category" | "unit"> & {
    quantity: number;
    minQuantity: number;
    remainingPercent: number;
    restockPausedUntil?: Date | string | null;
  },
  now: number = Date.now(),
) {
  if (item.type !== "CONSUMABLE") return false;
  if (isRestockPaused(item, now)) return false;
  return (item.minQuantity > 0 && item.quantity <= item.minQuantity)
    || (isLiquidConsumable(item) && item.remainingPercent <= 20);
}

export function restockQuantity(item: { quantity: number; minQuantity: number }) {
  return Math.max(item.minQuantity - item.quantity, 1);
}
