"use client";

import { Bot, CalendarClock, Check, Lightbulb, PackageCheck, Sparkles, Warehouse, X } from "lucide-react";
import { useState } from "react";
import type { Item, ItemType } from "@/types";

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

export function AiAssistantModal({ item, onClose, onApplied }: { item: Item; onClose: () => void; onApplied: (message: string) => void }) {
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: "identify" | "shelf_life" | "full") => { setLoading(true); setError(""); try { const result = await analyzeItem({ action, item, imageUrl: item.imageUrl }); setAnalysis(result.analysis); } catch (e) { setError(e instanceof Error ? e.message : "AI 分析失败"); } finally { setLoading(false); } };
  const apply = async () => { if (!analysis) return; setApplying(true); try { const notes = [analysis.suggestedNotes, analysis.storageAdvice && `存储建议：${analysis.storageAdvice}`, analysis.usageAdvice && `使用建议：${analysis.usageAdvice}`].filter(Boolean).join("\n"); const type = analysis.type || item.type; const patch = { name: analysis.name || item.name, category: analysis.category || item.category, type, unit: analysis.unit || item.unit, expiryDate: type === "DURABLE" ? "" : analysis.suggestedExpiryDate || item.expiryDate?.slice(0, 10) || "", notes: notes || item.notes || "" }; await jsonRequest(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify(patch) }); onApplied("AI 建议已应用到物品"); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "应用失败"); } finally { setApplying(false); } };

  return <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] p-5 shadow-2xl sm:rounded-[28px] sm:p-6" style={{ background: "var(--surface-solid)" }}><div className="flex items-start gap-3"><div className="grid size-11 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><Bot size={22} /></div><div className="min-w-0 flex-1"><h2 className="m-0 text-xl font-black">{item.name} · AI 助手</h2><p className="mb-0 mt-1 text-xs muted">识别纠错、保质期、存储方式和补货节奏。</p></div><button onClick={onClose} className="btn-ghost grid size-9 place-items-center p-0"><X size={17} /></button></div>
    <div className={`mt-5 grid gap-2 ${item.type === "CONSUMABLE" ? "grid-cols-3" : "grid-cols-2"}`}><Action icon={Sparkles} label="智能识别" disabled={loading} onClick={() => run("identify")} />{item.type === "CONSUMABLE" && <Action icon={CalendarClock} label="保质期" disabled={loading} onClick={() => run("shelf_life")} />}<Action icon={Lightbulb} label="全面分析" disabled={loading} onClick={() => run("full")} /></div>
    {loading && <div className="my-8 grid place-items-center text-sm muted"><Sparkles className="mb-3 animate-pulse" style={{ color: "var(--primary)" }} />AI 正在分析物品信息…</div>}
    {error && <div className="mt-4 rounded-2xl p-3 text-sm text-red-500" style={{ background: "#ffe8eb" }}>{error}</div>}
    {analysis && !loading && <div className="mt-5 space-y-3"><div className="rounded-2xl p-4" style={{ background: "var(--primary-soft)" }}><div className="text-sm font-bold">{analysis.summary || "分析完成"}</div>{typeof analysis.confidence === "number" && <div className="mt-1 text-xs muted">可信度 {Math.round(analysis.confidence * 100)}%</div>}</div><div className="grid gap-3 sm:grid-cols-2"><Result icon={PackageCheck} title="识别结果" text={[analysis.name, analysis.category, analysis.type === "CONSUMABLE" ? "消耗品" : analysis.type === "DURABLE" ? "耐用品" : null].filter(Boolean).join(" · ") || "没有建议修改"} />{(analysis.type || item.type) === "CONSUMABLE" && <Result icon={CalendarClock} title="保质期" text={analysis.suggestedExpiryDate ? `建议到期日 ${analysis.suggestedExpiryDate}${analysis.expiryReason ? `，${analysis.expiryReason}` : ""}` : analysis.expiryReason || "无法可靠判断"} />}<Result icon={Warehouse} title="存储建议" text={analysis.storageAdvice || "暂无建议"} /><Result icon={Lightbulb} title="使用与补货" text={[analysis.usageAdvice, analysis.replenishmentAdvice].filter(Boolean).join("；") || "暂无建议"} /></div><button disabled={applying} onClick={apply} className="btn-primary flex w-full items-center justify-center gap-2"><Check size={17} />{applying ? "应用中…" : "应用可用建议"}</button></div>}
  </div></div>;
}

function Action({ icon: Icon, label, disabled, onClick }: { icon: typeof Sparkles; label: string; disabled: boolean; onClick: () => void }) { return <button disabled={disabled} onClick={onClick} className="btn-ghost flex flex-col items-center gap-2 px-2 py-3 text-xs font-bold disabled:opacity-50"><Icon size={18} style={{ color: "var(--primary)" }} />{label}</button>; }
function Result({ icon: Icon, title, text }: { icon: typeof Sparkles; title: string; text: string }) { return <div className="rounded-2xl p-4" style={{ background: "var(--surface-soft)" }}><div className="mb-2 flex items-center gap-2 text-xs font-bold"><Icon size={15} style={{ color: "var(--primary)" }} />{title}</div><p className="m-0 text-xs leading-5 muted">{text}</p></div>; }
