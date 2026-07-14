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
