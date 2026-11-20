// 「该补货」的统一判定。
//
// 为什么单独抽出来:同一个概念此前有**三套不同实现** ——
//   · 物品列表的角标:minQuantity 触发 **或** 液体剩余 ≤20%
//   · 概览/提醒(provider):上面两条 **再加**「不处于暂停补货期」与 quantity > 0
//   · 空间摘要与家庭成员月报:**只有** minQuantity 那一条(漏了液体)
// 结果是液体见底时列表说该补货、空间摘要却说「0 件该补货」。
//
// 这里定成一份,四处共用。

import { isLiquidConsumable } from "@/lib/item-metrics";

/** 液体低于这个余量就算该补货 */
export const LIQUID_LOW_PERCENT = 20;

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
 * 是否该补货。
 * @param now 传入「现在」用于判断暂停补货是否已过期;不传则忽略暂停(用于纯展示场景)。
 */
export function isLowStock(item: LowStockInput, now?: number): boolean {
  if (item.type !== "CONSUMABLE") return false;
  if (item.quantity <= 0) return false;

  // 用户主动暂停补货提醒的,期内不再打扰
  if (now !== undefined && item.restockPausedUntil) {
    const pausedUntil = new Date(item.restockPausedUntil).getTime();
    if (Number.isFinite(pausedUntil) && pausedUntil > now) return false;
  }

  if (item.minQuantity > 0 && item.quantity <= item.minQuantity) return true;
  return isLiquidConsumable(item) && item.remainingPercent <= LIQUID_LOW_PERCENT;
}
