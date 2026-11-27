import { isMedicineCategory } from "@/lib/categories";
import { matchesSearch, type SearchableItem } from "@/lib/item-search";

/**
 * 「看得见的物品」这条规则,以前写在 app-provider 里一句话:筛选 + `quantity > 0`。
 *
 * 数量那条把**已用完(0 件)**的物品挡在所有列表之外(这是有意的:消耗到 0 件时提示条会说
 * 「已从物品列表隐藏」),但也让它们**在界面上完全没有入口** —— 不在物品页、不在搜索、
 * 不在回收站,于是空间删不掉(v0.1.112 实测:卡片写「还没放东西」,删除却回「还有 1 件物品,
 * 请先移动」,而那件东西根本找不到)、补货也无从下手。
 *
 * 所以把「筛选」和「数量」拆开:条件抽成一处共用,数量交给调用方选「还在用」还是「已用完」。
 * 这样「已用完」能有一个入口,而两个列表用的是**同一套筛选条件**,不会各写一套然后漂移
 * (搜索字段就吃过这个亏:列表过滤、下拉建议、接口 q 曾经各一套,字段还不一样)。
 */

/** 列表筛选的四项条件,与界面上的控件一一对应。 */
export type ItemFilterConditions = {
  search: string;
  /** "ALL" | "MEDICINE" | 物品类型 */
  typeFilter: string;
  /** "ALL" | "MEDICINE" | 分类名 */
  categoryFilter: string;
  /** 空间范围(含下级空间);null 表示不按空间筛 */
  spaceScope: ReadonlySet<string> | null;
};

export type FilterableItem = SearchableItem & {
  type: string;
  category?: string | null;
  locationId?: string | null;
  quantity: number;
};

/** 除数量之外的条件是否命中。 */
export function matchesItemFilters(item: FilterableItem, conditions: ItemFilterConditions): boolean {
  const category = item.category ?? "";
  const typeOk =
    conditions.typeFilter === "ALL" ||
    (conditions.typeFilter === "MEDICINE" ? isMedicineCategory(category) : item.type === conditions.typeFilter);
  const categoryOk =
    conditions.categoryFilter === "ALL" ||
    (conditions.categoryFilter === "MEDICINE" ? isMedicineCategory(category) : category === conditions.categoryFilter);
  const spaceOk = !conditions.spaceScope || conditions.spaceScope.has(item.locationId ?? "");
  return typeOk && categoryOk && spaceOk && matchesSearch(item, conditions.search.toLowerCase().trim());
}

/** 「还在用」= 数量大于 0;「已用完」= 数量 0(或异常负数,一并当成用完的)。 */
export type QuantityView = "live" | "usedUp";

export function pickVisibleItems<T extends FilterableItem>(
  items: readonly T[],
  conditions: ItemFilterConditions,
  view: QuantityView,
): T[] {
  return items.filter((item) => (view === "live" ? item.quantity > 0 : item.quantity <= 0) && matchesItemFilters(item, conditions));
}
