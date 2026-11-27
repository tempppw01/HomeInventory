// 空间整理摘要 —— 每个房间/柜子是「什么状态」,一眼能看出来。
import { isLowStock } from "@/lib/low-stock";
import { daysUntilLocalDay, isExpiringSoonDays } from "@/lib/expiry-status";
import { PREFERENCE_LIMITS } from "@/lib/preference-limits";
// 纯函数,零依赖,便于单测。
//
// 临期窗口与边界(2026-11-27 修):
//   · 此前这里写死「now + 7 天」,而概览/提醒中心/物品卡/详情页都用**用户设置**的
//     「保质期提前 N 天」。用户把提醒设成 30 天,空间卡仍然只数 7 天内的 ——
//     实测同一屏:提醒中心说 8 件临期,空间卡说 6 件。
//   · 而且还把**已过期**的算进「临期」,并拿原始时间戳比较(项目自己的口径是按本地自然日,
//     见 expiry-status 里 daysUntilLocalDay 的说明)。已过期的东西现在单独数、单独说。

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
  /** 窗口内即将到期的件数(不含已过期) */
  expiring: number;
  /** 已经过期的件数(不限窗口) */
  expired: number;
  /** 估算价值(数量 × 单价) */
  value: number;
  /** 低于最低库存的消耗品件数 */
  lowStock: number;
};

/**
 * @param windowDays 临期窗口(天),来自用户设置的「保质期提前 N 天」。
 *   默认值只给单测用 —— 界面必须把用户的设置传进来,否则又会出现
 *   「改了设置但空间卡不认」。
 * @param locationIds 算进摘要的空间:**自己 + 下级空间**(用 locationSubtreeIds 求),
 *   这样卡片上的「N 件」就等于点卡片进物品页看到的件数。传单个字符串仍然只算那一个空间
 *   (老调用方式保留)。此前只收一个 id 并且只比 `item.locationId === id`,
 *   于是「自己没物品、下级空间有」的空间卡片写着「还没放东西」,点进去却有东西。
 */
export function spaceSummary(
  items: readonly SpaceItemInput[],
  locationIds: string | readonly string[],
  now = Date.now(),
  windowDays: number = PREFERENCE_LIMITS.expiryReminderDays.fallback,
): SpaceSummary {
  const ids = typeof locationIds === "string" ? new Set([locationIds]) : new Set(locationIds);
  // 只算「还在」的东西:数量 0 件的物品在任何列表里都看不到(物品页/搜索/空间筛选都按 quantity > 0 取,
  // 消耗到 0 件时提示条也会说「已从物品列表隐藏」)。卡片上的「N 件」若把它算进去,就会出现
  // 「厨房卡片 3 件、点进去 2 件」—— 2026-11-28 探针库实测:厨房里一件物品消耗到 0 件后正是如此。
  // 「快用完了」是另一条口径(用完的正是该补货的,概览与月报都特意带上它),不在这里管。
  const scoped = items.filter((item) => item.locationId !== null && ids.has(item.locationId) && item.quantity > 0);
  let cold = 0;
  let expiring = 0;
  let expired = 0;
  let value = 0;
  let lowStock = 0;

  for (const item of scoped) {
    if (item.storage === "COLD" || item.storage === "COLD_AFTER_OPEN") cold += 1;
    if (item.expiryDate) {
      // 天数按**本地自然日**算(与全站同一个口径),不看原始时间戳
      const days = daysUntilLocalDay(item.expiryDate, now);
      if (Number.isFinite(days)) {
        if (days < 0) expired += 1;
        else if (isExpiringSoonDays(days, windowDays)) expiring += 1;
      }
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
    expired,
    value: Number(value.toFixed(2)),
    lowStock,
  };
}

/**
 * 卡片上那一行摘要。只列出「有内容」的项,空空间给一句明确的提示,
 * 而不是让用户对着一堆 0 猜。
 *
 * @param childSpaces 这个空间有几个**直接下级空间**。有下级时把这件事说出来:
 *   否则「厨房 2 件」与「吊柜 1 件」摆在同一屏上,看着像多数了一件
 *   (其实是厨房自己的 1 件 + 吊柜里的 1 件)。
 */
export function spaceSummaryText(summary: SpaceSummary, childSpaces = 0) {
  if (summary.count === 0) return childSpaces > 0 ? "还没放东西(下级空间也是空的)" : "还没放东西";
  const parts = [`${summary.count} 件`];
  if (childSpaces) parts.push(`含 ${childSpaces} 个下级空间`);
  if (summary.cold) parts.push(`${summary.cold} 件需冷藏`);
  // 已过期比临期更急,先说;两者分开数,不再混成一句「N 件临期」
  if (summary.expired) parts.push(`${summary.expired} 件已过期`);
  if (summary.expiring) parts.push(`${summary.expiring} 件临期`);
  if (summary.lowStock) parts.push(`${summary.lowStock} 件该补货`);
  if (summary.value > 0) parts.push(`约 ¥${Math.round(summary.value)}`);
  return parts.join(" · ");
}

/** 需要提醒的状态(用于卡片上的小圆点/角标);没有则返回 null。 */
export function spaceAlert(summary: SpaceSummary): "danger" | "warning" | null {
  if (summary.expired || summary.expiring) return "danger";
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
 * 还有一处容易误会(2026-11-27 补):**挡住删除的是「直接放在这一层」的物品**
 * (服务端就是按 `locationId = 本空间` 数的),而空间卡上的「N 件」现在含下级空间 ——
 * 于是卡片写 2 件、这里说「还有 1 件」。有下级空间时把这句话说出来,免得用户以为数错了。
 *
 * 纯函数,便于单测:返回 null 表示「根本不能删」,否则给出确认框要用的三段文案。
 */
export function spaceDeletePrompt(locationName: string, itemCount: number, childCount: number, usedUpCount: number): {
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
      message: `“${locationName}”里还有 ${itemCount} 件物品,不能直接删除。先把这些物品移到别的空间(打开物品改「存放位置」),或者先处理掉它们。`
        // 「已用完」(数量 0)的物品按设计不显示在物品页与搜索里 —— 对它们说「请先移动」是空话:
        // 2026-11-28 探针库实测,空间里只有一件已用完的物品时,导轨与卡片都写 0 件/「还没放东西」,
        // 删除却回「还有 1 件物品」,而那件东西在物品页、搜索、回收站里都找不到。说清楚它是什么、
        // 为什么动不了,比让用户对着一句做不到的指示强。
        + (usedUpCount > 0 ? `其中 ${usedUpCount} 件已经用完(库存 0 件),按设计不显示在物品页和搜索里 —— 现在界面上没有移动或删除它们的入口,所以这个空间暂时删不掉。` : "")
        + (childCount > 0 ? `下级空间里的物品不算在这 ${itemCount} 件里 —— 删掉本空间时,${childCount} 个下级空间会变成顶级空间,里面的东西不受影响。` : ""),
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
