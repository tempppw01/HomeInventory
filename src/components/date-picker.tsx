"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
} from "lucide-react";
import { useEscapeClose } from "@/lib/use-escape-close";

export type DatePickerPreset = { label: string; days: number };

// ---------------------------------------------------------------- pure helpers
// Everything below is module scope on purpose: the component only wires state to
// these, so the calendar maths stays testable without a browser.

const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"] as const;
const WEEKDAY_ORDER = ["一", "二", "三", "四", "五", "六", "日"] as const;
const MONTH_LABELS = ["1 月", "2 月", "3 月", "4 月", "5 月", "6 月", "7 月", "8 月", "9 月", "10 月", "11 月", "12 月"] as const;

const pad2 = (value: number) => (value < 10 ? `0${value}` : String(value));

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const keyOf = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** Month shift that keeps the day-of-month inside the target month (Jan 31 +1 → Feb 28). */
const addMonths = (date: Date, months: number) => {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
};

/** Day ordinal in UTC so DST shifts can never move a date by one. */
const ordinalOf = (date: Date) => Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);

/** Monday-first weekday index (Mon=0 … Sun=6). */
const mondayIndex = (date: Date) => (date.getDay() + 6) % 7;

const parseKey = (value: string | undefined | null): Date | null => {
  if (!value) return null;
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
};

const withinRange = (date: Date, min: Date | null, max: Date | null) => {
  const value = ordinalOf(date);
  if (min && value < ordinalOf(min)) return false;
  if (max && value > ordinalOf(max)) return false;
  return true;
};

const clampToRange = (date: Date, min: Date | null, max: Date | null) => {
  if (min && ordinalOf(date) < ordinalOf(min)) return startOfDay(min);
  if (max && ordinalOf(date) > ordinalOf(max)) return startOfDay(max);
  return startOfDay(date);
};

type ParsedInput = { date: Date } | { error: string };

/** Accepts 2026-3-15, 2026/03/15, 2026.3.15, 2026年3月15日 and 3月15日 (current year). */
const parseTypedDate = (raw: string, fallbackYear: number): ParsedInput => {
  // Full-width digits are common on Chinese IMEs; normalise before matching.
  const text = raw.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\s+/g, "");
  if (!text) return { error: "请输入日期,例如 2026-03-15" };
  const full = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(text);
  const short = /^(\d{1,2})[-/.月](\d{1,2})日?$/.exec(text);
  let year = fallbackYear;
  let monthText: string;
  let dayText: string;
  if (full) {
    year = Number(full[1]);
    monthText = full[2];
    dayText = full[3];
  } else if (short) {
    monthText = short[1];
    dayText = short[2];
  } else {
    return { error: "日期格式像 2026-03-15,也可以写 3 月 15 日" };
  }
  if (year < 1900 || year > 2999) return { error: "年份需要在 1900 到 2999 之间" };
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12) return { error: `没有 ${month} 月 ${day} 日这一天` };
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return { error: `没有 ${month} 月 ${day} 日这一天` };
  return { date: new Date(year, month - 1, day) };
};

