// 家庭月报 —— 把散落在各处的结论汇总成一页纸。
import { isLowStock } from "@/lib/low-stock";
import { inDaysPhrase } from "@/lib/expiry-status";
import { isWithinExpiryWindowDays } from "@/lib/expiry-status";
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
  /**
   * 要到期/已过期的**真实件数**(不受下面列表截断影响)。
   *
   * 起因:列表为了排版只留最急的 8 条,而顶部的结论句直接数了这个列表 ——
   * 于是 311 件过期会说成「有 8 件已经过期」,差了 39 倍。
   * 结论句必须说真数,列表只管显示。
   */
  expiringTotals: { all: number; expired: number; soon: number };
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

  // 先按窗口过滤出**全部**要到期 / 已过期的,数清楚再决定列表里放哪几条。
  const withinWindow = input.expiring
    .filter((row) => isWithinExpiryWindowDays(row.days))
    .sort((left, right) => left.days - right.days);
  const expiringTotals = {
    all: withinWindow.length,
    expired: withinWindow.filter((row) => row.days < 0).length,
    soon: withinWindow.filter((row) => row.days >= 0).length,
  };
  const expiring = withinWindow
    .slice(0, 8)
    .map((row) => ({ ...row, expired: row.days < 0 }));

  return {
    generatedAt: input.now.toISOString(),
    monthLabel: monthLabelFor(input.now),
    counts: { ...counts, locations: input.locationCount },
    value: Number(value.toFixed(2)),
    monthlySpend: Number(monthlySpend.toFixed(2)),
    expiring,
    expiringTotals,
    runningOut: [...input.runningOut].sort((left, right) => left.days - right.days).slice(0, 5),
    fridgeMissing: input.fridgeMissing.slice(0, 6),
    lowStock: lowStock.slice(0, 6),
  };
}

/** 报告顶部的「一句话结论」:挑最要紧的一条说。数字用真实件数,不数截断后的列表。 */
export function reportHeadline(report: HouseholdReport) {
  const { expired, soon } = report.expiringTotals;
  if (expired) return `有 ${expired} 件已经过期,建议先处理掉`;
  if (soon) return `${soon} 件在 30 天内到期,注意先用`;
  if (report.runningOut.length) return `最急的是「${report.runningOut[0].name}」,${inDaysPhrase(report.runningOut[0].days, "用完", true)}`;
  if (report.fridgeMissing.length) return `有 ${report.fridgeMissing.length} 件该冷藏的物品还没放好`;
  return "库存状态良好,暂时没有需要特别处理的事";
}