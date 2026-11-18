// 图表计算 —— 纯函数,零依赖。
//
// 刻意不自造一套图形库、也不引第三方(体积与维护成本都不划算):
// 这里只算「刻度、坐标、占比」这些数字,<svg> 由组件画,便于单测与无障碍处理。

export type SeriesPoint = { label: string; value: number; key?: string };

/** 取一个「好看」的坐标上限:1/2/5 × 10^n,并留出一点头部空间。 */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** 均分刻度值(含 0),用于画网格线与标签。 */
export function ticksFor(max: number, count = 4): number[] {
  const top = niceMax(max);
  return Array.from({ length: count + 1 }, (_, index) => (top / count) * index);
}

export type BarRect = { x: number; y: number; width: number; height: number; ratio: number };

/**
 * 柱状图的矩形布局。
 * 返回的坐标以左下角为原点之外的标准 SVG 坐标(y 向下),
 * height 为 0 的值也给一个 1px 的最小高度 —— 否则「有数据但很小」看起来像没有。
 */
export function barLayout(values: readonly number[], width: number, height: number, gapRatio = 0.35): BarRect[] {
  if (!values.length || width <= 0 || height <= 0) return [];
  const max = niceMax(Math.max(...values));
  const slot = width / values.length;
  const barWidth = Math.max(1, slot * (1 - gapRatio));
  return values.map((value, index) => {
    const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    const barHeight = value > 0 ? Math.max(2, ratio * height) : 0;
    return {
      x: index * slot + (slot - barWidth) / 2,
      y: height - barHeight,
      width: barWidth,
      height: barHeight,
      ratio,
    };
  });
}

/** 折线图的点坐标(用于趋势线/迷你折线)。 */
export function pointLayout(values: readonly number[], width: number, height: number): Array<{ x: number; y: number; ratio: number }> {
  if (!values.length) return [];
  const max = niceMax(Math.max(...values));
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((value, index) => {
    const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    return { x: index * stepX, y: height - ratio * height, ratio };
  });
}

/** 占比(0~1),总和为 0 时全部返回 0,避免除零得到 NaN。 */
export function sharesOf(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return values.map(() => 0);
  return values.map((value) => Math.max(0, value) / total);
}

/** 金额简写:1200 → 1.2k,方便放在坐标轴与柱顶。 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 10000) return `${(value / 10000).toFixed(abs >= 100000 ? 0 : 1)}万`;
  if (abs >= 1000) return `${(value / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

export type MonthlyBucket = { month: string; label: string; total: number };

/**
 * 把消费记录按月归集,补齐没有记录的月份(补 0 而不是跳过 —— 跳过会让趋势看起来连续)。
 * month 用 YYYY-MM,label 用「M 月」。
 */
export function monthlyBuckets(
  records: ReadonlyArray<{ purchasedAt: string | Date; totalPrice: number }>,
  now: Date,
  months = 6,
): MonthlyBucket[] {
  const buckets: MonthlyBucket[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    buckets.push({
      month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: `${date.getMonth() + 1} 月`,
      total: 0,
    });
  }
  const index = new Map(buckets.map((bucket) => [bucket.month, bucket]));

  for (const record of records) {
    const date = new Date(record.purchasedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = index.get(key);
    if (bucket) bucket.total = Number((bucket.total + Math.max(0, record.totalPrice)).toFixed(2));
  }

  return buckets;
}

/**
 * 环比显示文案。上月为 0 时返回 null(而不是无穷大);变化超过 1000% 时只说「多很多」——
 * 「比上月多 10644%」既看不懂也不可信(通常是某个月偶发大额采购)。
 */
export function monthOverMonthLabel(buckets: readonly MonthlyBucket[]): { text: string; tone: "up" | "down" | "flat" } | null {
  const percent = monthOverMonth(buckets);
  if (percent === null) return null;
  if (percent === 0) return { text: "与上月持平", tone: "flat" };
  if (Math.abs(percent) >= 1000) return { text: percent > 0 ? "比上月多很多" : "比上月少很多", tone: percent > 0 ? "up" : "down" };
  return { text: percent > 0 ? `比上月多 ${percent}%` : `比上月少 ${Math.abs(percent)}%`, tone: percent > 0 ? "up" : "down" };
}

/** 环比:本月相对上月的变化,上月为 0 时返回 null(而不是无穷大)。 */
export function monthOverMonth(buckets: readonly MonthlyBucket[]): number | null {
  if (buckets.length < 2) return null;
  const current = buckets[buckets.length - 1].total;
  const previous = buckets[buckets.length - 2].total;
  if (previous <= 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(0));
}