/** 今天 / 昨天 / 3 月 15 日 周六 / 2027 年 1 月 3 日 */
const formatTrigger = (date: Date, today: Date) => {
  const diff = ordinalOf(date) - ordinalOf(today);
  if (diff === 0) return "今天";
  if (diff === -1) return "昨天";
  const weekday = `周${WEEKDAY_SHORT[date.getDay()]}`;
  if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${weekday}`;
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
};

/** 还有 N 天 / 今天 / 已过期 N 天, plus the tone the spec asks for. */
const relativeOf = (date: Date, today: Date) => {
  const diff = ordinalOf(date) - ordinalOf(today);
  const text = diff === 0 ? "今天" : diff > 0 ? `还有 ${diff} 天` : `已过期 ${-diff} 天`;
  const tone = diff < 0 ? "var(--danger)" : diff <= 7 ? "var(--warning)" : "var(--muted)";
  return { text, tone, diff };
};

const focusableIn = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])")]
    .filter((element) => element.getClientRects().length > 0);

// ------------------------------------------------------------------- component

export function DatePicker({
  value,
  onChange,
  label,
  placeholder = "未设置",
  presets,
  min,
  max,
  hint = "relative",
  clearable = false,
  disabled = false,
  className,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  presets?: DatePickerPreset[];
  min?: string;
  max?: string;
  hint?: "relative" | "none";
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{ left: number; top: number; above: boolean; drawer: boolean } | null>(null);
  const [mode, setMode] = useState<"days" | "months" | "years">("days");
  const [viewMonth, setViewMonth] = useState(() => startOfDay(new Date()));
  const [focusKey, setFocusKey] = useState(() => keyOf(startOfDay(new Date())));
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const generatedId = useId();
  const panelId = `${id ?? generatedId}-panel`;

  const today = startOfDay(new Date());
  const todayKey = keyOf(today);
  const selected = parseKey(value);
  const minDate = parseKey(min);
  const maxDate = parseKey(max);
  const panelTitle = label ?? "选择日期";

  const closePanel = () => setOpen(false);

  // Escape is registered on a stack: while the panel is open it is the top entry,
  // so it closes alone instead of also closing the surrounding 录入新物品 modal.
  useEscapeClose(closePanel, open);

  // ------------------------------------------------------------------ effects
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const sync = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const panel = panelRef.current;
        const trigger = triggerRef.current;
        if (!panel) return;
        const drawer = window.matchMedia("(max-width: 639px)").matches;
        if (drawer || !trigger) {
          setPlacement({ left: 0, top: 0, above: false, drawer });
          return;
        }
        // Measure the panel itself: flipping and clamping need its real height.
        const rect = trigger.getBoundingClientRect();
        const size = panel.getBoundingClientRect();
        const gap = 8;
        const fitsBelow = rect.bottom + gap + size.height <= window.innerHeight - gap;
        const above = !fitsBelow && rect.top - gap - size.height >= gap;
        const top = above
          ? rect.top - gap - size.height
          : Math.min(rect.bottom + gap, Math.max(gap, window.innerHeight - size.height - gap));
        setPlacement({
          left: Math.max(gap, Math.min(rect.left, window.innerWidth - size.width - gap)),
          top: Math.max(gap, top),
          above,
          drawer: false,
        });
      });
    };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [open]);

  // Roving focus: only the focused day is tabbable, and it is focused after the
  // panel has been placed (focusing a display:none/hidden node would no-op).
  useEffect(() => {
    if (!open || !placement || mode !== "days") return;
    const cell = panelRef.current?.querySelector<HTMLElement>(`[data-date="${focusKey}"]`);
    if (cell && document.activeElement !== cell) cell.focus({ preventScroll: true });
  }, [open, placement, mode, focusKey]);

  // Outside pointerdown closes, but never when the click belongs to trigger/panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  // Closing always hands focus back to the trigger.
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const frame = requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // -------------------------------------------------------------------- grid
  // Recomputed per render on purpose: 42 cells is cheaper than a memo the React
  // Compiler cannot verify (`viewMonth` is a mutable Date value).
  const gridMin = parseKey(min);
  const gridMax = parseKey(max);
  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const gridStart = addDays(monthStart, -mondayIndex(monthStart));
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);
    return {
      key: keyOf(date),
      date,
      inMonth: date.getMonth() === viewMonth.getMonth(),
      isToday: keyOf(date) === todayKey,
      outOfRange: !withinRange(date, gridMin, gridMax),
    };
  });

  const monthHasSelectable = (year: number, monthIndex: number) => {
    const first = new Date(year, monthIndex, 1);
    const last = new Date(year, monthIndex + 1, 0);
    return withinRange(first, minDate, maxDate) || withinRange(last, minDate, maxDate);
  };

  const yearHasSelectable = (year: number) => MONTH_LABELS.some((_, index) => monthHasSelectable(year, index));

  const yearBase = viewMonth.getFullYear() - (((viewMonth.getFullYear() % 12) + 12) % 12);
  const years = Array.from({ length: 12 }, (_, index) => yearBase + index);
  // Drill-down: 日 → 月 → 年, then the title walks back out one level.
  const modeOrder: Record<"days" | "months" | "years", "days" | "months" | "years"> = { days: "months", months: "years", years: "months" };
  const titleLabel = mode === "days" ? "选择年月" : mode === "months" ? "选择年份" : "返回月份";

  // ---------------------------------------------------------------- behaviour
  const openPanel = () => {
    if (disabled) return;
    const base = clampToRange(selected ?? today, minDate, maxDate);
    setViewMonth(new Date(base.getFullYear(), base.getMonth(), 1));
    setFocusKey(keyOf(base));
    setMode("days");
    setText(selected ? keyOf(selected) : "");
    setError("");
    setPlacement(null);
    setOpen(true);
  };

  const selectDate = (key: string) => {
    onChange(key);
    closePanel();
  };

  /** Keyboard movement stays inside [min, max] so the roving cell is always enabled. */
  const moveFocusTo = (candidate: Date) => {
    const next = clampToRange(candidate, minDate, maxDate);
    const key = keyOf(next);
    if (key !== focusKey) setFocusKey(key);
    setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  };

  const shiftMonth = (delta: number) => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  const shiftYear = (delta: number) => setViewMonth((current) => new Date(current.getFullYear() + delta, current.getMonth(), 1));

  const pickMonth = (year: number, monthIndex: number) => {
    const current = parseKey(focusKey) ?? today;
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    const next = clampToRange(new Date(year, monthIndex, Math.min(current.getDate(), lastDay)), minDate, maxDate);
    setFocusKey(keyOf(next));
    setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    setMode("days");
  };

  const applyText = () => {
    const parsed = parseTypedDate(text, today.getFullYear());
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    if (!withinRange(parsed.date, minDate, maxDate)) {
      const bounds = [min, max].filter(Boolean).join(" 至 ");
      setError(`日期需在 ${bounds} 之间`);
      return;
    }
    selectDate(keyOf(parsed.date));
  };

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      const root = panelRef.current;
      if (!root) return;
      const items = focusableIn(root);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !root.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    // Escape intentionally falls through to useEscapeClose's window listener.
    if (mode !== "days") return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input, textarea, select")) return;
    const current = parseKey(focusKey) ?? today;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        moveFocusTo(addDays(current, -1));
        return;
      case "ArrowRight":
        event.preventDefault();
        moveFocusTo(addDays(current, 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        moveFocusTo(addDays(current, -7));
        return;
      case "ArrowDown":
        event.preventDefault();
        moveFocusTo(addDays(current, 7));
        return;
      case "PageUp":
        event.preventDefault();
        moveFocusTo(addMonths(current, -1));
        return;
      case "PageDown":
        event.preventDefault();
        moveFocusTo(addMonths(current, 1));
        return;
      case "Home":
        event.preventDefault();
        moveFocusTo(addDays(current, -mondayIndex(current)));
        return;
      case "End":
        event.preventDefault();
        moveFocusTo(addDays(current, 6 - mondayIndex(current)));
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (withinRange(current, minDate, maxDate)) selectDate(focusKey);
        return;
      default:
        return;
    }
  };

  // -------------------------------------------------------------------- views
  const displayText = selected ? formatTrigger(selected, today) : placeholder;
  const relative = selected ? relativeOf(selected, today) : null;
  const showHint = hint === "relative" && relative !== null && relative.text !== displayText;

  const cellStyle = (cell: (typeof cells)[number]): CSSProperties => {
    const style: CSSProperties = {};
    if (cell.key === focusKey && mode === "days") style.color = cell.inMonth ? "var(--foreground)" : "var(--muted)";
    if (selected && cell.key === keyOf(selected)) {
      style.background = "var(--primary)";
      style.color = "var(--on-primary)";
      style.boxShadow = cell.isToday
        ? "inset 0 0 0 2px color-mix(in srgb, var(--on-primary) 70%, transparent), 0 6px 16px color-mix(in srgb, var(--primary) 28%, transparent)"
        : "0 6px 16px color-mix(in srgb, var(--primary) 28%, transparent)";
    } else if (cell.isToday) {
      style.boxShadow = "inset 0 0 0 2px var(--primary)";
      style.color = "var(--primary)";
    }
    if (cell.outOfRange) style.opacity = 0.35;
    else if (!cell.inMonth) style.opacity = 0.55;
    return style;
  };

  const chipClass =
    "min-h-11 rounded-full border px-3.5 text-xs font-bold transition-colors sm:min-h-10 disabled:cursor-not-allowed disabled:opacity-40";
  const navClass =
    "grid size-11 place-items-center rounded-full transition-colors hover:bg-[var(--surface-soft)] sm:size-10";

  const panel = open ? (
    <div
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-label={panelTitle}
      data-date-picker={panelTitle}
      data-drawer={placement?.drawer ? "true" : "false"}
      data-placement={placement?.above ? "above" : "below"}
      tabIndex={-1}
      onKeyDown={onPanelKeyDown}
      className={
        placement?.drawer
          ? "fixed inset-x-0 bottom-0 z-[130] w-full rounded-t-[28px] border p-3 shadow-2xl"
          : "fixed z-[130] w-[336px] rounded-[24px] border p-3 shadow-2xl"
      }
      style={{
        zIndex: 130,
        background: "var(--surface-solid)",
        borderColor: "var(--hairline)",
        visibility: placement ? "visible" : "hidden",
        ...(placement && !placement.drawer ? { left: placement.left, top: placement.top } : {}),
        ...(placement?.drawer ? { paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" } : {}),
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          {label && <div className="truncate text-xs font-black muted">{label}</div>}
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-black" data-date-trigger-text>
              {displayText}
            </span>
            {showHint && relative && (
              <span className="shrink-0 text-xs font-bold" style={{ color: relative.tone }} data-relative={relative.text}>
                {relative.text}
              </span>
            )}
          </div>
        </div>
        <button type="button" onClick={closePanel} className="grid size-11 place-items-center rounded-full muted sm:size-10" aria-label="关闭日期选择">
          <X size={15} />
        </button>
      </div>

      <div className="mb-2 flex items-center justify-between gap-1">
        <button type="button" className={navClass} aria-label="上一年" onClick={() => shiftYear(-1)}>
          <ChevronsLeft size={16} />
        </button>
        <button type="button" className={navClass} aria-label="上一月" onClick={() => shiftMonth(-1)}>
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="min-h-11 flex-1 rounded-[14px] px-2 text-sm font-black transition-colors hover:bg-[var(--surface-soft)] sm:min-h-10"
          aria-label={titleLabel}
          data-mode={mode}
          onClick={() => setMode(modeOrder[mode])}
        >
          {mode === "days"
            ? `${viewMonth.getFullYear()} 年 ${viewMonth.getMonth() + 1} 月`
            : mode === "months"
              ? `${viewMonth.getFullYear()} 年`
              : `${years[0]} - ${years[years.length - 1]} 年`}
        </button>
        <button type="button" className={navClass} aria-label="下一月" onClick={() => shiftMonth(1)}>
          <ChevronRight size={16} />
        </button>
        <button type="button" className={navClass} aria-label="下一年" onClick={() => shiftYear(1)}>
          <ChevronsRight size={16} />
        </button>
      </div>

      {mode === "days" ? (
        <>
          <div className="grid grid-cols-7 gap-x-1 px-0.5 pb-1" aria-hidden="true">
            {WEEKDAY_ORDER.map((day) => (
              <span key={day} className="grid place-items-center py-0.5 text-xs font-bold muted">
                {day}
              </span>
            ))}
          </div>
          <div role="grid" aria-label={`${viewMonth.getFullYear()} 年 ${viewMonth.getMonth() + 1} 月日历`}>
            {Array.from({ length: 6 }, (_, row) => (
              <div role="row" key={row} className="grid grid-cols-7 gap-x-1 gap-y-1.5 py-0.5">
                {cells.slice(row * 7, row * 7 + 7).map((cell) => {
                  const isSelected = !!selected && cell.key === keyOf(selected);
                  return (
                    <button
                      key={cell.key}
                      type="button"
                      role="gridcell"
                      data-date={cell.key}
                      data-today={cell.isToday ? "true" : undefined}
                      data-out-of-range={cell.outOfRange ? "true" : undefined}
                      aria-label={`${cell.date.getFullYear()} 年 ${cell.date.getMonth() + 1} 月 ${cell.date.getDate()} 日 周${WEEKDAY_SHORT[cell.date.getDay()]}`}
                      aria-selected={isSelected ? true : undefined}
                      aria-current={cell.isToday ? "date" : undefined}
                      tabIndex={cell.key === focusKey ? 0 : -1}
                      disabled={cell.outOfRange}
                      onClick={() => selectDate(cell.key)}
                      className="grid aspect-square w-full min-h-11 min-w-0 place-items-center rounded-[14px] text-sm font-bold transition-colors hover:bg-[var(--surface-soft)] disabled:cursor-not-allowed sm:min-h-10"
                      style={cellStyle(cell)}
                    >
                      {cell.date.getDate()}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      ) : mode === "months" ? (
        <div className="grid grid-cols-3 gap-1.5 py-1" role="group" aria-label={`${viewMonth.getFullYear()} 年月份`}>
          {MONTH_LABELS.map((monthLabel, index) => {
            const isCurrent = index === viewMonth.getMonth();
            return (
              <button
                key={monthLabel}
                type="button"
                disabled={!monthHasSelectable(viewMonth.getFullYear(), index)}
                onClick={() => pickMonth(viewMonth.getFullYear(), index)}
                className="min-h-11 rounded-[14px] text-sm font-bold transition-colors hover:bg-[var(--surface-soft)] disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-10"
                style={isCurrent ? { background: "var(--primary)", color: "var(--on-primary)" } : undefined}
              >
                {monthLabel}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 py-1" role="group" aria-label="选择年份">
          {years.map((year) => (
            <button
              key={year}
              type="button"
              disabled={!yearHasSelectable(year)}
              onClick={() => pickMonth(year, viewMonth.getMonth())}
              className="min-h-11 rounded-[14px] text-sm font-bold transition-colors hover:bg-[var(--surface-soft)] disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-10"
              style={year === viewMonth.getFullYear() ? { background: "var(--primary)", color: "var(--on-primary)" } : undefined}
            >
              {year}
            </button>
          ))}
        </div>
      )}

      {presets && presets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((preset) => {
            const target = addDays(today, preset.days);
            return (
              <button
                key={preset.label}
                type="button"
                disabled={!withinRange(target, minDate, maxDate)}
                onClick={() => selectDate(keyOf(target))}
                className={chipClass}
                style={{ background: "var(--surface-soft)", borderColor: "var(--hairline)" }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--hairline)" }}>
        <div className="flex items-center gap-2">
          <input
            className="input min-w-0 flex-1"
            value={text}
            aria-label="手动输入日期"
            inputMode="numeric"
            autoComplete="off"
            placeholder="2026-03-15"
            onChange={(event) => {
              setText(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              applyText();
            }}
          />
          <button type="button" onClick={applyText} className="btn-ghost shrink-0 px-4 text-xs">
            应用
          </button>
        </div>
        {error && (
          <p className="mb-0 mt-1.5 text-xs font-bold" style={{ color: "var(--danger)" }} role="alert">
            {error}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!withinRange(today, minDate, maxDate)}
            onClick={() => selectDate(todayKey)}
            className={chipClass}
            style={{ background: "var(--primary-soft)", color: "var(--primary)", borderColor: "transparent" }}
          >
            今天
          </button>
          {clearable && (
            <button
              type="button"
              disabled={!value}
              onClick={() => selectDate("")}
              className={chipClass}
              style={{ background: "var(--surface-soft)", borderColor: "var(--hairline)" }}
            >
              清除
            </button>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        data-date-picker-trigger
        data-value={value}
        data-relative={relative?.text}
        onClick={() => (open ? closePanel() : openPanel())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (open) closePanel();
          else openPanel();
        }}
        className={`input flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <CalendarIcon size={16} className="shrink-0" style={{ color: "var(--muted)" }} />
          <span className="truncate text-sm font-bold" style={{ color: selected ? "var(--foreground)" : "var(--muted)" }}>
            {displayText}
          </span>
        </span>
        {showHint && relative && (
          <span className="shrink-0 text-xs font-bold" style={{ color: relative.tone }} data-relative-text>
            {relative.text}
          </span>
        )}
      </button>
      {panel && typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    </>
  );
}
