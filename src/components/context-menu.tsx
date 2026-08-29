"use client";

import { useEffect, useState } from "react";
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
  if (!menu) return null;
  const width = 208;
  const left = typeof window === "undefined" ? menu.x : Math.min(menu.x, Math.max(8, window.innerWidth - width - 8));
  const top = typeof window === "undefined" ? menu.y : Math.min(menu.y, Math.max(8, window.innerHeight - Math.min(items.length * 38 + 16, 360) - 8));
  return <div data-context-menu role="menu" aria-label="快捷菜单" className="fixed z-[120] min-w-[208px] overflow-hidden rounded-2xl border p-1.5 shadow-2xl" style={{ left, top, background: "var(--surface-solid)", borderColor: "var(--border)" }} onPointerDown={(event) => event.stopPropagation()}>
    {items.map((item, index) => <div key={`${item.label}-${index}`}>
      {item.separatorBefore && <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />}
      <button role="menuitem" type="button" disabled={item.disabled} onClick={() => { if (!item.disabled) { item.onClick(); onClose(); } }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-[var(--surface-soft)] disabled:cursor-not-allowed disabled:opacity-40" style={item.danger ? { color: "var(--danger)" } : undefined}>
        {item.icon && <item.icon size={16} className="shrink-0" />}
        <span className="truncate">{item.label}</span>
      </button>
    </div>)}
  </div>;
}
