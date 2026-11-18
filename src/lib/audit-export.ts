// 盘点结果导出 —— 把这次核对的结果变成一份能存档/发给家人的表格。
//
// 盘点界面的结果此前只存在浏览器本地(confirmed 集合),结束后就散掉了:
// 想留个记录、或者把「哪些没找到」发给家人看,都没有出口。

export type AuditItemInput = {
  id: string;
  itemCode: string | null;
  name: string;
  category: string;
  type: "DURABLE" | "CONSUMABLE";
  quantity: number;
  unit: string;
  expiryDate: string | null;
  locationPath: string | null;
};

export const AUDIT_HEADER = ["物品编号", "名称", "分类", "类型", "数量", "单位", "存放位置", "到期日期", "盘点状态"] as const;

export type AuditRow = {
  code: string;
  name: string;
  category: string;
  typeLabel: string;
  quantity: number;
  unit: string;
  location: string;
  expiry: string;
  status: "已确认" | "未确认";
};

/** 生成盘点明细行:已确认在前(方便先看对上的),未确认在后。 */
export function auditRows(items: readonly AuditItemInput[], confirmedIds: ReadonlySet<string>): AuditRow[] {
  return items
    .map((item) => ({
      code: item.itemCode ?? item.id,
      name: item.name,
      category: item.category,
      typeLabel: item.type === "CONSUMABLE" ? "消耗品" : "耐用品",
      quantity: item.quantity,
      unit: item.unit,
      location: item.locationPath ?? "未设置",
      expiry: item.expiryDate ? item.expiryDate.slice(0, 10) : "",
      status: (confirmedIds.has(item.id) ? "已确认" : "未确认") as "已确认" | "未确认",
    }))
    .sort((left, right) => (left.status === right.status ? left.name.localeCompare(right.name) : left.status === "已确认" ? -1 : 1));
}

/** 表头 + 行,直接可交给 csvStringify。 */
export function auditCsvRows(rows: readonly AuditRow[]) {
  return rows.map((row) => [row.code, row.name, row.category, row.typeLabel, row.quantity, row.unit, row.location, row.expiry, row.status]);
}

export function auditSummaryText(total: number, confirmed: number) {
  if (!total) return "当前范围没有物品";
  const missing = total - confirmed;
  if (!missing) return `全部 ${total} 件都已核对`;
  return `共 ${total} 件,已核对 ${confirmed} 件,未核对 ${missing} 件`;
}