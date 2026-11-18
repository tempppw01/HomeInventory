// 支出预测 —— 把「消耗速度 × 单价」变成家里人能用的两个数字:
//   1. 按现在的用量,一个月大概花多少钱;
//   2. 最近该买的是哪几件、大概什么时候买。
// 全部是已有数据的推算(consumeRate / price / quantity),不需要 AI,也不新增字段。
// 本模块零依赖:需要的「还能用几天」由调用方注入(src/lib/item-forecast 的 daysLeftFor),
// 这样 node 能直接加载它跑单测,不必处理路径别名或扩展名。
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

export type SpendInput = ForecastInput & { price: number | null; minQuantity?: number };

export type SpendForecast = {
  /** 每月预计支出(只统计「有消耗速度 + 有单价」的物品) */
  monthlyTotal: number;
  /** 参与计算的物品数 */
  countedItems: number;
  /** 有消耗速度但没填单价的物品数 —— 用来提示「补上单价能算得更准」 */
  missingPrice: number;
  /** 最近该买的,按时间升序 */
  nextPurchases: Array<{ id: string; name: string; unit: string; daysLeft: number; estimatedCost: number }>;
};

/** 一件物品的月均支出:日均消耗 × 30 × 单价。液体按余量折算(与补货预测同一套口径)。 */
export function monthlySpendFor(item: SpendInput): number | null {
  if (item.type !== "CONSUMABLE") return null;
  const price = item.price ?? 0;
  if (price <= 0) return null;
  const rate = item.consumeRate ?? 0;
  if (rate < 0.1) return null;
  return rate * 30 * price;
}

export function spendForecast(items: readonly SpendInput[], resolveDaysLeft: (item: SpendInput) => number | null): SpendForecast {
  let monthlyTotal = 0;
  let countedItems = 0;
  let missingPrice = 0;
  const nextPurchases: SpendForecast["nextPurchases"] = [];

  for (const item of items) {
    const price = item.price ?? 0;
    const monthly = monthlySpendFor(item);
    if (monthly !== null) {
      monthlyTotal += monthly;
      countedItems += 1;
    } else if (item.type === "CONSUMABLE" && (item.consumeRate ?? 0) >= 0.1 && price <= 0) {
      // 有消耗节奏但没填单价:算不出钱,但值得提醒用户补一下
      missingPrice += 1;
    }

    // 暂停补货的物品:仍然计入月支出(东西还在用),但不提醒「最近该买」。
    const paused = item.restockPausedUntil ? new Date(item.restockPausedUntil).getTime() > Date.now() : false;
    if (paused) continue;

    const daysLeft = resolveDaysLeft(item);
    if (daysLeft === null) continue;
    const rate = item.consumeRate ?? 0;
    // 一次买的量取「最低库存」或按 30 天用量估算,给一个粗略花费
    const bulk = item.minQuantity && item.minQuantity > 0 ? item.minQuantity : Math.max(1, Math.round(rate * 30));
    nextPurchases.push({ id: item.id, name: item.name, unit: item.unit, daysLeft, estimatedCost: price > 0 ? Number((bulk * price).toFixed(2)) : 0 });
  }

  nextPurchases.sort((left, right) => left.daysLeft - right.daysLeft);
  return {
    monthlyTotal: Number(monthlyTotal.toFixed(2)),
    countedItems,
    missingPrice,
    nextPurchases: nextPurchases.slice(0, 5),
  };
}

/** 一句话摘要:没有可算的数据时返回 null,界面据此整块隐藏。 */
export function spendSummary(forecast: SpendForecast) {
  if (!forecast.countedItems && !forecast.nextPurchases.length) return null;
  const parts: string[] = [];
  if (forecast.countedItems) parts.push(`按现在用量,每月约 ¥${Math.round(forecast.monthlyTotal)}`);
  if (forecast.nextPurchases[0]) {
    const next = forecast.nextPurchases[0];
    parts.push(`最近要买的是「${next.name}」,大约 ${Math.max(0, next.daysLeft)} 天后`);
  }
  if (forecast.missingPrice) parts.push(`${forecast.missingPrice} 件没填单价,补上能算得更准`);
  return parts.join(";");
}