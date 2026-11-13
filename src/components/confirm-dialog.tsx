"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, X } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useEscapeClose } from "@/lib/use-escape-close";

// The app used to ask for confirmation with the browser's own confirm(), which
// blocks the whole page, ignores the app theme, cannot be styled or translated
// and cannot be reached with a keyboard on some mobile browsers. This provider
// renders an in-app dialog instead and keeps the familiar promise API.
type ConfirmTone = "danger" | "primary";

type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: ConfirmTone;
};

type QueueEntry = ConfirmRequest & { resolve: (confirmed: boolean) => void };

type ConfirmFn = (message: string, options?: Partial<ConfirmRequest>) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm 必须放在 ConfirmProvider 内部使用");
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<QueueEntry | null>(null);
  const currentRef = useRef<QueueEntry | null>(null);
  const queue = useRef<QueueEntry[]>([]);

  const confirm = useCallback<ConfirmFn>((message, options) => new Promise<boolean>((resolve) => {
    const entry: QueueEntry = {
      title: options?.title ?? (options?.tone === "danger" ? "请确认删除" : "请确认"),
      message,
      confirmLabel: options?.confirmLabel ?? (options?.tone === "danger" ? "确认删除" : "确定"),
      cancelLabel: options?.cancelLabel ?? "取消",
      tone: options?.tone ?? "primary",
      resolve,
    };
    // Only one dialog is on screen at a time; later requests wait their turn so
    // an await-ing caller always gets its own answer.
    if (currentRef.current) queue.current.push(entry);
    else {
      currentRef.current = entry;
      setCurrent(entry);
    }
  }), []);

  const settle = useCallback((confirmed: boolean) => {
    currentRef.current?.resolve(confirmed);
    const next = queue.current.shift() ?? null;
    currentRef.current = next;
    setCurrent(next);
  }, []);

  useEscapeClose(() => settle(false), Boolean(current));

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {current && (
          <motion.div
            key="app-confirm"
            className="fixed inset-0 z-[120] grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => { if (event.target === event.currentTarget) settle(false); }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={current.title}
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98, transition: { duration: .16, ease: [0.23, 1, 0.32, 1] } }}
              transition={{ type: "spring", damping: 28, stiffness: 340 }}
              className="w-full max-w-sm rounded-[28px] p-5 shadow-2xl"
              style={{ background: "var(--surface-solid)" }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="grid size-11 shrink-0 place-items-center rounded-2xl"
                  style={current.tone === "danger"
                    ? { background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)" }
                    : { background: "var(--primary-soft)", color: "var(--primary)" }}
                >
                  <AlertTriangle size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-base font-black">{current.title}</h2>
                  <p className="mb-0 mt-1.5 text-sm leading-6 muted">{current.message}</p>
                </div>
                <button type="button" onClick={() => settle(false)} className="btn-ghost grid size-8 min-h-8 shrink-0 place-items-center p-0" aria-label="关闭确认对话框">
                  <X size={16} />
                </button>
              </div>
              <div className="mt-5 flex gap-3">
                <button type="button" autoFocus={current.tone === "danger"} onClick={() => settle(false)} className="btn-ghost flex-1">{current.cancelLabel}</button>
                <button
                  type="button"
                  autoFocus={current.tone !== "danger"}
                  onClick={() => settle(true)}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-[var(--on-primary)] transition"
                  style={{ background: current.tone === "danger" ? "var(--danger)" : "var(--primary)" }}
                >
                  {current.confirmLabel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}
