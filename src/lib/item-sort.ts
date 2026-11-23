// 物品排序 —— 物品页此前只有固定顺序(最近更新),想按「最快到期」看一眼并不行。
//
// 纯函数(只依赖 lib/expiry-status 的日期口径):排序规则集中在一处,页面与单测共用。
// 约定:没有到期日期的物品永远排在最后(而不是被当成「很久以后」或「今天」)。

import { daysUntilLocalDay } from "@/lib/expiry-status";

export type SortMode = "updated" | "expiry" | "name" | "quantity";

export const SORT_MODES: ReadonlyArray<{ id: SortMode; label: string }> = [
  { id: "updated", label: "最近更新" },
  { id: "expiry", label: "最快到期" },
  { id: "name", label: "名称" },
  { id: "quantity", label: "数量最多" },
];

export const SORT_LABELS: Record<SortMode, string> = {
  updated: "最近更新",
  expiry: "最快到期",
  name: "名称",
  quantity: "数量最多",
};

export function isSortMode(value: unknown): value is SortMode {
  return value === "updated" || value === "expiry" || value === "name" || value === "quantity";
}

type Sortable = {
  name: string;
  quantity: number;
  expiryDate: string | null;
  updatedAt?: string | null;
};

function timeOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** 稳定排序:相同排序键时保持传入顺序,避免每次渲染卡片乱跳。 */
export function sortItems<T extends Sortable>(items: readonly T[], mode: SortMode): T[] {
  if (mode === "updated") return [...items];

  const withIndex = items.map((item, index) => ({ item, index }));

  withIndex.sort((left, right) => {
    if (mode === "expiry") {
      const a = timeOf(left.item.expiryDate);
      const b = timeOf(right.item.expiryDate);
      // 没有到期日期的排最后
      if (a === null && b === null) return left.index - right.index;
      if (a === null) return 1;
      if (b === null) return -1;
      if (a !== b) return a - b;
      return left.index - right.index;
    }

    if (mode === "name") {
      const result = left.item.name.localeCompare(right.item.name, "zh-CN");
      return result !== 0 ? result : left.index - right.index;
    }

    // quantity:数量多的在前
    if (left.item.quantity !== right.item.quantity) return right.item.quantity - left.item.quantity;
    return left.index - right.index;
  });

  return withIndex.map((entry) => entry.item);
}

/** 排序后的界面提示:最快的到期还剩几天,让用户知道为什么它排第一。 */
export function sortHint(mode: SortMode, items: readonly Sortable[], now = Date.now()): string | null {
  if (mode !== "expiry") return null;
  const times = items
    .map((item) => timeOf(item.expiryDate))
    .filter((time): time is number => time !== null);
  if (!times.length) return "这些物品都没有填有效期";
  const days = daysUntilLocalDay(new Date(Math.min(...times)), now);
  if (days < 0) return `最快的一件已过期 ${Math.abs(days)} 天`;
  if (days === 0) return "最快的一件今天到期";
  return `最快的一件还有 ${days} 天到期`;
}