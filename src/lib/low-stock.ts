// 「该补货」的统一判定。
//
// 为什么单独抽出来:同一个概念此前有**三套不同实现** ——
//   · 物品列表的角标:minQuantity 触发 **或** 液体剩余 ≤20%
//   · 概览/提醒(provider):上面两条 **再加**「不处于暂停补货期」与 quantity > 0
//   · 空间摘要与家庭成员月报:**只有** minQuantity 那一条(漏了液体)
// 结果是液体见底时列表说该补货、空间摘要却说「0 件该补货」。
//
// 这里定成一份,四处共用。
//
// 但「共用」在**暂停补货**这件事上漏过一次(2026-11-21 起):下面 isLowStock 的
// `now` 参数当时写成了可选,不传就整条跳过暂停判定,而三个只做展示的调用点
// (物品卡角标 / 空间摘要 / 月报)恰好都没传。于是用户暂停了某件东西:
// 概览的「低库存」少算了它,同一张卡片上却还挂着「需补货」,空间卡与月报照旧列它 ——
// 同一个「该补货」在一屏里有两个答案。
// 暂停的语义是「这件东西别再跟我说」,项目里别的展示面(item-forecast / spend-forecast)
// 本来就跳过暂停中的物品;所以现在**一律按当前时间判断**,`now` 只留给测试注入固定时钟。

import { isLiquidConsumable } from "@/lib/item-metrics";
import { LIQUID_LOW_PERCENT } from "@/lib/restock-limits";

// 阈值只有一份,在 restock-limits 里(服务端生成采购建议用的是同一个数)。
export { LIQUID_LOW_PERCENT };

export type LowStockInput = {
  type: "DURABLE" | "CONSUMABLE";
  name: string;
  category: string;
  unit: string;
  quantity: number;
  minQuantity: number;
  remainingPercent: number;
  restockPausedUntil?: Date | string | null;
};

/**
 * 是否处于「暂停补货提醒」期内。
 * 抽成函数还有个好处:组件在渲染期调用它不会触发 React 的「不要在 render 里调不纯函数」告警
 * (直接写 Date.now() 会被拦下),项目里 expiryDays(item) 也是同样的写法。
 */
export function isRestockPaused(
  item: { restockPausedUntil?: Date | string | null },
  now: number = Date.now(),
): boolean {
  if (!item.restockPausedUntil) return false;
  const pausedUntil = new Date(item.restockPausedUntil).getTime();
  return Number.isFinite(pausedUntil) && pausedUntil > now;
}

/**
 * 是否该补货。
 * @param now 「现在」,用来判断暂停补货有没有过期。默认取当前时间 ——
 *   不能把「不传」当成「忽略暂停」:那样每个调用点都得记得传,漏一个就多一处
 *   「已经暂停了还在提醒」。要固定时钟(单测)就显式传进来。
 */
export function isLowStock(item: LowStockInput, now: number = Date.now()): boolean {
  if (item.type !== "CONSUMABLE") return false;
  if (item.quantity <= 0) return false;

  // 用户主动暂停补货提醒的,期内不再打扰 —— 所有调用点都算数,没有例外
  if (isRestockPaused(item, now)) return false;

  if (item.minQuantity > 0 && item.quantity <= item.minQuantity) return true;
  return isLiquidConsumable(item) && item.remainingPercent <= LIQUID_LOW_PERCENT;
}

/**
 * 该补货是**哪条线**触发的:数量线,还是液体余量线。
 *
 * 为什么单独一个函数(2026-11-27 实测):概览首屏与「补货建议」此前按「是不是液体」选说法,
 * 而提醒中心按**真正触发的那条线**选。同一件东西于是有两个答案 ——
 * 提醒中心说「库存仅剩 1 瓶」(数量线触发),首屏说「余量只剩 100%,低于你设的提醒线」。
 * 100% 显然不低:界面要说的是「为什么」,就得按真正触发的那条线说。
 * 判定顺序与 isLowStock 一致:数量线优先(两条都成立时,数量是更具体的理由)。
 */
export function lowStockTrigger(item: LowStockInput, now: number = Date.now()): "count" | "liquid" | null {
  if (!isLowStock(item, now)) return null;
  return item.minQuantity > 0 && item.quantity <= item.minQuantity ? "count" : "liquid";
}
