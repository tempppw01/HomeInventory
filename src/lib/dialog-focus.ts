"use client";

import { useEffect } from "react";

// Every modal in the app is rendered inside the page and marked with
// `role="dialog" aria-modal="true"`. That gave them dialog semantics but not
// dialog *behaviour*: opening one left focus on the trigger in the page behind,
// Tab walked straight out of the overlay, and closing it dropped focus on
// `document.body`. This hook adds the missing behaviour centrally so new
// dialogs inherit it without repeating the wiring.
const DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "audio[controls]",
  "video[controls]",
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const isRendered = (element: HTMLElement) => {
  if (element.hasAttribute("hidden") || element.closest("[inert]")) return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const focusableWithin = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => !element.hasAttribute("disabled") && isRendered(element));

type OpenDialog = { element: HTMLElement; returnTo: HTMLElement | null };

export function useModalFocusManagement() {
  useEffect(() => {
    const open: OpenDialog[] = [];
    const known = new WeakSet<HTMLElement>();
    let frame = 0;
    let lockedScrollbar = 0;

    const top = () => open[open.length - 1];

    const lockScroll = () => {
      if (open.length !== 1) return;
      lockedScrollbar = window.innerWidth - document.documentElement.clientWidth;
      const body = document.body;
      body.dataset.modalScrollLocked = "true";
      // Compensate the removed scrollbar so the page behind does not shift.
      if (lockedScrollbar > 0) body.style.paddingRight = `${lockedScrollbar}px`;
      body.style.overflow = "hidden";
    };

    const unlockScroll = () => {
      if (open.length !== 0) return;
      const body = document.body;
      delete body.dataset.modalScrollLocked;
      body.style.overflow = "";
      body.style.paddingRight = "";
      lockedScrollbar = 0;
    };

    const focusInto = (dialog: HTMLElement) => {
      // React `autoFocus` on a field inside the dialog already placed focus;
      // keep that instead of stealing it back to the container.
      const active = document.activeElement;
      if (active instanceof HTMLElement && dialog.contains(active)) return;
      const preferred = dialog.querySelector<HTMLElement>("[data-autofocus]");
      if (preferred && isRendered(preferred)) {
        preferred.focus({ preventScroll: true });
        return;
      }
      // Focus the container itself: keyboard and screen-reader users land inside
      // the dialog without forcing a soft keyboard open on touch devices.
      if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
      dialog.focus({ preventScroll: true });
    };

    const sync = () => {
      const present = [...document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR)].filter(isRendered);
      const presentSet = new Set(present);

      // Drop dialogs that have unmounted (or been hidden by their exit animation).
      for (let index = open.length - 1; index >= 0; index -= 1) {
        const entry = open[index];
        if (presentSet.has(entry.element)) continue;
        open.splice(index, 1);
        known.delete(entry.element);
        if (index === open.length) {
          const next = top();
          if (next) focusInto(next.element);
          else if (entry.returnTo && entry.returnTo.isConnected) entry.returnTo.focus({ preventScroll: true });
        }
      }

      const added: HTMLElement[] = [];
      for (const element of present) {
        if (known.has(element)) continue;
        const active = document.activeElement;
        const returnTo = active instanceof HTMLElement && !element.contains(active) ? active : null;
        known.add(element);
        open.push({ element, returnTo });
        added.push(element);
      }

      if (added.length) {
        lockScroll();
        focusInto(added[added.length - 1]);
      } else if (open.length === 0) {
        unlockScroll();
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const dialog = top()?.element;
      if (!dialog) return;
      const items = focusableWithin(dialog);
      if (!items.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", onKeyDown, true);
    schedule();

    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKeyDown, true);
      if (frame) cancelAnimationFrame(frame);
      open.length = 0;
      unlockScroll();
    };
  }, []);
}
