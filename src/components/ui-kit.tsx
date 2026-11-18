"use client";

import type { ButtonHTMLAttributes, HTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";

// 重构后的界面组件系统。规则(温和家居风):
// · 层级靠留白、字重和暖色面,而不是到处画边框;真正的分隔只用发丝线。
// · 卡片一律 20px 圆角 + 暖阴影,内边距走 --space 尺度。
// · 一屏只留一个主操作(btn-primary),其余用次要/文字按钮或收进「更多」。
// 所有视图都应该用这里的组件拼,不再手写 `surface rounded-3xl p-5` 之类。

export function Screen({ title, description, actions, children, className = "" }: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
        <div className="min-w-0">
          <h1 className="m-0 text-[1.375rem] font-black leading-tight tracking-[-0.01em] sm:text-[1.75rem]">{title}</h1>
          {description && <p className="mb-0 mt-1.5 max-w-[52ch] text-sm leading-6 muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="space-y-4 sm:space-y-5">{children}</div>
    </div>
  );
}

export function Panel({ title, description, actions, children, className = "", padded = true }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`surface min-w-0 ${padded ? "p-4 sm:p-5" : ""} ${className}`}>
      {(title || actions) && (
        <div className={`flex min-w-0 items-start justify-between gap-3 ${padded ? "mb-4" : "p-4 pb-0 sm:p-5 sm:pb-0"}`}>
          <div className="min-w-0">
            {title && <h2 className="m-0 text-base font-black leading-snug">{title}</h2>}
            {description && <p className="mb-0 mt-1 text-xs leading-5 muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Toolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex min-w-0 flex-wrap items-center gap-2 ${className}`}>{children}</div>;
}

export function Chip({ children, active = false, tone = "neutral", onClick, title, className = "", ariaLabel }: {
  children: ReactNode;
  active?: boolean;
  tone?: "neutral" | "accent";
  onClick?: () => void;
  title?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const style = active
    ? { background: "var(--primary)", color: "var(--on-primary)", borderColor: "transparent" }
    : tone === "accent"
      ? { background: "var(--primary-soft)", color: "var(--primary-strong)", borderColor: "transparent" }
      : { background: "var(--surface-solid)", color: "var(--muted)", borderColor: "var(--border)" };
  // 触控底线:桌面 40px、移动 44px(min-h-10 = 40px,max-md 下抬到 44px)。
  return (
    <button type="button" onClick={onClick} title={title} aria-label={ariaLabel} aria-pressed={onClick ? active : undefined} className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors max-md:min-h-11 ${className}`.trim()} style={style}>
      {children}
    </button>
  );
}

export function ListRow({ icon: Icon, title, meta, trailing, onClick, active = false, onContextMenu }: {
  icon?: LucideIcon;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  active?: boolean;
  /** 右键菜单:行内容与按钮/div 两种形态都要能挂上 */
  onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const content = (
    <>
      {Icon && (
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl" style={{ background: active ? "var(--primary-soft)" : "var(--surface-soft)", color: active ? "var(--primary)" : "var(--muted)" }}>
          <Icon size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{title}</span>
        {meta && <span className="mt-0.5 block truncate text-xs leading-5 muted">{meta}</span>}
      </span>
      {trailing ?? (onClick && <ChevronRight size={16} className="shrink-0 muted" />)}
    </>
  );
  const className = "flex w-full min-w-0 items-center gap-3 border-t px-1 py-3 text-left transition-colors first:border-t-0 first:pt-0 first:pb-3";
  const style = { borderColor: "var(--hairline)" };
  if (onClick) return <button type="button" onClick={onClick} onContextMenu={onContextMenu} className={`${className} rounded-2xl`} style={style}>{content}</button>;
  return <div className={className} style={style} onContextMenu={onContextMenu}>{content}</div>;
}

export function Metric({ label, value, hint, tone = "neutral", icon: Icon }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "accent" | "warning" | "danger" | "success";
  icon?: LucideIcon;
}) {
  const color = tone === "danger" ? "var(--danger)" : tone === "warning" ? "var(--warning)" : tone === "success" ? "var(--success)" : "var(--foreground)";
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs font-bold muted">
        {Icon && <Icon size={14} />}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-black leading-none tabular-nums" style={{ color }}>{value}</div>
      {hint && <div className="mt-1 truncate text-xs muted">{hint}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center px-4 py-12 text-center">
      <span className="mb-3 grid size-14 place-items-center rounded-3xl" style={{ background: "var(--surface-soft)", color: "var(--muted)" }}>
        <Icon size={24} />
      </span>
      <b className="text-sm font-black">{title}</b>
      {text && <p className="mb-0 mt-1.5 max-w-[34ch] text-xs leading-5 muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Hero({ eyebrow, headline, detail, action, tone = "accent" }: {
  eyebrow?: string;
  headline: string;
  detail?: string;
  action?: ReactNode;
  tone?: "accent" | "warning" | "danger" | "success";
}) {
  const palette = tone === "danger"
    ? { background: "color-mix(in srgb, var(--danger) 12%, var(--surface-solid))", color: "var(--danger)", border: "color-mix(in srgb, var(--danger) 32%, transparent)" }
    : tone === "warning"
      ? { background: "color-mix(in srgb, var(--warning) 14%, var(--surface-solid))", color: "var(--warning)", border: "color-mix(in srgb, var(--warning) 32%, transparent)" }
      : tone === "success"
        ? { background: "color-mix(in srgb, var(--success) 12%, var(--surface-solid))", color: "var(--success)", border: "color-mix(in srgb, var(--success) 30%, transparent)" }
        : { background: "linear-gradient(135deg, var(--primary-soft), color-mix(in srgb, var(--primary-soft) 55%, var(--surface-solid)))", color: "var(--primary-strong)", border: "color-mix(in srgb, var(--primary) 22%, transparent)" };
  return (
    <section className="rounded-[28px] border p-5 sm:p-6" style={{ background: palette.background, borderColor: palette.border }}>
      {eyebrow && <div className="text-xs font-black tracking-wide" style={{ color: palette.color }}>{eyebrow}</div>}
      <h2 className="m-0 mt-1.5 text-lg font-black leading-snug sm:text-xl">{headline}</h2>
      {detail && <p className="mb-0 mt-2 max-w-[46ch] text-sm leading-6" style={{ color: "var(--foreground)", opacity: 0.75 }}>{detail}</p>}
      {action && <div className="mt-4 flex flex-wrap items-center gap-2">{action}</div>}
    </section>
  );
}
// ---- 从旧的 ui.tsx / shared.tsx 合并进来的原语(全站只保留这一份)----

type ButtonVariant = "primary" | "secondary" | "quiet";
type ButtonSize = "default" | "sm" | "icon";
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; danger?: boolean };
type FieldProps = LabelHTMLAttributes<HTMLLabelElement> & { label: ReactNode; hint?: ReactNode; children: ReactNode };

export function Button({ variant = "secondary", size = "default", danger = false, className = "", ...props }: ButtonProps) {
  const variantClass = variant === "primary" ? "ds-button-primary" : variant === "quiet" ? "ds-button-quiet" : "ds-button-secondary";
  const sizeClass = size === "sm" ? "ds-button-sm" : size === "icon" ? "ds-button-icon" : "";
  return <button {...props} className={`${variantClass} ${sizeClass} ${danger ? "ds-button-danger" : ""} ${className}`.trim()} />;
}

export function Field({ label, hint, children, className = "", ...props }: FieldProps) {
  return <label {...props} className={`ds-form-field ${className}`.trim()}><span className="ds-field-label">{label}</span>{children}{hint && <span className="ds-field-hint">{hint}</span>}</label>;
}

export function Badge({ tone = "neutral", className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "primary" | "success" | "warning" | "danger" }) {
  return <span {...props} className={`ui-badge ${className}`.trim()} data-tone={tone} />;
}

export function PageShell({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <main {...props} className={`ds-page-shell ${className}`.trim()} />;
}

// PageTitle 是 PageHeader 的薄封装(标题 + 说明 + 右侧操作)。
export function PageHeader({ title, description, action, className = "" }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return <header className={`ds-page-header ${className}`.trim()}><div className="min-w-0"><h1 className="ds-page-title">{title}</h1>{description && <p className="ds-page-description">{description}</p>}</div>{action && <div className="shrink-0">{action}</div>}</header>;
}

export function PageTitle({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return <PageHeader title={title} description={text} action={action} />;
}

export function SectionHead({ title, action, onClick }: { title: string; action: string; onClick: () => void }) { return <div className="flex items-center justify-between gap-3"><h2 className="m-0 text-base font-black sm:text-lg">{title}</h2><button onClick={onClick} className="flex min-h-10 items-center gap-1 text-xs font-bold max-md:min-h-11" style={{ color: "var(--primary)" }}>{action}<ChevronRight size={14} /></button></div>; }

export function LoadingView() { return <div><div className="skeleton mb-3 h-9 w-64 rounded-xl" /><div className="skeleton mb-7 h-4 w-80 max-w-full rounded-lg" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1,2,3,4].map((i) => <div key={i} className="skeleton h-36 rounded-3xl" />)}</div><div className="mt-5 grid gap-4 md:grid-cols-2">{[1,2].map((i) => <div key={i} className="skeleton h-72 rounded-3xl" />)}</div></div>; }
