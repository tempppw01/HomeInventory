// 「这个词能不能搜到这件物品」——只保留一份定义。
//
// 起因(实测):同一件事有三个实现,字段各不相同 ——
//   · 物品页的列表过滤:名称 / 编号 / 分类 / 空间名 / 自动标签
//   · 搜索框的下拉建议:名称 / 编号 / 分类 / 空间名(少了自动标签)
//   · 接口 /api/items?q=:名称 / 分类 / **备注** / 自动标签(少了编号与空间名)
//
// 于是:把「买二送一」写在**备注**里的物品,接口能搜到、界面上搜不到;
// 而输入**物品编号**,下拉能给出建议、接口却一条都不返回。
// 用户看不出这套规则 —— 这里把三处统一到同一份字段清单。
export type SearchableItem = {
  name: string;
  itemCode?: string | null;
  category?: string | null;
  notes?: string | null;
  autoTags?: string | null;
  location?: { name?: string | null } | null;
};

/**
 * 这个物品要不要出现在搜索/过滤结果里。
 *
 * 空搜索词视为「都匹配」(调用方通常还会叠加其它筛选条件)。
 * 匹配是**忽略大小写的子串**:中文与英文都不做分词,和原来的行为一致。
 */
export function matchesSearch(item: SearchableItem, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  const fields = [item.name, item.itemCode, item.category, item.notes, item.autoTags, item.location?.name];
  return fields.some((field) => (field ? String(field).toLowerCase().includes(needle) : false));
}