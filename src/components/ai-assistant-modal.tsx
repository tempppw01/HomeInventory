"use client";

import { Bot, CalendarClock, Check, Lightbulb, PackageCheck, Sparkles, Warehouse, X } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import type { Item, ItemType } from "@/types";
import { useEscapeClose } from "@/lib/use-escape-close";
import { ReadOnlyContext } from "@/components/shared";

export type AiAnalysis = {
  name?: string | null;
  category?: string | null;
  type?: ItemType | null;
  unit?: string | null;
  suggestedExpiryDate?: string | null;
  shelfLifeDays?: number | null;
  expiryReason?: string | null;
  storageAdvice?: string | null;
  usageAdvice?: string | null;
  replenishmentAdvice?: string | null;
  suggestedNotes?: string | null;
  confidence?: number | null;
  summary?: string | null;
};

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.error || "操作失败");
  return body;
}

export async function analyzeItem(input: { action: "identify" | "shelf_life" | "full"; item?: Partial<Item>; imageUrl?: string | null; hint?: string }) {
  return jsonRequest<{ analysis: AiAnalysis; model: string }>("/api/ai/analyze-item", { method: "POST", body: JSON.stringify(input) });
}

/**
 * 把模型的置信度翻译成人话。
 * 「可信度 82%」是工程术语,家里人看不懂;改成有判断、有行动建议的说法。
 */
