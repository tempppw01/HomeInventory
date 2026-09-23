import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "quiet";
type ButtonSize = "default" | "sm" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  danger?: boolean;
};

export function Button({ variant = "secondary", size = "default", danger = false, className = "", ...props }: ButtonProps) {
  const variantClass = variant === "primary" ? "ds-button-primary" : variant === "quiet" ? "ds-button-quiet" : "ds-button-secondary";
  const sizeClass = size === "sm" ? "ds-button-sm" : size === "icon" ? "ds-button-icon" : "";
  return <button {...props} className={`${variantClass} ${sizeClass} ${danger ? "ds-button-danger" : ""} ${className}`.trim()} />;
}

export function Card({ as: Element = "section", padding = "default", className = "", ...props }: Omit<HTMLAttributes<HTMLElement>, "color"> & { as?: "section" | "article" | "div"; padding?: "none" | "compact" | "default" | "comfortable" }) {
  return <Element {...props} className={`ds-card ds-card-padding-${padding} ${className}`.trim()} />;
}

type FieldProps = LabelHTMLAttributes<HTMLLabelElement> & {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
};

export function Field({ label, hint, children, className = "", ...props }: FieldProps) {
  return <label {...props} className={`ds-form-field ${className}`.trim()}><span className="ds-field-label">{label}</span>{children}{hint && <span className="ds-field-hint">{hint}</span>}</label>;
}

export function TextField(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`ds-field ${props.className || ""}`.trim()} />;
}

export function Badge({ tone = "neutral", className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "primary" | "success" | "warning" | "danger" }) {
  return <span {...props} className={`ui-badge ${className}`.trim()} data-tone={tone} />;
}

export function PageShell({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <main {...props} className={`ds-page-shell ${className}`.trim()} />;
}

export function PageHeader({ title, description, action, className = "" }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return <header className={`ds-page-header ${className}`.trim()}><div className="min-w-0"><h1 className="ds-page-title">{title}</h1>{description && <p className="ds-page-description">{description}</p>}</div>{action && <div className="shrink-0">{action}</div>}</header>;
}
