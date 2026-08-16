"use client";

import { History, LoaderCircle, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type ScanActivity = {
  id: string;
  action: "CONSUME" | "CONSUME_UNDO";
  itemName: string | null;
  detail: string | null;
  createdAt: string;
  undoneAt: string | null;
  user: { displayName: string; username: string } | null;
};

export function ScanActivityPanel({ onToast }: { onToast: (message: string) => void }) {
  const [records, setRecords] = useState<ScanActivity[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [undoing, setUndoing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [sessionResponse, activityResponse] = await Promise.all([fetch("/api/auth/session"), fetch("/api/activity?scan=1")]);
      const session = await sessionResponse.json();
      const activity = await activityResponse.json();
      if (!activityResponse.ok) throw new Error(activity.error || "扫码记录加载失败");
      setIsAdmin(session.user?.role === "ADMIN");
      setRecords(Array.isArray(activity) ? activity : []);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "扫码记录加载失败");
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void load(); });
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const undo = async (record: ScanActivity) => {
    if (!confirm(`确定撤销“${record.itemName || "物品"}”这次扫码消耗吗？库存将恢复 1 ${record.detail?.match(/1 (.+)$/)?.[1] || "个"}。`)) return;
    setUndoing(record.id);
    try {
      const response = await fetch(`/api/activity/${record.id}/undo`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "撤销失败");
      onToast(`${record.itemName || "物品"} 的扫码消耗已撤销`);
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "撤销失败");
    } finally {
      setUndoing(null);
    }
  };

  return <div className="rounded-2xl p-4" style={{ background: "var(--surface-soft)" }}><div className="mb-2 flex items-center gap-2 text-xs font-bold muted"><History size={14} />扫码消耗记录</div>{loading ? <div className="flex items-center gap-2 py-2 text-xs muted"><LoaderCircle size={14} className="animate-spin" />正在加载…</div> : records.length === 0 ? <p className="mb-0 py-2 text-xs muted">还没有扫码消耗记录。</p> : <div className="space-y-2">{records.slice(0, 12).map((record) => <div key={record.id} className="flex items-center gap-2 rounded-xl p-2.5" style={{ background: "var(--surface-solid)" }}><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold">{record.action === "CONSUME" ? "扫码消耗" : "撤销消耗"} · {record.itemName || "物品"}</div><div className="mt-0.5 truncate text-[11px] muted">{new Date(record.createdAt).toLocaleString("zh-CN")} · {record.user?.displayName || "公开扫码"}{record.action === "CONSUME" && record.undoneAt ? " · 已撤销" : ""}</div></div>{isAdmin && record.action === "CONSUME" && !record.undoneAt && <button disabled={undoing === record.id} onClick={() => void undo(record)} className="btn-ghost flex shrink-0 items-center gap-1 px-2 py-1.5 text-[11px] text-red-500 disabled:opacity-50"><Undo2 size={13} />{undoing === record.id ? "处理中" : "撤销"}</button>}</div>)}</div>}</div>;
}
