// 家庭月报 —— 把散落在各处的结论汇总成一页纸。
import { isLowStock } from "@/lib/low-stock";
//
// 盘点结果、支出预测、冰箱清单、AI 建议平时分散在不同面板里,
// 想给家人看一眼「这个家现在什么状况」时没有现成的出口。
// 本模块零依赖:预测类结果由调用方(页面)用既有模块算好后传入,
// 这里只负责汇总、排序与文案,便于单测。
//
// 渲染在 /report 页面,可直接打印或存成 PDF。

export type ReportCounts = { total: number; consumable: number; durable: number };

export type ReportInput = {
  now: Date;
  items: ReadonlyArray<{
    name: string;
    type: "DURABLE" | "CONSUMABLE";
    quantity: number;
    unit: string;
    price: number | null;
    consumeRate: number | null;
    minQuantity: number;
    // 「该补货」判定需要的字段
    category: string;
    remainingPercent: number;
    restockPausedUntil?: Date | string | null;
  }>;
  locationCount: number;
  /** 每一项:{ 名称, 还有几天到期(负数=已过期) } —— 由页面按有效期算好 */
  expiring: ReadonlyArray<{ name: string; days: number }>;
  /** 按用量快用完的 —— 由 item-forecast 算好 */
  runningOut: ReadonlyArray<{ name: string; days: number; unit: string }>;
  /** 该冷藏但还没放好的名字 —— 由 fridge 规则算好 */
  fridgeMissing: ReadonlyArray<string>;
};

export type HouseholdReport = {
  generatedAt: string;
  monthLabel: string;
  counts: ReportCounts & { locations: number };
  value: number;
  monthlySpend: number;
  expiring: Array<{ name: string; days: number; expired: boolean }>;
  runningOut: Array<{ name: string; days: number; unit: string }>;
  fridgeMissing: string[];
  lowStock: string[];
};

/** 把当月(按本地时区)格式化成「2026 年 11 月」。 */
export function monthLabelFor(date: Date) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

export function buildHouseholdReport(input: ReportInput): HouseholdReport {
  const counts: ReportCounts = {
    total: input.items.length,
    consumable: input.items.filter((item) => item.type === "CONSUMABLE").length,
    durable: input.items.filter((item) => item.type === "DURABLE").length,
  };

  let value = 0;
  let monthlySpend = 0;
  const lowStock: string[] = [];
  for (const item of input.items) {
    value += (item.price ?? 0) * item.quantity;
    const rate = item.consumeRate ?? 0;
    if (item.type === "CONSUMABLE" && rate >= 0.1 && (item.price ?? 0) > 0) monthlySpend += rate * 30 * (item.price ?? 0);
    if (isLowStock(item)) lowStock.push(item.name);
  }

  const expiring = [...input.expiring]
    .filter((row) => row.days <= 30)
    .sort((left, right) => left.days - right.days)
    .slice(0, 8)
    .map((row) => ({ ...row, expired: row.days < 0 }));

  return {
    generatedAt: input.now.toISOString(),
    monthLabel: monthLabelFor(input.now),
    counts: { ...counts, locations: input.locationCount },
    value: Number(value.toFixed(2)),
    monthlySpend: Number(monthlySpend.toFixed(2)),
    expiring,
    runningOut: [...input.runningOut].sort((left, right) => left.days - right.days).slice(0, 5),
    fridgeMissing: input.fridgeMissing.slice(0, 6),
    lowStock: lowStock.slice(0, 6),
  };
}

/** 报告顶部的「一句话结论」:挑最要紧的一条说。 */
export function reportHeadline(report: HouseholdReport) {
  const expired = report.expiring.filter((row) => row.expired);
  if (expired.length) return `有 ${expired.length} 件已经过期,建议先处理掉`;
  if (report.expiring.length) return `${report.expiring.length} 件在 30 天内到期,注意先用`;
  if (report.runningOut.length) return `最急的是「${report.runningOut[0].name}」,大约 ${Math.max(0, report.runningOut[0].days)} 天后用完`;
  if (report.fridgeMissing.length) return `有 ${report.fridgeMissing.length} 件该冷藏的物品还没放好`;
  return "库存状态良好,暂时没有需要特别处理的事";
}