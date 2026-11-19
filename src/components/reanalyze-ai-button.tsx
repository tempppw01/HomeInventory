"use client";

// 物品详情页的「重新分析」入口。
//
// 详情页在 (app) 路由组之外,没有 AppProvider/toast,所以这里自己做三件事:
// 调用分析接口 → 把结论写回物品 → 让服务端组件重新渲染(router.refresh)。
// 错误就地显示:这个页面没有全局 toast 可用,静默失败是最糟的选择。

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles } from "lucide-react";

export type ReanalyzeItem = {
  id: string;
  name: string;
  category: string;
  type: string;
  unit: string;
  quantity: number;
  notes?: string | null;
  expiryDate?: string | null;
};

type Analysis = { summary?: string | null; storageAdvice?: string | null; usageAdvice?: string | null; replenishmentAdvice?: string | null };

export function ReanalyzeAiButton({ item }: { item: ReanalyzeItem }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const run = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setDone(false);
    try {
      const analyzeResponse = await fetch("/api/ai/analyze-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "full",
          item: {
            name: item.name,
            category: item.category,
            type: item.type,
            unit: item.unit,
            quantity: item.quantity,
            notes: item.notes ?? undefined,
            expiryDate: item.expiryDate ?? undefined,
          },
        }),
      });
      const analyzeBody = await analyzeResponse.json().catch(() => ({}));
      if (!analyzeResponse.ok) {
        setError(analyzeBody.error || "AI 暂时无法分析这件物品,请稍后再试");
        return;
      }
      const analysis = (analyzeBody.analysis ?? {}) as Analysis;
      if (!analysis.summary && !analysis.storageAdvice && !analysis.usageAdvice && !analysis.replenishmentAdvice) {
        setError("AI 这次没有返回可用的结论,可以再试一次");
        return;
      }
      const patchResponse = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiSummary: analysis.summary ?? null,
          aiStorageAdvice: analysis.storageAdvice ?? null,
          aiUsageAdvice: analysis.usageAdvice ?? null,
          aiReplenishmentAdvice: analysis.replenishmentAdvice ?? null,
        }),
      });
      if (!patchResponse.ok) {
        const patchBody = await patchResponse.json().catch(() => ({}));
        setError(patchBody.error || "分析结果没能保存,请稍后再试");
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("网络不太顺,重新分析没有完成");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void run()}
        disabled={loading}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-60 md:min-h-10"
        style={{ background: "var(--surface-soft)", color: "var(--foreground)" }}
        aria-label={`重新分析「${item.name}」`}
      >
        {loading ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {loading ? "分析中…" : done ? "已更新" : "重新分析"}
      </button>
      {error && (
        <span className="text-xs" role="alert" style={{ color: "var(--danger)" }}>
          {error}
        </span>
      )}
    </div>
  );
}