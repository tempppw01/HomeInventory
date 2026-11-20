import { localDateString } from "@/lib/local-date";
// CSV 导入 —— 让「导出 CSV」的文件能重新导回来。
//
// 之前物品页能导出 CSV,但导入只接受应用自己生成的 JSON,导出的表格改完再传回来会失败。
// 这里把 CSV 解析与列名映射做成纯函数,便于单测,也方便以后支持更多列。
// 只做「解析 + 映射」:校验与写库仍由 /api/items/import 负责,避免两套规则。
// 「存放位置」列只输出 locationName,由接口按名字匹配(不存在时可创建),前端不碰数据库。

export type CsvIssue = { row: number; error: string };

/** 表头别名:既认中文(与导出 CSV 一致),也认常见英文写法。 */
const HEADER_ALIASES: Record<string, string> = {
  名称: "name",
  物品名称: "name",
  name: "name",
  数量: "quantity",
  quantity: "quantity",
  单位: "unit",
  unit: "unit",
  分类: "category",
  category: "category",
  类型: "type",
  type: "type",
  剩余量: "remainingPercent",
  "剩余量(%)": "remainingPercent",
  remainingpercent: "remainingPercent",
  购入日期: "purchaseDate",
  购买日期: "purchaseDate",
  purchasedate: "purchaseDate",
  到期日期: "expiryDate",
  有效期: "expiryDate",
  expirydate: "expiryDate",
  单价: "price",
  price: "price",
  备注: "notes",
  notes: "notes",
  存放位置: "locationName",
  位置: "locationName",
  location: "locationName",
  locationname: "locationName",
  最低库存: "minQuantity",
  minquantity: "minQuantity",
};

/** 逐字符解析,支持引号包裹、引号转义、字段内换行、CRLF 与 UTF-8 BOM。 */
export function parseCsv(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (quoted) {
      if (char === '"') {
        if (cleaned[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (char === "\r") continue;
    field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  // 丢掉完全空白的行(表格软件常在末尾留空行)
  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

function toNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(/[¥￥,]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toDate(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // 常见写法 2026/11/21、2026-11-21、2026.11.21 统一成 ISO 日期
  const match = trimmed.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : localDateString(parsed);
}

function toType(value: string): "CONSUMABLE" | "DURABLE" | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/消耗|consum/i.test(trimmed)) return "CONSUMABLE";
  if (/耐用|durab/i.test(trimmed)) return "DURABLE";
  return undefined;
}

export type CsvItemRow = Record<string, unknown> & { name: string };

/**
 * 把 CSV 行映射成导入接口能吃的对象。
 * 缺名称、行数超限都记进 issues,而不是静默丢弃 —— 用户需要知道哪一行没导进去。
 */
export function csvToItems(text: string, limit = 1000): { items: CsvItemRow[]; issues: CsvIssue[] } {
  const rows = parseCsv(text);
  if (!rows.length) return { items: [], issues: [{ row: 0, error: "文件里没有内容" }] };

  const headerRow = rows[0];
  const columns = headerRow.map((cell) => HEADER_ALIASES[cell.trim().toLowerCase()] ?? HEADER_ALIASES[cell.trim()] ?? "");
  if (!columns.includes("name")) {
    return { items: [], issues: [{ row: 1, error: "缺少「名称」列,请使用「导出当前筛选为 CSV」生成的文件" }] };
  }

  const items: CsvItemRow[] = [];
  const issues: CsvIssue[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    if (items.length >= limit) {
      issues.push({ row: index + 1, error: `一次最多导入 ${limit} 行,后面的已跳过` });
      break;
    }
    const cells = rows[index];
    const record: Record<string, string> = {};
    columns.forEach((key, columnIndex) => {
      if (key) record[key] = (cells[columnIndex] ?? "").trim();
    });

    const name = record.name ?? "";
    if (!name) { issues.push({ row: index + 1, error: "缺少名称" }); continue; }

    const quantity = toNumber(record.quantity ?? "");
    const minQuantity = toNumber(record.minQuantity ?? "");
    const remainingPercent = toNumber(record.remainingPercent ?? "");
    const price = toNumber(record.price ?? "");
    const purchaseDate = toDate(record.purchaseDate ?? "");
    const expiryDate = toDate(record.expiryDate ?? "");
    const type = toType(record.type ?? "");

    items.push({
      name,
      ...(record.category ? { category: record.category } : {}),
      ...(type ? { type } : {}),
      ...(quantity !== undefined ? { quantity } : {}),
      ...(minQuantity !== undefined ? { minQuantity } : {}),
      ...(remainingPercent !== undefined ? { remainingPercent } : {}),
      ...(record.unit ? { unit: record.unit } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(purchaseDate ? { purchaseDate } : {}),
      ...(expiryDate ? { expiryDate } : {}),
      ...(record.notes ? { notes: record.notes } : {}),
      ...(record.locationName ? { locationName: record.locationName } : {}),
    });
  }

  return { items, issues };
}

/** 导入结果的一句话总结:成功多少、跳过多少(附前几条原因)。 */
export function importResultText(
  imported: number,
  remoteErrors: CsvIssue[] | undefined,
  localIssues: CsvIssue[] = [],
  createdLocations: string[] = [],
): string {
  const issues = [...localIssues, ...(remoteErrors ?? [])];
  if (!imported && !issues.length) return "没有可导入的内容";
  const base = imported ? `已导入 ${imported} 件物品` : "没有导入任何物品";
  if (!issues.length) {
    return createdLocations.length ? `${base};新建空间 ${createdLocations.length} 个(${createdLocations.slice(0, 3).join("、")}${createdLocations.length > 3 ? " 等" : ""})` : base;
  }
  const first = issues[0];
  const more = issues.length > 1 ? ` 等 ${issues.length} 处` : "";
  const skipped = `跳过 ${issues.length} 处(第 ${first.row} 行:${first.error})${more}`;
  const locations = createdLocations.length ? `;新建空间 ${createdLocations.length} 个(${createdLocations.slice(0, 3).join("、")}${createdLocations.length > 3 ? " 等" : ""})` : "";
  return `${base};${skipped}${locations}`;
}