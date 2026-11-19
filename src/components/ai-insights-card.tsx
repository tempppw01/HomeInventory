"use client";

import { useEffect, useRef, useState } from "react";
import { addDismissed, filterDismissed, insightKey, parseDismissed } from "@/lib/insight-dismiss";
import { Sparkles, X } from "lucide-react";

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.error || "操作失败");
  return body;
}


type Insight = {
  title: string;
  detail: string;
  action?: string;
  itemId?: string;
  itemName?: string;
  kind?: "restock" | "open";
};
type Payload = { headline: string; insights: Insight[]; generatedAt: string; model: string; cached: boolean };

/**
 * 概览页的「AI 本周建议」。
 * 打开页面就自动请求一次,不需要用户点任何按钮;失败时整块自己消失,不打扰主流程。
 */
export function AiInsightsCard({ aiAvailable, onRestock, onOpenItem }: { aiAvailable: boolean; onRestock: (itemId: string) => void; onOpenItem: (itemId: string) => void }) {
  // 被忽略的建议只存在本机:它们本来就是「这台设备上不想再看到」。
  const [dismissedKeys, setDismissedKeys] = useState<string[]>(() => (typeof window === "undefined" ? [] : parseDismissed(localStorage.getItem("home-inventory-dismissed-insights"))));
  const dismissInsight = (insight: { kind?: string; title: string; itemId?: string | null }) => {
    setDismissedKeys((current) => {
      const next = addDismissed(current, insightKey(insight));
      try { localStorage.setItem("home-inventory-dismissed-insights", JSON.stringify(next)); } catch { /* 隐私模式忽略 */ }
      return next;
    });
  };
  // 一次收掉全部可见建议。只有一条时不显示这个按钮 —— 那条自带的 × 就够了。
  const dismissAllVisible = (insights: Array<{ kind?: string; title: string; itemId?: string | null }>) => {
    setDismissedKeys((current) => {
      let next = current;
      for (const insight of insights) next = addDismissed(next, insightKey(insight));
      try { localStorage.setItem("home-inventory-dismissed-insights", JSON.stringify(next)); } catch { /* 隐私模式忽略 */ }
      return next;
    });
  };

  const restoreInsights = () => {
    setDismissedKeys([]);
    try { localStorage.removeItem("home-inventory-dismissed-insights"); } catch { /* 忽略 */ }
  };
  const [payload, setPayload] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!aiAvailable || started.current) return;
    started.current = true;
    let alive = true;
    // 放到空闲时段再请求,别和首屏数据抢带宽。
    const run = () => {
      jsonRequest<Payload>("/api/ai/insights", { headers: { "x-background": "1" } })
        .then((data) => { if (alive) setPayload(data); })
        .catch(() => { if (alive) setFailed(true); });
    };
    const idle = typeof window !== "undefined" && "requestIdleCallback" in window
      ? window.requestIdleCallback(run, { timeout: 3000 })
      : setTimeout(run, 1200);
    return () => {
      alive = false;
      if (typeof window !== "undefined" && "cancelIdleCallback" in window) window.cancelIdleCallback(idle as number);
      else clearTimeout(idle as ReturnType<typeof setTimeout>);
    };
  }, [aiAvailable]);

  if (!aiAvailable || failed) return null;

  return (
    <section className="surface rounded-[28px] p-5" aria-label="AI 本周建议">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
          <Sparkles size={16} />
        </span>
        <b className="text-sm">AI 本周建议</b>
        <span className="ml-auto text-[11px] muted">{payload ? (payload.cached ? "已更新" : "刚刚生成") : "正在看家里的情况…"}</span>
      </div>

      {!payload && (
        <div className="mt-4 space-y-2" aria-hidden>
          <div className="h-3 w-2/3 rounded-full" style={{ background: "var(--surface-soft)" }} />
          <div className="h-3 w-full rounded-full" style={{ background: "var(--surface-soft)" }} />
          <div className="h-3 w-5/6 rounded-full" style={{ background: "var(--surface-soft)" }} />
        </div>
      )}

      {payload && (
        <>
          <div className="mt-3 flex items-start justify-between gap-3">
            <p className="mb-0 text-sm font-bold">{payload.headline}</p>
            {filterDismissed(payload.insights, dismissedKeys).length > 1 && (
              <button
                type="button"
                onClick={() => dismissAllVisible(filterDismissed(payload.insights, dismissedKeys))}
                className="inline-flex min-h-11 shrink-0 items-center rounded-full px-2.5 text-xs font-bold muted transition-colors hover:bg-[var(--surface-soft)] md:min-h-8"
                aria-label="把这周的建议全部标为已读"
              >
                全部标为已读
              </button>
            )}
          </div>
          <ul className="mt-3 space-y-2.5">
            {filterDismissed(payload.insights, dismissedKeys).map((insight, index) => (
              <li key={`${insight.title}-${index}`} className="flex gap-2.5">
                <span className="mt-1 size-1.5 shrink-0 rounded-full" style={{ background: "var(--primary)" }} />
                <span className="min-w-0 flex-1">
                  <b className="text-sm">{insight.title}</b>
                  <span className="block text-xs leading-5 muted">{insight.detail}</span>
                  {insight.itemId && (
                    <button
                      type="button"
                      onClick={() => (insight.kind === "restock" ? onRestock(insight.itemId!) : onOpenItem(insight.itemId!))}
                      className="mt-1.5 inline-flex min-h-11 items-center rounded-full px-3 text-xs font-bold md:min-h-9 md:px-2.5"
                      style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
                    >
                      {insight.kind === "restock" ? "加到采购清单" : "看看这件"}
                    </button>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => dismissInsight(insight)}
                  className="mt-0.5 grid size-11 shrink-0 place-items-center rounded-lg opacity-45 transition hover:opacity-100 md:size-7"
                  aria-label={`忽略这条建议:${insight.title}`}
                  title="不再提示这条建议"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          {filterDismissed(payload.insights, dismissedKeys).length === 0 && (
            <p className="mb-0 mt-3 text-xs muted">这条建议你都不需要了,已经收起来。</p>
          )}
          {dismissedKeys.length > 0 && (
            <button
              type="button"
              onClick={restoreInsights}
              className="mt-2 inline-flex min-h-11 items-center rounded-full px-3 text-xs font-bold muted md:min-h-9 md:px-2.5"
            >
              恢复已忽略的 {dismissedKeys.length} 条
            </button>
          )}
        </>
      )}
    </section>
  );
}