"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

export type ContextMenuItem = {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
};

type MenuState = { x: number; y: number } | null;

export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-context-menu]")) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", closeOnOutsidePointerDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointerDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);
  const onContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  };
  return { menu, onContextMenu, close: () => setMenu(null) };
}

export function ContextMenu({ menu, items, onClose }: { menu: MenuState; items: ContextMenuItem[]; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // A context menu is transient: unless focus moves into it, the arrow keys stay
  // on the card behind and the menu is mouse-only. Move focus to the first
  // enabled item on mount, and give it back to the element that was focused when
  // the menu closes (Escape, outside click, scroll, or item activation).
  useEffect(() => {
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const root = menuRef.current;
    const first = root?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
    first?.focus({ preventScroll: true });
    return () => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [menu]);

  if (!menu) return null;

  const moveFocus = (current: HTMLButtonElement, step: number | "first" | "last") => {
    const root = menuRef.current;
    if (!root) return;
    const all = [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const enabled = all.filter((element) => !element.disabled);
    if (!enabled.length) return;
    const at = step === "first" || step === "last"
      ? (step === "first" ? 0 : enabled.length - 1)
      : enabled.findIndex((element) => element === current || element.contains(current));
    const next = at === -1 ? 0 : step === "first" || step === "last" ? at : (at + step + enabled.length) % enabled.length;
    // Roving tabindex: only the focused item is reachable by Tab.
    enabled.forEach((element, index) => { element.tabIndex = index === next ? 0 : -1; });
    enabled[next].focus();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const current = document.activeElement;
    if (!(current instanceof HTMLButtonElement) || !menuRef.current?.contains(current)) return;
    event.preventDefault();
    if (event.key === "ArrowDown") moveFocus(current, 1);
    else if (event.key === "ArrowUp") moveFocus(current, -1);
    else moveFocus(current, event.key === "Home" ? "first" : "last");
  };

  const width = 208;
  const left = typeof window === "undefined" ? menu.x : Math.min(menu.x, Math.max(8, window.innerWidth - width - 8));
  const top = typeof window === "undefined" ? menu.y : Math.min(menu.y, Math.max(8, window.innerHeight - Math.min(items.length * 38 + 16, 360) - 8));
  return <div ref={menuRef} data-context-menu role="menu" aria-label="快捷菜单" onKeyDown={onMenuKeyDown} className="fixed z-[120] min-w-[208px] overflow-hidden rounded-2xl border p-1.5 shadow-2xl" style={{ left, top, background: "var(--surface-solid)", borderColor: "var(--border)" }} onPointerDown={(event) => event.stopPropagation()}>
    {items.map((item, index) => <div key={`${item.label}-${index}`}>
      {item.separatorBefore && <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />}
      <button role="menuitem" type="button" tabIndex={-1} disabled={item.disabled} onClick={() => { if (!item.disabled) { item.onClick(); onClose(); } }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-[var(--surface-soft)] disabled:cursor-not-allowed disabled:opacity-40" style={item.danger ? { color: "var(--danger)" } : undefined}>
        {item.icon && <item.icon size={16} className="shrink-0" />}
        <span className="truncate">{item.label}</span>
      </button>
    </div>)}
  </div>;
}