function confidenceText(value: number) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  if (percent >= 85) return `AI 很有把握(${percent}%)`;
  if (percent >= 70) return `AI 大致确定了(${percent}%),细节可以再核对`;
  if (percent >= 50) return `AI 只能猜个大概(${percent}%),建议看一眼包装`;
  return `AI 没太大把握(${percent}%),请以包装上的说明为准`;
}
export function AiAssistantModal({ item, onClose, onApplied }: { item: Item; onClose: () => void; onApplied: (message: string) => void }) {
  // 只读账号可以问 AI、看结论(分析是只读提问),但「应用可用建议」是 PATCH /api/items/...,
  // 一律 403 —— 所以那颗按钮按角色隐藏,并说明原因,避免点下去只得到一个失败。
  const readOnly = useContext(ReadOnlyContext);
  // 之前已经分析过:先把上次结论摆出来,不重复请求。
  const [cached] = useState<AiAnalysis | null>(() => item.aiSummary ? {
    summary: item.aiSummary ?? "",
    storageAdvice: item.aiStorageAdvice ?? undefined,
    usageAdvice: item.aiUsageAdvice ?? undefined,
    replenishmentAdvice: item.aiReplenishmentAdvice ?? undefined,
  } as AiAnalysis : null);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const shownAnalysis = analysis ?? cached;
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const isMedicine = item.category === "医药";
  const run = async (action: "identify" | "shelf_life" | "full") => { setLoading(true); setError(""); try { const result = await analyzeItem({ action, item, imageUrl: item.imageUrl }); setAnalysis(result.analysis); } catch (e) { setError(e instanceof Error ? e.message : "AI 分析失败"); } finally { setLoading(false); } };
  const apply = async () => { const analysis = shownAnalysis; if (!analysis) return; setApplying(true); try { const type = analysis.type || item.type; const patch = { name: analysis.name || item.name, category: analysis.category || item.category, type, unit: analysis.unit || item.unit, expiryDate: type === "DURABLE" ? "" : analysis.suggestedExpiryDate || item.expiryDate?.slice(0, 10) || "", notes: analysis.suggestedNotes || item.notes || "", aiSummary: analysis.summary || item.aiSummary || "", aiStorageAdvice: analysis.storageAdvice || item.aiStorageAdvice || "", aiUsageAdvice: analysis.usageAdvice || item.aiUsageAdvice || "", aiReplenishmentAdvice: analysis.replenishmentAdvice || item.aiReplenishmentAdvice || "" }; await jsonRequest(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify(patch) }); onApplied("AI 关键信息已应用并显示在物品卡片"); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "应用失败"); } finally { setApplying(false); } };

  const autoStarted = useRef(false);
  // 后台自动跑:打开面板就开始全面分析;有缓存或已跑过则跳过。
  // 用 rAF 触发,避免在 effect 里同步 setState(React 19 会告警)。
  useEffect(() => {
    if (autoStarted.current || cached) return;
    autoStarted.current = true;
    const frame = requestAnimationFrame(() => { void run("full"); });
    return () => cancelAnimationFrame(frame);
  });

  useEscapeClose(onClose);
  return <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/35 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div role="dialog" aria-modal="true" aria-label={`${item.name} · AI 助手`} className="max-h-[min(92vh,88dvh)] w-full max-w-2xl overflow-y-auto rounded-t-[28px] rounded-b-none p-5 shadow-2xl sm:rounded-[28px] sm:p-6" style={{ background: "var(--surface-solid)" }}><div className="flex items-start gap-3"><div className="grid size-11 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><Bot size={22} /></div><div className="min-w-0 flex-1"><h2 className="m-0 text-xl font-black leading-snug">{item.name} · AI 助手</h2><p className="mb-0 mt-1 text-xs muted">{isMedicine ? "补齐说明书要点、适应症、常见用量与安全提醒。" : "帮你核对名称、推算保质期、给出存放与补货建议。"}</p></div><button onClick={onClose} className="btn-ghost grid size-11 min-h-11 place-items-center p-0"><X size={17} /></button></div>
    {isMedicine && <p className="mt-4 rounded-[20px] px-4 py-2.5 text-xs leading-5 muted" style={{ background: "var(--surface-soft)" }}>AI 仅整理可确认的包装信息，不替代说明书、药师或医生的专业建议。</p>}
    <div className={`mt-5 grid gap-2 ${item.type === "CONSUMABLE" ? "grid-cols-3" : "grid-cols-2"}`}><Action icon={Sparkles} label={isMedicine ? "核对药品" : "识别对不对"} disabled={loading} onClick={() => run("identify")} />{item.type === "CONSUMABLE" && <Action icon={CalendarClock} label={isMedicine ? "合规有效期" : "能放多久"} disabled={loading} onClick={() => run("shelf_life")} />}<Action icon={Lightbulb} label={isMedicine ? "补全说明书要点" : "全面看一遍"} disabled={loading} onClick={() => run("full")} /></div>
    {loading && <div className="my-8 grid place-items-center text-sm muted"><Sparkles className="mb-3 animate-pulse" style={{ color: "var(--primary)" }} />AI 正在看这件物品,大约十几秒…</div>}
    {error && <div className="mt-4 rounded-[20px] p-3 text-sm" style={{ background: "#ffe8eb", color: "#b42318" }}>
      <div className="leading-6">{error}</div>
      <button type="button" onClick={() => void run("full")} disabled={loading} className="mt-2 min-h-10 rounded-full px-3 text-xs font-bold" style={{ background: "#fff", color: "#b42318" }}>重试</button>
    </div>}
    {shownAnalysis && !loading && <div className="mt-5 space-y-3"><div className="rounded-[20px] p-4" style={{ background: "var(--primary-soft)" }}><div className="text-sm font-bold">{shownAnalysis.summary || "AI 已经整理好了"}</div>{typeof shownAnalysis.confidence === "number" && <div className="mt-1 text-xs muted">{confidenceText(shownAnalysis.confidence)}</div>}</div><div className="grid gap-3 sm:grid-cols-2"><Result icon={PackageCheck} title={isMedicine ? "AI 整理的药品信息" : "AI 看到的信息"} text={[shownAnalysis.name, shownAnalysis.category, shownAnalysis.type === "CONSUMABLE" ? "消耗品" : shownAnalysis.type === "DURABLE" ? "耐用品" : null].filter(Boolean).join(" · ") || "没有建议修改"} />{(shownAnalysis.type || item.type) === "CONSUMABLE" && <Result icon={CalendarClock} title={isMedicine ? "有效期" : "保质期"} text={shownAnalysis.suggestedExpiryDate ? `建议到期日 ${shownAnalysis.suggestedExpiryDate}${shownAnalysis.expiryReason ? `，${shownAnalysis.expiryReason}` : ""}` : shownAnalysis.expiryReason || "无法可靠判断"} />}<Result icon={Warehouse} title={isMedicine ? "说明书怎么说的" : "怎么存放"} text={shownAnalysis.storageAdvice || "暂无建议"} /><Result icon={Lightbulb} title={isMedicine ? "适应症、用量与提醒" : "使用与补货"} text={[shownAnalysis.usageAdvice, shownAnalysis.replenishmentAdvice].filter(Boolean).join("；") || "暂无建议"} /></div>{readOnly ? <p className="m-0 rounded-[20px] px-4 py-2.5 text-center text-xs muted" style={{ background: "var(--surface-soft)" }}>只读账号可以看 AI 的建议,但不能写回物品。要让建议生效,请让成员或管理员点一下「应用」。</p> : <button disabled={applying} onClick={apply} className="btn-primary flex w-full items-center justify-center gap-2"><Check size={17} />{applying ? "应用中…" : isMedicine ? "保存药品说明" : "应用可用建议"}</button>}</div>}
  </div></div>;
}

function Action({ icon: Icon, label, disabled, onClick }: { icon: typeof Sparkles; label: string; disabled: boolean; onClick: () => void }) { return <button disabled={disabled} onClick={onClick} className="btn-ghost flex flex-col items-center gap-2 px-2 py-3 text-xs font-bold disabled:opacity-50"><Icon size={18} style={{ color: "var(--primary)" }} />{label}</button>; }
function Result({ icon: Icon, title, text }: { icon: typeof Sparkles; title: string; text: string }) { return <div className="rounded-[20px] p-4" style={{ background: "var(--surface-soft)" }}><div className="mb-2 flex items-center gap-2 text-xs font-bold"><Icon size={15} style={{ color: "var(--primary)" }} />{title}</div><p className="m-0 text-xs leading-5 muted">{text}</p></div>; }
