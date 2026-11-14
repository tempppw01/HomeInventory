"use client";

import { Check, ClipboardCheck, Package, QrCode } from "lucide-react";
import { useContext, useState } from "react";
import type { Item, Location } from "@/types";
import { useConfirm } from "@/components/confirm-dialog";
import { QrScannerModal, normalizeScannedCode } from "@/components/qr-scanner";
import { Empty, ListRow, Metric, Panel, Screen, Toolbar } from "@/components/ui-kit";
import { ReadOnlyContext, request } from "../shared";
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
  const scopeName = locationId === "ALL" ? "全部空间" : locations.find((location) => location.id === locationId)?.name || "当前空间";

  const validConfirmed = new Set([...confirmed].filter((id) => items.some((item) => item.id === id)));
  const updateConfirmed = (next: Set<string>) => {
    setConfirmed(next);
    localStorage.setItem(storageKey, JSON.stringify([...next]));
  };
  const toggle = (id: string) => {
    const next = new Set(validConfirmed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateConfirmed(next);
  };
  const unconfirmed = scopedItems.filter((item) => !confirmed.has(item.id));
  const confirmedCount = scopedItems.filter((item) => confirmed.has(item.id)).length;
  const progressPercent = scopedItems.length ? (confirmedCount / scopedItems.length) * 100 : 0;
  const restart = () => { void askConfirm("重新开始本次盘点?当前确认记录会清空。", { title: "重新开始盘点", confirmLabel: "重新开始", tone: "danger" }).then((ok) => { if (ok) updateConfirmed(new Set()); }); };
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
    if (!(await askConfirm(`确定将 ${unconfirmed.length} 件未确认物品${actionLabel}吗?此操作仅影响未确认物品。`, { title: "处理未确认物品", confirmLabel: "继续处理", tone: "danger" }))) return;
    setWorking(true);
    try {
      await Promise.all(unconfirmed.map((item) => request(`/api/items/${item.id}`, action === "empty"
        ? { method: "PATCH", body: JSON.stringify({ quantity: 0 }) }
        : { method: "DELETE", body: JSON.stringify({}) })));
      localStorage.removeItem(storageKey);
      updateConfirmed(new Set());
      await onRefresh();
      onToast(action === "empty" ? "未确认物品已标记为耗尽" : "未确认物品已移入回收站");
    } catch (error) { onToast(error instanceof Error ? error.message : "处理未完成,请重试"); }
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

  if (finished) return (
    <Screen
      title="本次盘点完成"
      description={unconfirmed.length ? "还有一些物品等你决定怎么处理。" : "全部物品均已核对,家里井井有条。"}
      actions={<button className="btn-ghost min-h-11" onClick={() => setFinished(false)}>返回盘点</button>}
    >
      <Panel>
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><ClipboardCheck size={24} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-lg font-black">已确认 {confirmedCount} / {scopedItems.length} 件</h2>
            <p className="mb-0 mt-1 text-sm leading-6 muted">{unconfirmed.length ? `${unconfirmed.length} 件尚未确认,可继续核对或集中处理。` : "没有遗漏,辛苦啦。"}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-4" style={{ borderColor: "var(--hairline)" }}>
          <Metric label="已确认" value={confirmedCount} hint={`共 ${scopedItems.length} 件`} tone="success" />
          <Metric label="未确认" value={unconfirmed.length} tone={unconfirmed.length ? "warning" : "neutral"} />
        </div>
        {unconfirmed.length > 0 && <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--hairline)" }}><Toolbar><button onClick={() => void handleUnconfirmed("empty")} disabled={working || readOnly} className="btn-ghost min-h-11 text-amber-700">标记未确认项耗尽</button><button onClick={() => void handleUnconfirmed("lost")} disabled={working || readOnly} className="btn-ghost min-h-11 text-red-500">未确认项移入回收站</button></Toolbar></div>}
      </Panel>
    </Screen>
  );

  return (
    <Screen
      title="家庭盘点"
      description="扫码或点一下,把家里的东西挨个核对一遍。"
      actions={<button className="btn-primary flex min-h-11 items-center gap-2" onClick={finish}><Check size={16} />结束盘点</button>}
    >
      <Panel
        title="盘点总览"
        description={history[0] ? `最近盘点:${new Date(history[0].at).toLocaleDateString("zh-CN")} · ${history[0].confirmed}/${history[0].total} 件 · ${history[0].locationName}` : "第一次盘点?先扫一个二维码试试。"}
        actions={<button onClick={restart} className="inline-flex min-h-11 items-center px-2 text-xs font-bold muted transition-colors hover:text-[var(--foreground)] sm:min-h-10">重新开始</button>}
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {/* 「进度 X / Y」必须是一段完整文本(验收套件按文案断言,innerText/textContent 都要能命中),
              所以这里不用 Metric 拆成 label/value 两个块,只借它的排版尺度。 */}
          <div className="min-w-0">
            <div className="text-2xl font-black leading-none tabular-nums" style={{ color: "var(--primary)" }}>
              <span className="align-baseline text-xs font-bold muted">进度</span>{" "}
              {confirmedCount} / {scopedItems.length}
            </div>
          </div>
          <Metric label="未确认" value={unconfirmed.length} tone={unconfirmed.length ? "warning" : "success"} hint={unconfirmed.length ? "继续核对或统一处理" : "没有遗漏"} />
          <Metric label="当前范围" value={scopeName} hint={locationId === "ALL" ? "全部空间" : "仅当前空间"} />
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full" style={{ background: "var(--surface-soft)" }}>
          <div className="h-full rounded-full transition-[width] duration-300" style={{ transitionTimingFunction: "var(--ease-out)", width: `${progressPercent}%`, background: "var(--primary)" }} />
        </div>
      </Panel>

      <Panel title="扫码或输入编号" description="手机用相机、电脑用屏幕共享识别二维码;也可以直接输入物品编号。">
        <Toolbar>
          <button type="button" onClick={() => setScannerOpen(true)} className="btn-primary flex min-h-11 shrink-0 items-center gap-2 px-3" aria-label="扫码盘点" title="手机用相机、电脑用屏幕共享识别二维码"><QrCode size={17} />扫码</button>
          <form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); handleScan(); }}>
            <input value={scanValue} onChange={(event) => setScanValue(event.target.value)} className="input min-w-0 flex-1" placeholder="输入物品编号,或点左侧扫码" aria-label="输入物品编号或点左侧扫码盘点" />
            <button type="submit" className="btn-primary min-h-11 shrink-0 px-3">确认</button>
          </form>
        </Toolbar>
      </Panel>

      {scannerOpen && <QrScannerModal onClose={() => setScannerOpen(false)} onDetect={handleScan} />}

      <Panel
        title="核对表"
        description={scopedItems.length ? `当前范围共 ${scopedItems.length} 件,已确认 ${confirmedCount} 件。` : undefined}
        actions={
          <label className="flex shrink-0 items-center gap-2 text-xs font-bold muted">
            盘点范围
            <select className="input w-auto py-1.5 text-xs" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="ALL">全部空间</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
        }
      >
        {scopedItems.length ? scopedItems.map((item) => {
          const checked = confirmed.has(item.id);
          return (
            <ListRow
              key={item.id}
              icon={checked ? Check : Package}
              active={checked}
              onClick={() => toggle(item.id)}
              title={item.name}
              meta={`${item.itemCode || item.id} · ${item.location?.name || "未设置位置"}`}
              trailing={<span className="flex shrink-0 items-center gap-2"><span className="text-xs font-bold muted">{item.quantity}{item.unit}</span>{checked && <Check size={15} strokeWidth={3} style={{ color: "var(--primary)" }} />}</span>}
            />
          );
        }) : <Empty icon={ClipboardCheck} title="这个空间没有可盘点的物品" text="换一个空间,或先录入物品后再来核对。" />}
      </Panel>

      {unconfirmed.length > 0 && (
        <Panel title="未确认物品" description="盘点结束前,你可以保留它们待下次核对,或统一处理。">
          <Toolbar>
            <button onClick={() => void handleUnconfirmed("empty")} disabled={working} className="btn-ghost min-h-11 text-amber-700">标记为耗尽</button>
            <button onClick={() => void handleUnconfirmed("lost")} disabled={working} className="btn-ghost min-h-11 text-red-500">移入回收站</button>
          </Toolbar>
        </Panel>
      )}
    </Screen>
  );
}
