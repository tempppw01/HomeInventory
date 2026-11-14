"use client";
import { useConfirm } from "@/components/confirm-dialog";

import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { Item } from "@/types";
import { Empty } from "@/components/ui-kit";
import { useEscapeClose } from "@/lib/use-escape-close";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "操作失败");
  return result as T;
}

export function RecycleBinModal({ onClose, onRestored, onToast }: { onClose: () => void; onRestored: () => void; onToast: (message: string) => void }) {
  const askConfirm = useConfirm();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { request<Item[]>("/api/items?deleted=1").then(setItems).catch((error) => onToast(error instanceof Error ? error.message : "加载回收站失败")).finally(() => setLoading(false)); }, [onToast]);
  const restore = async (item: Item) => { try { await request(`/api/items/${item.id}/restore`, { method: "POST" }); setItems((current) => current.filter((entry) => entry.id !== item.id)); onRestored(); } catch (error) { onToast(error instanceof Error ? error.message : "恢复失败"); } };
  const destroy = async (item: Item) => { if (!(await askConfirm(`永久删除“${item.name}”？此操作不可恢复。`, { title: "永久删除", confirmLabel: "永久删除", tone: "danger" }))) return; try { await request(`/api/items/${item.id}`, { method: "DELETE", body: JSON.stringify({ permanent: true }) }); setItems((current) => current.filter((entry) => entry.id !== item.id)); onToast("物品已永久删除"); } catch (error) { onToast(error instanceof Error ? error.message : "删除失败"); } };
  useEscapeClose(onClose);
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div role="dialog" aria-modal="true" aria-label="回收站" className="max-h-[min(92vh,88dvh)] w-full max-w-lg overflow-y-auto rounded-t-[28px] rounded-b-none p-5 shadow-2xl sm:rounded-[28px] sm:p-6" style={{ background: "var(--surface-solid)" }}><div className="mb-5 flex items-start gap-3 sm:mb-6"><div className="flex-1"><h2 className="m-0 text-xl font-black leading-snug">回收站</h2><p className="mb-0 mt-1 text-xs muted">移入回收站的物品会暂时保留，可恢复或永久删除</p></div><button type="button" onClick={onClose} className="btn-ghost grid size-11 min-h-11 shrink-0 place-items-center p-0 leading-none" aria-label="关闭回收站"><X size={17} strokeWidth={2} /></button></div>{loading ? <div className="py-8 text-center text-sm muted">正在加载…</div> : items.length === 0 ? <Empty icon={Trash2} title="回收站为空" text="删除物品后会先出现在这里" /> : <div className="space-y-2">{items.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-[20px] p-3" style={{ background: "var(--surface-soft)" }}><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{item.name}</div><div className="mt-1 text-xs muted">{item.category} · 删除于 {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString("zh-CN") : "—"}</div></div><button onClick={() => restore(item)} className="btn-ghost min-h-11 shrink-0 px-4 text-xs sm:min-h-10">恢复</button><button onClick={() => destroy(item)} className="btn-ghost min-h-11 shrink-0 px-4 text-xs sm:min-h-10" style={{ color: "var(--danger)" }}>永久删除</button></div>)}</div>}</div></div>;
}
