// 冰箱清单 —— 把「该冷藏」的物品整理成一份能直接照着做的清单。
//
// 背景:存放建议由后台规则引擎写入(storage = COLD / COLD_AFTER_OPEN / ROOM),
// 但很多物品录入时没设位置,冰箱里到底有什么仍然说不清。这里不再引入新字段,
// 而是用「位置名称是否像冰箱」来判断,把没归位的先拎出来。

export type FridgeInput = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  storage: string | null;
  locationName: string | null;
};

/** 位置名看起来像冰箱/冷柜 */
export function looksLikeFridge(locationName: string | null) {
  if (!locationName) return false;
  return /冰箱|冷藏|冷冻|冷柜|冰柜|保鲜/.test(locationName);
}

export type FridgePlan = {
  /** 需要冷藏的物品总数(含开封后冷藏) */
  total: number;
  /** 需冷藏且位置已在冰箱/冷柜 */
  placed: FridgeInput[];
  /** 需冷藏但没设位置,或位置看起来不是冰箱 —— 最需要处理的一类 */
  unplaced: FridgeInput[];
  /** 开封后需冷藏的(常温放着也行,提醒一下即可) */
  afterOpen: FridgeInput[];
};

export function fridgePlan(items: readonly FridgeInput[]): FridgePlan {
  const cold = items.filter((item) => item.storage === "COLD");
  const afterOpen = items.filter((item) => item.storage === "COLD_AFTER_OPEN");
  const placed = cold.filter((item) => looksLikeFridge(item.locationName));
  const unplaced = cold.filter((item) => !looksLikeFridge(item.locationName));
  return { total: cold.length + afterOpen.length, placed, unplaced, afterOpen };
}

/** 一行摘要:没有需要冷藏的东西时返回 null,界面据此整块隐藏。 */
export function fridgeSummary(plan: FridgePlan) {
  if (!plan.total) return null;
  if (!plan.unplaced.length) return `${plan.placed.length} 件已放好`;
  return `该冷藏 ${plan.total} 件,${plan.unplaced.length} 件还没放好`;
}