// 重复物品合并 —— 纯函数部分。
//
// 合并是不可逆操作,所以:
// · 只允许「同单位」的物品合并(2 盒 + 1 瓶无法相加,硬加只会造出错数据);
// · 保质期取最早的一条(先过期的先吃掉);
// · 液体余量取较低的一条(更保守,避免高估);
// · 备注拼在一起,别丢信息。

export type MergeCandidate = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  remainingPercent: number;
  price: number | null;
  purchaseDate: string | null;
  expiryDate: string | null;
  notes: string | null;
  locationId: string | null;
};

export type MergePlan = {
  /** 合并后的字段(写入保留的那条) */
  merged: {
    quantity: number;
    remainingPercent: number;
    price: number | null;
    purchaseDate: string | null;
    expiryDate: string | null;
    notes: string | null;
    locationId: string | null;
  };
  /** 被合并掉的条目 id */
  removedIds: string[];
  /** 给用户看的一句话说明 */
  summary: string;
};

export type MergeFailure = { error: string };

function earliest(values: Array<string | null>): string | null {
  const times = values.filter((value): value is string => Boolean(value)).map((value) => new Date(value).getTime()).filter((time) => Number.isFinite(time));
  if (!times.length) return null;
  const min = Math.min(...times);
  return new Date(min).toISOString();
}

/** 生成合并方案;单位不一致时返回错误,而不是悄悄算出一个错数。 */
export function planMerge(keep: MergeCandidate, others: readonly MergeCandidate[]): MergePlan | MergeFailure {
  const group = [keep, ...others];
  const units = [...new Set(group.map((item) => item.unit))];
  if (units.length > 1) {
    return { error: `单位不一致(${units.join(" / ")}),请先统一单位再合并` };
  }

  const quantity = group.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
  const remainingPercent = Math.min(...group.map((item) => Math.max(0, Math.min(100, item.remainingPercent))));
  const price = group.map((item) => item.price).find((value) => value != null && value > 0) ?? null;
  const purchaseDate = earliest(group.map((item) => item.purchaseDate));
  const expiryDate = earliest(group.map((item) => item.expiryDate));
  const notes = [...new Set(group.map((item) => (item.notes ?? "").trim()).filter(Boolean))].join("\n") || null;
  const locationId = keep.locationId ?? group.find((item) => item.locationId)?.locationId ?? null;

  return {
    merged: { quantity, remainingPercent, price, purchaseDate, expiryDate, notes, locationId },
    removedIds: others.map((item) => item.id),
    summary: `合并 ${group.length} 条为「${keep.name}」,合计 ${quantity} ${keep.unit}`,
  };
}