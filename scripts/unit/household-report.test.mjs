// 家庭月报汇总的单测:
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHouseholdReport, monthLabelFor, reportHeadline } from "../../src/lib/household-report.ts";

const baseItem = (patch) => ({
  name: patch.name ?? "物品",
  type: patch.type ?? "CONSUMABLE",
  quantity: patch.quantity ?? 1,
  unit: patch.unit ?? "件",
  price: patch.price ?? null,
  consumeRate: patch.consumeRate ?? null,
  minQuantity: patch.minQuantity ?? 0,
});

const NOW = new Date("2026-11-18T10:00:00Z");

test("月份标签按本地时区", () => {
  assert.equal(monthLabelFor(new Date("2026-11-18T00:00:00")), "2026 年 11 月");
  assert.equal(monthLabelFor(new Date("2027-01-05T00:00:00")), "2027 年 1 月");
});

test("计数与价值", () => {
  const report = buildHouseholdReport({
    now: NOW,
    items: [
      baseItem({ name: "胶囊", quantity: 2, price: 15 }),
      baseItem({ name: "电钻", type: "DURABLE", quantity: 1, price: 300 }),
    ],
    locationCount: 3,
    expiring: [],
    runningOut: [],
    fridgeMissing: [],
  });
  assert.deepEqual(report.counts, { total: 2, consumable: 1, durable: 1, locations: 3 });
  assert.equal(report.value, 330);
});

test("月支出只算「有消耗速度 + 有单价」的消耗品", () => {
  const report = buildHouseholdReport({
    now: NOW,
    items: [
      baseItem({ name: "抽纸", consumeRate: 1, price: 20 }),          // 600
      baseItem({ name: "洗衣液", consumeRate: 0.2, price: 40 }),       // 240
      baseItem({ name: "没有单价", consumeRate: 5, price: null }),      // 不计
      baseItem({ name: "没有速度", consumeRate: null, price: 9 }),      // 不计
      baseItem({ name: "电钻", type: "DURABLE", consumeRate: 1, price: 300 }), // 不计
    ],
    locationCount: 0,
    expiring: [],
    runningOut: [],
    fridgeMissing: [],
  });
  assert.equal(Math.round(report.monthlySpend), 840);
});

test("临期只保留 30 天内、按天数升序、标记已过期", () => {
  const report = buildHouseholdReport({
    now: NOW,
    items: [],
    locationCount: 0,
    expiring: [
      { name: "远的", days: 40 },
      { name: "明天", days: 1 },
      { name: "过期", days: -3 },
      { name: "下周", days: 7 },
    ],
    runningOut: [],
    fridgeMissing: [],
  });
  assert.deepEqual(report.expiring.map((row) => row.name), ["过期", "明天", "下周"]);
  assert.equal(report.expiring[0].expired, true);
  assert.equal(report.expiring[1].expired, false);
});

test("低库存与冰箱缺失各自最多列 6 条", () => {
  const report = buildHouseholdReport({
    now: NOW,
    items: Array.from({ length: 8 }, (_, index) => baseItem({ name: `低于${index}`, quantity: 1, minQuantity: 5 })),
    locationCount: 0,
    expiring: [],
    runningOut: [],
    fridgeMissing: Array.from({ length: 8 }, (_, index) => `冷藏${index}`),
  });
  assert.equal(report.lowStock.length, 6);
  assert.equal(report.fridgeMissing.length, 6);
});

test("快用完按天数升序,最多 5 条", () => {
  const report = buildHouseholdReport({
    now: NOW,
    items: [],
    locationCount: 0,
    expiring: [],
    runningOut: [
      { name: "a", days: 5, unit: "包" },
      { name: "b", days: 1, unit: "瓶" },
      { name: "c", days: 3, unit: "盒" },
      { name: "d", days: 2, unit: "袋" },
      { name: "e", days: 6, unit: "个" },
      { name: "f", days: 4, unit: "卷" },
    ],
    fridgeMissing: [],
  });
  assert.deepEqual(report.runningOut.map((row) => row.name), ["b", "d", "c", "f", "a"]);
});

const EMPTY = {
  now: NOW, items: [], locationCount: 0, expiring: [], runningOut: [], fridgeMissing: [],
};

test("一句话结论按严重程度挑选", () => {
  assert.match(reportHeadline(buildHouseholdReport({ ...EMPTY, expiring: [{ name: "x", days: -1 }] })), /已经过期/);
  assert.match(reportHeadline(buildHouseholdReport({ ...EMPTY, expiring: [{ name: "x", days: 5 }] })), /30 天内到期/);
  assert.match(reportHeadline(buildHouseholdReport({ ...EMPTY, runningOut: [{ name: "抽纸", days: 2, unit: "包" }] })), /最急的是「抽纸」/);
  assert.match(reportHeadline(buildHouseholdReport({ ...EMPTY, fridgeMissing: ["酸奶"] })), /该冷藏/);
  assert.equal(reportHeadline(buildHouseholdReport({ ...EMPTY })), "库存状态良好,暂时没有需要特别处理的事");
});

test("结论句说的是真实件数,不是列表截断后的条数", () => {
  // 起因:列表为了排版只留最急的 8 条,而结论句直接数了这个列表。
  // 实测库里 311 件已过期时,月报顶部写着「有 8 件已经过期」—— 差了 39 倍。
  const expiring = [
    ...Array.from({ length: 311 }, (_, index) => ({ name: `过期${index}`, days: -index - 1 })),
    // 临期的都落在 30 天窗口内(窗口是 days <= 30)
    ...Array.from({ length: 206 }, (_, index) => ({ name: `临期${index}`, days: (index % 30) + 1 })),
  ];
  const report = buildHouseholdReport({ ...EMPTY, expiring });

  assert.equal(report.expiring.length, 8, "列表仍然只放最急的 8 条");
  assert.deepEqual(report.expiringTotals, { all: 517, expired: 311, soon: 206 });
  assert.match(reportHeadline(report), /有 311 件已经过期/);
  assert.doesNotMatch(reportHeadline(report), /有 8 件/, "不能把截断后的条数当总数说");

  // 只有临期、没有过期时也要说真数
  const soonOnly = buildHouseholdReport({ ...EMPTY, expiring: Array.from({ length: 40 }, (_, index) => ({ name: `临期${index}`, days: (index % 30) + 1 })) });
  assert.equal(soonOnly.expiringTotals.expired, 0);
  assert.match(reportHeadline(soonOnly), /40 件在 30 天内到期/);

  // 窗口外的不算数:200 天以后才到期的东西不该被算进来
  const outside = buildHouseholdReport({ ...EMPTY, expiring: [{ name: "很远", days: 200 }, { name: "边界内", days: 30 }] });
  assert.deepEqual(outside.expiringTotals, { all: 1, expired: 0, soon: 1 });
});