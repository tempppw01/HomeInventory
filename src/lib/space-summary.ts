// 空间整理摘要 —— 每个房间/柜子是「什么状态」,一眼能看出来。
// 纯函数,零依赖,便于单测。

export type SpaceItemInput = {
  locationId: string | null;
  type: "DURABLE" | "CONSUMABLE";
  quantity: number;
  price: number | null;
  expiryDate: string | null;
  storage: string | null;
  minQuantity: number;
};

export type SpaceSummary = {
  count: number;
  consumables: number;
  /** 需要冷藏(含开封后冷藏)的件数 */
  cold: number;
  /** 已过期或 7 天内到期的件数 */
  expiring: number;
  /** 估算价值(数量 × 单价) */
  value: number;
  /** 低于最低库存的消耗品件数 */
  lowStock: number;
};

export function spaceSummary(items: readonly SpaceItemInput[], locationId: string, now = Date.now()): SpaceSummary {
  const scoped = items.filter((item) => item.locationId === locationId);
  const soon = now + 7 * 86400000;
  let cold = 0;
  let expiring = 0;
  let value = 0;
  let lowStock = 0;

  for (const item of scoped) {
    if (item.storage === "COLD" || item.storage === "COLD_AFTER_OPEN") cold += 1;
    if (item.expiryDate) {
      const time = new Date(item.expiryDate).getTime();
      if (Number.isFinite(time) && time <= soon) expiring += 1;
    }
    value += (item.price ?? 0) * item.quantity;
    if (item.type === "CONSUMABLE" && item.minQuantity > 0 && item.quantity <= item.minQuantity) lowStock += 1;
  }

  return {
    count: scoped.length,
    consumables: scoped.filter((item) => item.type === "CONSUMABLE").length,
    cold,
    expiring,
    value: Number(value.toFixed(2)),
    lowStock,
  };
}

/**
 * 卡片上那一行摘要。只列出「有内容」的项,空空间给一句明确的提示,
 * 而不是让用户对着一堆 0 猜。
 */
export function spaceSummaryText(summary: SpaceSummary) {
  if (summary.count === 0) return "还没放东西";
  const parts = [`${summary.count} 件`];
  if (summary.cold) parts.push(`${summary.cold} 件需冷藏`);
  if (summary.expiring) parts.push(`${summary.expiring} 件临期`);
  if (summary.lowStock) parts.push(`${summary.lowStock} 件该补货`);
  if (summary.value > 0) parts.push(`约 ¥${Math.round(summary.value)}`);
  return parts.join(" · ");
}

/** 需要提醒的状态(用于卡片上的小圆点/角标);没有则返回 null。 */
export function spaceAlert(summary: SpaceSummary): "danger" | "warning" | null {
  if (summary.expiring) return "danger";
  if (summary.lowStock) return "warning";
  return null;
}