"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

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
          <p className="mb-0 mt-3 text-sm font-bold">{payload.headline}</p>
          <ul className="mt-3 space-y-2.5">
            {payload.insights.map((insight, index) => (
              <li key={`${insight.title}-${index}`} className="flex gap-2.5">
                <span className="mt-1 size-1.5 shrink-0 rounded-full" style={{ background: "var(--primary)" }} />
                <span className="min-w-0 flex-1">
                  <b className="text-sm">{insight.title}</b>
                  <span className="block text-xs leading-5 muted">{insight.detail}</span>
                  {insight.itemId && (
                    <button
                      type="button"
                      onClick={() => (insight.kind === "restock" ? onRestock(insight.itemId!) : onOpenItem(insight.itemId!))}
                      className="mt-1.5 inline-flex min-h-9 items-center rounded-full px-2.5 text-xs font-bold"
                      style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
                    >
                      {insight.kind === "restock" ? "加到采购清单" : "看看这件"}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}