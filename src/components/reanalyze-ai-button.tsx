"use client";

// 物品详情页的「重新分析」入口。
//
// 详情页在 (app) 路由组之外,没有 AppProvider/toast,所以这里自己做三件事:
// 调用分析接口 → 把结论写回物品 → 让服务端组件重新渲染(router.refresh)。
// 错误就地显示:这个页面没有全局 toast 可用,静默失败是最糟的选择。
//
// 未配置 AI 时不能照旧发请求:接口会回 400「请先在设置中配置」,
// 而详情页只有「返回归物」一个链接 —— 用户被告知去做一件**在这一页上做不到**的事。
// 只读/成员更难堪:他们本来就没有配置 AI 的权限。
// 所以这里跟物品弹窗用同一套口径(item-modal 的 aiAvailable / canConfigureAi):
//   管理员 → 「配置 AI 后可用」,直接进设置
//   其他人 → 「AI 未配置」,不可点,也不发请求

import { useState } from "react";
import Link from "next/link";
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

/** 按钮与链接共用的外观,避免两处样式漂移 */
const ENTRY_CLASS = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors md:min-h-10";

export function ReanalyzeAiButton({ item, aiAvailable = true, canConfigureAi = false }: { item: ReanalyzeItem; aiAvailable?: boolean; canConfigureAi?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const run = async () => {
    // 没有 AI 就根本没有可发的请求;这里再挡一次,任何调用路径都不会打出必然失败的 400
    if (!aiAvailable || loading) return;
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

  if (!aiAvailable) {
    const hint = canConfigureAi ? "去设置里填接口地址与密钥,之后就能让 AI 重新看一遍这件物品" : "需要管理员在设置里开启 AI 后才能重新分析";
    return (
      <div className="flex flex-col gap-1">
        {canConfigureAi ? (
          <Link href="/settings" title={hint} className={ENTRY_CLASS} style={{ background: "var(--surface-soft)", color: "var(--foreground)" }}>
            <Sparkles size={14} />
            配置 AI 后可用
          </Link>
        ) : (
          <button type="button" disabled title={hint} aria-disabled="true" className={`${ENTRY_CLASS} cursor-not-allowed opacity-60`} style={{ background: "var(--surface-soft)", color: "var(--foreground)" }}>
            <Sparkles size={14} />
            AI 未配置
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void run()}
        disabled={loading}
        className={`${ENTRY_CLASS} disabled:opacity-60`}
        style={{ background: "var(--surface-soft)", color: "var(--foreground)" }}
        // 这个按钮的文字会变(重新分析 / 分析中... / 已更新),所以不能用固定的 aria-label ——
        // 可访问名必须包含当下的可见文字(WCAG 2.5.3),否则语音控制念「已更新」会匹配不上。
        // 物品名放进 title,视觉用户悬停能看到,读屏也能念到。
        title={`让 AI 重新看一遍「${item.name}」`}
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