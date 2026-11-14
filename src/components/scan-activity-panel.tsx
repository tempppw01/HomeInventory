"use client";
import { useConfirm } from "@/components/confirm-dialog";

import { History, LoaderCircle, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SettingsBadge, SettingsRow } from "@/components/settings-primitives";
import { ListRow } from "@/components/ui-kit";

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
  const askConfirm = useConfirm();
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
    if (!(await askConfirm(`确定撤销“${record.itemName || "物品"}”这次扫码消耗吗?库存将恢复 1 ${record.detail?.match(/1 (.+)$/)?.[1] || "个"}。`, { title: "撤销扫码消耗", confirmLabel: "撤销并恢复库存" }))) return;
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

  // 与其它设置面板同一节奏:分组标题走 SettingsRow,记录行走 ListRow + 发丝线,不再套内层卡片。
  return <div>
    <SettingsRow icon={History} title="扫码消耗记录" control={<SettingsBadge tone="muted">{records.length} 条</SettingsBadge>} />
    {loading
      ? <div className="flex items-center gap-2 py-3 text-xs muted"><LoaderCircle size={14} className="animate-spin" />正在加载...</div>
      : records.length === 0
        ? <p className="mb-0 py-3 text-xs muted">还没有扫码消耗记录。</p>
        : <div className="max-h-80 overflow-y-auto border-t pr-1" style={{ borderColor: "var(--hairline)" }}>{records.slice(0, 12).map((record) => <ListRow
          key={record.id}
          icon={record.action === "CONSUME" ? History : Undo2}
          title={<span className="block whitespace-normal break-words">{record.action === "CONSUME" ? "扫码消耗" : "撤销消耗"} · {record.itemName || "物品"}</span>}
          meta={<span className="block whitespace-normal break-words">{`${new Date(record.createdAt).toLocaleString("zh-CN")} · ${record.user?.displayName || "公开扫码"}${record.action === "CONSUME" && record.undoneAt ? " · 已撤销" : ""}`}</span>}
          trailing={isAdmin && record.action === "CONSUME" && !record.undoneAt
            ? <button disabled={undoing === record.id} onClick={() => void undo(record)} className="btn-ghost flex shrink-0 items-center gap-1 px-2 py-1.5 text-xs text-red-500 disabled:opacity-50 min-h-10 max-md:min-h-11"><Undo2 size={13} />{undoing === record.id ? "处理中" : "撤销"}</button>
            : undefined}
        />)}</div>}
  </div>;
}