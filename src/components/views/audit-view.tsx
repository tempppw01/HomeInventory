"use client";

import { Check, QrCode, ClipboardCheck } from "lucide-react";
import { useContext, useState } from "react";
import type { Item, Location } from "@/types";
import { useConfirm } from "@/components/confirm-dialog";
import { QrScannerModal, normalizeScannedCode } from "@/components/qr-scanner";
import { ReadOnlyContext, request, PageTitle, EmptyState } from "../shared";
export function AuditView({ items, locations, onRefresh, onToast }: { items: Item[]; locations: Location[]; onRefresh: () => Promise<void>; onToast: (message: string) => void }) {
  const readOnly = useContext(ReadOnlyContext);
  const askConfirm = useConfirm();
  const storageKey = "home-inventory-audit-confirmed-v1";
  const historyKey = "home-inventory-audit-history-v1";
  const [confirmed, setConfirmed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(storageKey) || "[]")); } catch { return new Set(); }
  });
  const [scanValue, setScanValue] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [finished, setFinished] = useState(false);
  const [working, setWorking] = useState(false);
  const [locationId, setLocationId] = useState("ALL");
  const [history, setHistory] = useState<{ at: string; total: number; confirmed: number; locationName: string }[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(historyKey) || "[]"); } catch { return []; }
  });
  const scopedItems = locationId === "ALL" ? items : items.filter((item) => item.locationId === locationId);

  const validConfirmed = new Set([...confirmed].filter((id) => items.some((item) => item.id === id)));
  const updateConfirmed = (next: Set<string>) => {
    setConfirmed(next);
    localStorage.setItem(storageKey, JSON.stringify([...next]));
  };
  const toggle = (id: string) => {
    const next = new Set(validConfirmed);
    next.has(id) ? next.delete(id) : next.add(id);
    updateConfirmed(next);
  };
  const unconfirmed = scopedItems.filter((item) => !confirmed.has(item.id));
  const handleScan = (raw = scanValue): "matched" | "duplicate" | "unknown" => {
    const value = normalizeScannedCode(raw);
    if (!value) return "unknown";
    const match = scopedItems.find((item) => item.id === value || item.itemCode?.toLowerCase() === value.toLowerCase());
    if (!match) { onToast("没有找到这个物品,请检查二维码或编号"); return "unknown"; }
    if (confirmed.has(match.id)) { onToast(`${match.name} 已确认,无需重复盘点`); setScanValue(""); return "duplicate"; }
    updateConfirmed(new Set([...confirmed, match.id]));
    setScanValue("");
    onToast(`已确认:${match.name}`);
    return "matched";
  };
  const handleUnconfirmed = async (action: "empty" | "lost") => {
    if (!unconfirmed.length || working) return;
    const actionLabel = action === "empty" ? "标记为已耗尽并从列表隐藏" : "移入回收站";
    if (!(await askConfirm(`确定将 ${unconfirmed.length} 件未确认物品${actionLabel}吗？此操作仅影响未确认物品。`, { title: "处理未确认物品", confirmLabel: "继续处理", tone: "danger" }))) return;
    setWorking(true);
    try {
      await Promise.all(unconfirmed.map((item) => request(`/api/items/${item.id}`, action === "empty"
        ? { method: "PATCH", body: JSON.stringify({ quantity: 0 }) }
        : { method: "DELETE", body: JSON.stringify({}) })));
      localStorage.removeItem(storageKey);
      updateConfirmed(new Set());
      await onRefresh();
      onToast(action === "empty" ? "未确认物品已标记为耗尽" : "未确认物品已移入回收站");
    } catch (error) { onToast(error instanceof Error ? error.message : "处理未完成，请重试"); }
    finally { setWorking(false); }
  };
  const finish = () => {
    const entry = { at: new Date().toISOString(), total: scopedItems.length, confirmed: scopedItems.filter((item) => confirmed.has(item.id)).length, locationName: locationId === "ALL" ? "全部空间" : locations.find((location) => location.id === locationId)?.name || "当前空间" };
    const nextHistory = [entry, ...history].slice(0, 5);
    setHistory(nextHistory);
    localStorage.setItem(historyKey, JSON.stringify(nextHistory));
    setFinished(true);
    if (!unconfirmed.length) localStorage.removeItem(storageKey);
  };

  if (finished) return <><PageTitle title="本次盘点完成" text={unconfirmed.length ? "还有一些物品等你决定怎么处理。" : "全部物品均已核对，家里井井有条。"} action={<button className="btn-ghost" onClick={() => setFinished(false)}>返回盘点</button>} />
    <section className="surface max-w-3xl p-5 sm:p-6"><div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><ClipboardCheck size={22} /></div><div><h2 className="m-0 text-lg font-black">已确认 {scopedItems.filter((item) => confirmed.has(item.id)).length} / {scopedItems.length} 件</h2><p className="mb-0 mt-1 text-sm muted">{unconfirmed.length ? `${unconfirmed.length} 件尚未确认，可继续核对或集中处理。` : "没有遗漏，辛苦啦。"}</p></div></div>{unconfirmed.length > 0 && <div className="mt-5 flex flex-wrap gap-2"><button onClick={() => void handleUnconfirmed("empty")} disabled={working || readOnly} className="btn-ghost text-amber-700">标记未确认项耗尽</button><button onClick={() => void handleUnconfirmed("lost")} disabled={working || readOnly} className="btn-ghost text-red-500">未确认项移入回收站</button></div>}</section></>;

  return <><PageTitle title="家庭盘点" action={<button className="btn-primary flex items-center gap-2" onClick={finish}><Check size={16} />结束盘点</button>} />
    <div className="mb-4 flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-xs font-bold muted">盘点范围<select className="input h-9 min-h-9 w-auto py-1 text-xs" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="ALL">全部空间</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>{history[0] && <span className="text-xs muted">最近盘点：{new Date(history[0].at).toLocaleDateString("zh-CN")} · {history[0].confirmed}/{history[0].total} 件 · {history[0].locationName}</span>}</div>
    <section className="mb-5 flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center" style={{ borderColor: "var(--border)", background: "var(--surface-soft)" }}><button type="button" onClick={() => setScannerOpen(true)} className="btn-primary flex shrink-0 items-center gap-2 px-3" aria-label="扫码盘点" title="手机用相机、电脑用屏幕共享识别二维码"><QrCode size={17} />扫码</button><form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); handleScan(); }}><input value={scanValue} onChange={(event) => setScanValue(event.target.value)} className="input min-w-0 flex-1" placeholder="输入物品编号,或点左侧扫码" aria-label="输入物品编号或点左侧扫码盘点" /><button type="submit" className="btn-primary shrink-0 px-3">确认</button></form></section>
    {scannerOpen && <QrScannerModal onClose={() => setScannerOpen(false)} onDetect={handleScan} />}
    <div className="mb-4 flex items-center justify-between gap-3 text-sm"><span className="font-black">进度 <span style={{ color: "var(--primary)" }}>{scopedItems.filter((item) => confirmed.has(item.id)).length} / {scopedItems.length}</span></span><button onClick={() => { void askConfirm("重新开始本次盘点？当前确认记录会清空。", { title: "重新开始盘点", confirmLabel: "重新开始", tone: "danger" }).then((ok) => { if (ok) updateConfirmed(new Set()); }); }} className="text-xs font-bold muted hover:text-[var(--foreground)]">重新开始</button></div><div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--surface-soft)" }}><div className="h-full rounded-full transition-[width] duration-300" style={{ transitionTimingFunction: "var(--ease-out)", width: `${scopedItems.length ? scopedItems.filter((item) => confirmed.has(item.id)).length / scopedItems.length * 100 : 0}%`, background: "var(--primary)" }} /></div>
    {scopedItems.length ? <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{scopedItems.map((item) => { const checked = confirmed.has(item.id); return <button type="button" key={item.id} onClick={() => toggle(item.id)} className="flex min-w-0 items-center gap-3 rounded-2xl border p-3 text-left transition hover:-translate-y-px" style={{ borderColor: checked ? "var(--primary)" : "var(--border)", background: checked ? "var(--primary-soft)" : "var(--surface-solid)" }}><span className="grid size-7 shrink-0 place-items-center rounded-full border" style={{ borderColor: checked ? "var(--primary)" : "var(--border)", background: checked ? "var(--primary)" : "transparent", color: "var(--on-primary)" }}>{checked && <Check size={15} strokeWidth={3} />}</span><div className="min-w-0 flex-1"><div className="truncate text-sm font-black">{item.name}</div><div className="mt-0.5 truncate text-xs muted">{item.itemCode || item.id} · {item.location?.name || "未设置位置"}</div></div><span className="shrink-0 text-xs font-bold muted">{item.quantity}{item.unit}</span></button>; })}</div> : <div className="surface mt-5 rounded-3xl py-16"><EmptyState icon={ClipboardCheck} title="这个空间没有可盘点的物品" text="换一个空间，或先录入物品后再来核对。" /></div>}
    {unconfirmed.length > 0 && <section className="mt-7 border-t pt-5" style={{ borderColor: "var(--border)" }}><h2 className="m-0 text-base font-black">未确认物品</h2><p className="mb-3 mt-1 text-xs muted">盘点结束前，你可以保留它们待下次核对，或统一处理。</p><div className="flex flex-wrap gap-2"><button onClick={() => void handleUnconfirmed("empty")} disabled={working} className="btn-ghost text-amber-700">标记为耗尽</button><button onClick={() => void handleUnconfirmed("lost")} disabled={working} className="btn-ghost text-red-500">移入回收站</button></div></section>}</>;
}

