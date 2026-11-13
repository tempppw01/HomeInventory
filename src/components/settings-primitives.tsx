"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";

// 设置页的统一语言。之前 7 个面板由 5 个文件拼出来:有的自带 `.surface rounded-3xl` 卡片、
// 有的用 `<details>` 折叠、有的标题是 h3 有的是 div、行高与图标块尺寸也各不相同,一眼看上去
// 像好几个应用拼在一起。这里把「一块设置」和「一行设置」收敛成唯一实现:
//   SettingsSection = 折叠区块(图标 + 标题 + 一行当前状态 + 箭头)
//   SettingsRow     = 区块里的一行(可选图标 + 标题/说明 + 右侧控件)
// 面板组件只负责内容与状态摘要,不再自己写卡片与标题样式。

export function SettingsSection({ icon: Icon, title, summary, badge, children, defaultOpen = false, id }: {
  icon: LucideIcon;
  title: string;
  /** 折叠状态下也要能读懂:一行当前状态,例:「低库存提醒 开 · 保质期提前 7 天」 */
  summary?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  id?: string;
}) {
  return (
    <details id={id} open={defaultOpen} className="surface group rounded-3xl p-5">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl [&::-webkit-details-marker]:hidden">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
          <Icon size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black">{title}</span>
          {summary !== undefined && summary !== null && summary !== "" && <span className="mt-1 block truncate text-xs muted">{summary}</span>}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {badge}
          <ChevronDown size={17} className="shrink-0 muted transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--hairline)" }}>{children}</div>
    </details>
  );
}

export function SettingsRow({ icon: Icon, title, description, control, stacked = false, onActivate }: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  /** 控件需要整行宽度时(例如多行文本框)用 stacked。 */
  stacked?: boolean;
  /** 布尔行的便利:点行内空白处等同点开关(点控件本身不会触发两次,键盘仍走开关)。 */
  onActivate?: () => void;
}) {
  const activate = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onActivate) return;
    if ((event.target as HTMLElement).closest("button, select, input, textarea, a, summary")) return;
    onActivate();
  };
  return (
    <div
      onClick={onActivate ? activate : undefined}
      className={`flex gap-3 border-t py-3 first:border-t-0 first:pt-0 ${stacked ? "flex-col items-stretch" : "min-h-14 items-center"} ${onActivate ? "cursor-pointer" : ""}`}
      style={{ borderColor: "var(--hairline)" }}
    >
      <div className={`flex min-w-0 flex-1 items-center gap-3 ${stacked ? "" : ""}`}>
        {Icon && (
          <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: "var(--surface-soft)", color: "var(--muted)" }}>
            <Icon size={16} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{title}</span>
          {description && <span className="mt-0.5 block text-xs leading-5 muted">{description}</span>}
        </span>
      </div>
      {control && <div className={`flex shrink-0 items-center gap-2 ${stacked ? "w-full" : ""}`}>{control}</div>}
    </div>
  );
}

export function SettingsSelect<T extends string>({ value, onChange, options, ariaLabel, disabled = false, className = "", id }: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  /** 需要跟 <label htmlFor> 关联时传。 */
  id?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`input w-auto min-w-32 py-0 text-sm ${className}`.trim()}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
    </select>
  );
}

export function SettingsSwitch({ checked, onChange, label, disabled = false }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 读屏与 aria 用,例:「低库存提醒」 */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex h-11 min-h-11 shrink-0 items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors"
        style={{ background: checked ? "var(--primary)" : "color-mix(in srgb, var(--muted) 32%, transparent)" }}
      >
        <span
          className="absolute top-1/2 size-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-[left]"
          style={{ left: checked ? "1.55rem" : "0.15rem" }}
        />
      </span>
      <span className="w-6 text-left text-xs font-bold" style={{ color: checked ? "var(--primary)" : "var(--muted)" }}>{checked ? "开" : "关"}</span>
    </button>
  );
}

/** 区块底部的操作行:统一按钮尺寸与间距。 */
export function SettingsActions({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: "var(--hairline)" }}>{children}</div>;
}

/** 状态徽标:折叠标题右侧的小胶囊,统一尺寸与色板。 */
export function SettingsBadge({ tone = "muted", children }: { tone?: "muted" | "success" | "warning" | "primary"; children: ReactNode }) {
  const palette: Record<string, { background: string; color: string }> = {
    muted: { background: "var(--surface-soft)", color: "var(--muted)" },
    success: { background: "var(--success-soft)", color: "var(--success)" },
    warning: { background: "var(--warning-soft, #fff4dc)", color: "var(--warning)" },
    primary: { background: "var(--primary-soft)", color: "var(--primary)" },
  };
  return <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold" style={palette[tone]}>{children}</span>;
}
