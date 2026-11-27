// 空间整理摘要 —— 每个房间/柜子是「什么状态」,一眼能看出来。
import { isLowStock } from "@/lib/low-stock";
// 纯函数,零依赖,便于单测。

export type SpaceItemInput = {
  locationId: string | null;
  type: "DURABLE" | "CONSUMABLE";
  quantity: number;
  price: number | null;
  expiryDate: string | null;
  storage: string | null;
  minQuantity: number;
  // 「该补货」的判定需要这些字段(液体见底也算)
  name: string;
  category: string;
  unit: string;
  remainingPercent: number;
  restockPausedUntil?: Date | string | null;
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
    // 传 now:空间卡上的「N 件该补货」和概览的「低库存」必须是同一个答案,
    // 暂停补货中的物品两边都不算(此前这里没传,暂停了照样计入)。
    if (isLowStock(item, now)) lowStock += 1;
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
/**
 * 删空间之前要跟用户说的话。
 *
 * 起因:接口对「空间里还有物品」返回 409「该位置还有 N 件物品,请先移动后再删除」,
 * 而界面弹的是「确定删除空间“X”?」—— 用户点了确定才发现删不掉,白点一次;
 * 界面明明手里就有件数(卡片上本来就显示「N 件」)。
 *
 * 另外一条从来没被说出来的后果:删掉父空间时,它的下级空间会被置为顶级
 * (schema 里 Location.parent 是 onDelete: SetNull)。不丢东西,但也不是「什么都没发生」。
 *
 * 纯函数,便于单测:返回 null 表示「根本不能删」,否则给出确认框要用的三段文案。
 */
export function spaceDeletePrompt(locationName: string, itemCount: number, childCount: number): {
  blocked: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
} | null {
  if (itemCount > 0) {
    return {
      blocked: true,
      title: "这个空间里还有物品",
      message: `“${locationName}”里还有 ${itemCount} 件物品,不能直接删除。先把这些物品移到别的空间(打开物品改「存放位置」),或者先处理掉它们。`,
      confirmLabel: "知道了",
      cancelLabel: "关闭",
    };
  }
  const consequence = childCount > 0
    ? `它的 ${childCount} 个下级空间会变成顶级空间(不会删掉),物品不受影响。`
    : "空间里的物品不受影响(现在是空的)。";
  return {
    blocked: false,
    title: "删除空间",
    message: `确定删除空间“${locationName}”?${consequence}`,
    confirmLabel: "确认删除",
    cancelLabel: "取消",
  };
}
