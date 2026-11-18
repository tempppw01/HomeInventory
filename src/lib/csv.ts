// CSV 序列化 —— 导出侧的统一实现。
//
// 之前物品页的导出逻辑写在组件里,盘点结果也要导出,再复制一遍就成了第三份。
// 这里只做「表头 + 行 → 文本」这一件事,顺便把转义规则固定下来:
// 含逗号、引号、换行或首尾空白的单元格一律用双引号包裹,内部引号翻倍。

export type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const needsQuotes = /[",\r\n]/.test(text) || text !== text.trim();
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvStringify(header: readonly string[], rows: ReadonlyArray<readonly CsvCell[]>, eol = "\r\n"): string {
  const lines = [header.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));
  return lines.join(eol);
}

/** Excel 打开中文 CSV 需要 BOM,否则会乱码。 */
export function withBom(text: string): string {
  return `\uFEFF${text}`;
}

/** 从原始 CSV 文本里数行数(不含表头),仅用于自检/日志。 */
export function countCsvRows(text: string): number {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  return Math.max(0, lines.length - 1);
}