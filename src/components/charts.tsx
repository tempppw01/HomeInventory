"use client";

// 图表组件 —— 手写 SVG,不引入图表库(体积与维护成本都不划算,而且这几个图形很基础)。
//
// 无障碍:每张图都带 role="img" + aria-label 概述,关键数值同时以文本列出,
// 读屏用户不会因为「图里只有颜色和高度」而拿不到信息。

import { barLayout, formatCompact, niceMax, sharesOf, ticksFor, type SeriesPoint } from "@/lib/chart";

/** 按月支出的柱状图。 */
export function MonthlyBars({
  points,
  height = 120,
  ariaLabel,
  valueFormatter = formatCompact,
}: {
  points: readonly SeriesPoint[];
  height?: number;
  ariaLabel: string;
  valueFormatter?: (value: number) => string;
}) {
  if (!points.length) return null;
  const width = 100; // 用 viewBox 百分比坐标,自动适配容器宽度
  const values = points.map((point) => point.value);
  const rects = barLayout(values, width, height, 0.34);
  const top = niceMax(Math.max(...values));
  const gridLines = ticksFor(Math.max(...values), 3);
  const maxIndex = values.indexOf(Math.max(...values));
  const summary = points.map((point) => `${point.label} ${valueFormatter(point.value)}`).join(",");

  return (
    <figure className="m-0" role="img" aria-label={`${ariaLabel}。${summary}`}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden className="block">
        {gridLines.map((tick) => {
          const y = height - (tick / top) * height;
          return <line key={tick} x1={0} x2={width} y1={y} y2={y} stroke="var(--hairline)" strokeWidth={0.4} />;
        })}
        {rects.map((rect, index) => (
          <rect
            key={points[index].label}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            rx={1.2}
            fill={index === maxIndex ? "var(--primary)" : "color-mix(in srgb, var(--primary) 45%, transparent)"}
          />
        ))}
      </svg>
      <div className="mt-1.5 flex justify-between text-[10px] muted">
        {points.map((point, index) => (
          <span key={point.label} className={index === maxIndex ? "font-bold" : ""}>{point.label}</span>
        ))}
      </div>
    </figure>
  );
}

/** 横向排行条:消耗最多 / 分类占比这类「比大小」用横向更易读。 */
export function RankBars({
  rows,
  ariaLabel,
  valueFormatter = (value: number) => String(value),
  tone = "primary",
}: {
  rows: ReadonlyArray<{ label: string; value: number; hint?: string }>;
  ariaLabel: string;
  valueFormatter?: (value: number) => string;
  tone?: "primary" | "warning";
}) {
  if (!rows.length) return null;
  const shares = sharesOf(rows.map((row) => row.value));

  return (
    <ul className="m-0 list-none space-y-2 p-0" aria-label={ariaLabel}>
      {rows.map((row, index) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-bold">{row.label}</span>
            <span className="shrink-0 tabular-nums muted">
              {valueFormatter(row.value)}
              {row.hint ? <span className="ml-1">· {row.hint}</span> : null}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--surface-soft)" }}>
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.max(shares[index] * 100, row.value > 0 ? 3 : 0)}%`,
                background: tone === "warning" ? "var(--warning)" : "var(--primary)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 占比条 + 图例:一眼看出「钱花在哪」。 */
export function ShareBar({
  rows,
  ariaLabel,
  valueFormatter = formatCompact,
}: {
  rows: ReadonlyArray<{ label: string; value: number }>;
  ariaLabel: string;
  valueFormatter?: (value: number) => string;
}) {
  if (!rows.length) return null;
  const shares = sharesOf(rows.map((row) => row.value));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const palette = ["var(--primary)", "var(--warning)", "var(--success)", "var(--danger)"];
  const summary = rows.map((row) => `${row.label} ${valueFormatter(row.value)}`).join(",");

  return (
    <div role="img" aria-label={`${ariaLabel}。${summary}`}>
      <div className="flex h-2.5 overflow-hidden rounded-full" style={{ background: "var(--surface-soft)" }}>
        {rows.map((row, index) => (
          <div key={row.label} style={{ width: `${shares[index] * 100}%`, background: palette[index % palette.length] }} />
        ))}
      </div>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[11px] muted">
        {rows.map((row, index) => (
          <li key={row.label} className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-sm" style={{ background: palette[index % palette.length] }} aria-hidden />
            <span className="font-bold">{row.label}</span>
            <span className="tabular-nums">
              {valueFormatter(row.value)}
              {total > 0 ? ` · ${Math.round(shares[index] * 100)}%` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}