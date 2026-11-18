// CSV 序列化与盘点导出的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { csvStringify, withBom, countCsvRows } from "../../src/lib/csv.ts";
import { AUDIT_HEADER, auditRows, auditCsvRows, auditSummaryText } from "../../src/lib/audit-export.ts";

test("普通单元格不加引号", () => {
  assert.equal(csvStringify(["a", "b"], [["1", "2"]]), "a,b\r\n1,2");
});

test("含逗号/引号/换行的单元格会转义", () => {
  const text = csvStringify(["名称", "备注"], [["可乐,大瓶", '他说"好"\n换行']]);
  assert.equal(text, '名称,备注\r\n"可乐,大瓶","他说""好""\n换行"');
});

test("null/undefined 输出空字符串,数字原样", () => {
  assert.equal(csvStringify(["a", "b", "c"], [[null, undefined, 3]]), "a,b,c\r\n,,3");
});

test("首尾有空格也加引号(避免表格软件吃掉)", () => {
  assert.equal(csvStringify(["a"], [[" 前后有空格 "]]), 'a\r\n" 前后有空格 "');
});

test("BOM 与行数工具", () => {
  const text = withBom(csvStringify(["a"], [["1"], ["2"]]));
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.equal(countCsvRows(text), 2);
});

const ITEMS = [
  { id: "i1", itemCode: "INV-1", name: "布洛芬", category: "医药·疼痛炎症", type: "CONSUMABLE", quantity: 2, unit: "盒", expiryDate: "2026-11-21T00:00:00.000Z", locationPath: "厨房/吊柜" },
  { id: "i2", itemCode: null, name: "电钻", category: "家电", type: "DURABLE", quantity: 1, unit: "台", expiryDate: null, locationPath: null },
  { id: "i3", itemCode: "INV-3", name: "酸奶", category: "饮品", type: "CONSUMABLE", quantity: 3, unit: "盒", expiryDate: null, locationPath: "冰箱" },
];

test("已确认排在前面,未确认在后", () => {
  const rows = auditRows(ITEMS, new Set(["i1", "i2"]));
  assert.deepEqual(rows.map((row) => row.status), ["已确认", "已确认", "未确认"]);
  assert.equal(rows[2].name, "酸奶");
});

test("字段映射:编号缺失用 id,位置缺失写未设置,日期取日期部分", () => {
  const rows = auditRows(ITEMS, new Set());
  const pill = rows.find((row) => row.id === undefined || row.name === "布洛芬");
  assert.equal(pill.expiry, "2026-11-21");
  const drill = rows.find((row) => row.name === "电钻");
  assert.equal(drill.code, "i2");
  assert.equal(drill.location, "未设置");
  assert.equal(drill.typeLabel, "耐用品");
});

test("CSV 行数等于物品数,表头固定 9 列", () => {
  const rows = auditRows(ITEMS, new Set(["i1"]));
  const csv = csvStringify(AUDIT_HEADER, auditCsvRows(rows));
  assert.equal(countCsvRows(csv), ITEMS.length);
  assert.equal(csv.split("\r\n")[0].split(",").length, AUDIT_HEADER.length);
});

test("摘要文案随核对进度变化", () => {
  assert.equal(auditSummaryText(0, 0), "当前范围没有物品");
  assert.equal(auditSummaryText(3, 3), "全部 3 件都已核对");
  assert.equal(auditSummaryText(3, 1), "共 3 件,已核对 1 件,未核对 2 件");
});