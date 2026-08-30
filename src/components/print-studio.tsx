"use client";

import { Printer, Settings2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "@/types";

type PaperPreset = "a4-portrait" | "a4-landscape" | "custom";
type PrintCountMode = "single" | "inventory" | "custom";
const printSettingsKey = "home-inventory-print-settings-v1";

function savedNumber(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function PrintStudio({ items, onClose }: { items: Item[]; onClose: () => void }) {
  const [preset, setPreset] = useState<PaperPreset>("a4-portrait");
  const [customWidth, setCustomWidth] = useState(210);
  const [customHeight, setCustomHeight] = useState(297);
  const [columns, setColumns] = useState(3);
  const [qrSize, setQrSize] = useState(112);
  const [horizontalMargin, setHorizontalMargin] = useState(10);
  const [verticalMargin, setVerticalMargin] = useState(10);
  const [columnGap, setColumnGap] = useState(5);
  const [rowGap, setRowGap] = useState(5);
  const [labelWidth, setLabelWidth] = useState(60);
  const [labelHeight, setLabelHeight] = useState(70);
  const [startRow, setStartRow] = useState(1);
  const [showLabelBorder, setShowLabelBorder] = useState(true);
  const [showLocation, setShowLocation] = useState(true);
  const [showQuantity, setShowQuantity] = useState(true);
  const [showExpiry, setShowExpiry] = useState(false);
  const [showPurchaseDate, setShowPurchaseDate] = useState(false);
  const [showConsumeQr, setShowConsumeQr] = useState(true);
  const [countMode, setCountMode] = useState<PrintCountMode>("single");
  const [customCount, setCustomCount] = useState(1);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [openingPrint, setOpeningPrint] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(printSettingsKey) || "null") as Record<string, unknown> | null;
        if (!saved) return;
        if (saved.preset === "a4-portrait" || saved.preset === "a4-landscape" || saved.preset === "custom") setPreset(saved.preset);
        const restore = (value: unknown, min: number, max: number, setValue: (next: number) => void) => { const next = savedNumber(value, min, max); if (next != null) setValue(next); };
        restore(saved.customWidth, 40, 500, setCustomWidth); restore(saved.customHeight, 40, 500, setCustomHeight); restore(saved.columns, 1, 5, setColumns); restore(saved.qrSize, 80, 160, setQrSize); restore(saved.horizontalMargin, 0, 60, setHorizontalMargin); restore(saved.verticalMargin, 0, 60, setVerticalMargin); restore(saved.columnGap, 0, 40, setColumnGap); restore(saved.rowGap, 0, 40, setRowGap); restore(saved.labelWidth, 20, 200, setLabelWidth); restore(saved.labelHeight, 20, 200, setLabelHeight); const savedStartRow = savedNumber(saved.startRow, 1, 99); if (savedStartRow != null) setStartRow(Math.floor(savedStartRow));
        if (typeof saved.showLabelBorder === "boolean") setShowLabelBorder(saved.showLabelBorder);
        if (typeof saved.showLocation === "boolean") setShowLocation(saved.showLocation);
        if (typeof saved.showQuantity === "boolean") setShowQuantity(saved.showQuantity);
        if (typeof saved.showExpiry === "boolean") setShowExpiry(saved.showExpiry);
        if (typeof saved.showPurchaseDate === "boolean") setShowPurchaseDate(saved.showPurchaseDate);
        if (typeof saved.showConsumeQr === "boolean") setShowConsumeQr(saved.showConsumeQr);
        if (saved.countMode === "single" || saved.countMode === "inventory" || saved.countMode === "custom") setCountMode(saved.countMode);
        const savedCount = savedNumber(saved.customCount, 1, 999); if (savedCount != null) setCustomCount(Math.floor(savedCount));
      } catch {
        // Ignore malformed saved settings and keep the defaults.
      } finally {
        setSettingsLoaded(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    localStorage.setItem(printSettingsKey, JSON.stringify({ preset, customWidth, customHeight, columns, qrSize, horizontalMargin, verticalMargin, columnGap, rowGap, labelWidth, labelHeight, startRow, showLabelBorder, showLocation, showQuantity, showExpiry, showPurchaseDate, showConsumeQr, countMode, customCount }));
  }, [settingsLoaded, preset, customWidth, customHeight, columns, qrSize, horizontalMargin, verticalMargin, columnGap, rowGap, labelWidth, labelHeight, startRow, showLabelBorder, showLocation, showQuantity, showExpiry, showPurchaseDate, showConsumeQr, countMode, customCount]);

  const printableItems = useMemo(() => items.flatMap((item) => {
    const copies = countMode === "inventory" ? Math.max(1, Math.floor(item.quantity)) : countMode === "custom" ? Math.max(1, Math.floor(customCount)) : 1;
    return Array.from({ length: copies }, (_, copy) => ({ item, copy }));
  }), [items, countMode, customCount]);

  const paper = useMemo(() => preset === "a4-landscape" ? { width: 297, height: 210 } : preset === "custom" ? { width: customWidth, height: customHeight } : { width: 210, height: 297 }, [preset, customWidth, customHeight]);
  const usableWidth = Math.max(0, paper.width - horizontalMargin * 2);
  const fittedColumns = Math.min(columns, Math.max(1, Math.min(5, Math.floor((usableWidth + columnGap) / (20 + columnGap)))));
  const maxLabelWidth = Math.max(20, Math.round(((usableWidth - columnGap * (fittedColumns - 1)) / fittedColumns) * 10) / 10);
  const fittedLabelWidth = Math.min(labelWidth, maxLabelWidth);
  const layoutAdjusted = fittedColumns !== columns || fittedLabelWidth !== labelWidth;
  const skippedLabelSlots = (startRow - 1) * fittedColumns;
  useEffect(() => {
    if (!layoutAdjusted) return;
    const frame = requestAnimationFrame(() => { if (columns !== fittedColumns) setColumns(fittedColumns); if (labelWidth !== fittedLabelWidth) setLabelWidth(fittedLabelWidth); });
    return () => cancelAnimationFrame(frame);
  }, [columns, fittedColumns, labelWidth, fittedLabelWidth, layoutAdjusted]);
  const labelScale = Math.min(1, Math.max(.22, (labelHeight * 3) / (qrSize + 88)));
  const scaledQrSize = Math.max(18, Math.round(qrSize * labelScale));
  const scaledPadding = Math.max(2, Math.round(12 * labelScale));
  const scaledGap = Math.max(1, Math.round(8 * labelScale));
  const scaledNameSize = Math.max(7, 14 * labelScale);
  const scaledCodeSize = Math.max(5, 9 * labelScale);
  const scaledSummarySize = Math.max(6, 10 * labelScale);
  const qrGap = Math.max(2, Math.round(scaledGap / 2));
  const availableQrWidth = Math.max(24, Math.round(fittedLabelWidth * 3 - scaledPadding * 2));
  const labelQrSize = showConsumeQr ? Math.max(18, Math.min(scaledQrSize, Math.floor((availableQrWidth - qrGap) / 2))) : scaledQrSize;
  const printCss = `
    @media print {
      @page { size: ${paper.width}mm ${paper.height}mm; margin: 0; }
      html, body { width: ${paper.width}mm; min-height: ${paper.height}mm; background: white !important; }
      body * { visibility: hidden !important; }
      .print-sheet, .print-sheet * { visibility: visible !important; }
      .print-sheet { position: absolute !important; inset: 0 auto auto 0 !important; width: ${paper.width}mm !important; min-height: ${paper.height}mm !important; padding: ${verticalMargin}mm ${horizontalMargin}mm !important; display: grid !important; grid-template-columns: repeat(${fittedColumns}, ${fittedLabelWidth}mm) !important; column-gap: ${columnGap}mm !important; row-gap: ${rowGap}mm !important; align-content: start !important; background: white !important; color: black !important; box-shadow: none !important; }
      .print-label { width: ${fittedLabelWidth}mm !important; height: ${labelHeight}mm !important; break-inside: avoid; page-break-inside: avoid; border: ${showLabelBorder ? "0.25mm solid #d7d7dc" : "0"} !important; color: black !important; }
      .print-placeholder { width: ${fittedLabelWidth}mm !important; height: ${labelHeight}mm !important; break-inside: avoid; page-break-inside: avoid; }
    }
  `;

  const printFromIosPreview = () => {
    const sheet = sheetRef.current;
    const preview = window.open("", "_blank");
    if (!sheet || !preview) { window.print(); return; }
    setOpeningPrint(true);
    // The on-screen sheet uses pixel-based inline dimensions for a readable preview.
    // Strip those only in the standalone iOS document so the millimetre print CSS
    // below can accurately control the actual paper layout.
    const previewSheet = sheet.cloneNode(true) as HTMLDivElement;
    previewSheet.removeAttribute("style");
    previewSheet.querySelectorAll(".print-label, .print-placeholder").forEach((element) => element.removeAttribute("style"));
    const previewCss = `
      @page { size: ${paper.width}mm ${paper.height}mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { width: ${paper.width}mm; min-height: ${paper.height}mm; margin: 0; background: white; color: black; }
      .print-sheet { width: ${paper.width}mm; min-height: ${paper.height}mm; padding: ${verticalMargin}mm ${horizontalMargin}mm; display: grid; grid-template-columns: repeat(${fittedColumns}, ${fittedLabelWidth}mm); column-gap: ${columnGap}mm; row-gap: ${rowGap}mm; align-content: start; background: white; color: black; }
      .print-label { display: flex; width: ${fittedLabelWidth}mm; height: ${labelHeight}mm; flex-direction: column; align-items: center; overflow: hidden; break-inside: avoid; page-break-inside: avoid; color: black; border: ${showLabelBorder ? "0.25mm solid #d7d7dc" : "0"}; border-radius: 3mm; text-align: center; }
      .print-placeholder { width: ${fittedLabelWidth}mm; height: ${labelHeight}mm; break-inside: avoid; page-break-inside: avoid; }
      .flex { display: flex; } .flex-col { flex-direction: column; } .items-center { align-items: center; } .justify-center { justify-content: center; } .min-w-0 { min-width: 0; } .w-full { width: 100%; } .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .font-bold { font-weight: 700; } .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; } .text-gray-500 { color: #6b7280; } .text-gray-700 { color: #374151; }
    `;
    preview.document.open();
    preview.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>二维码打印预览</title><style>${previewCss}</style></head><body>${previewSheet.outerHTML}</body></html>`);
    preview.document.close();
    let triggered = false;
    const triggerPrint = () => {
      if (triggered) return;
      triggered = true;
      preview.focus();
      preview.print();
      setOpeningPrint(false);
    };
    preview.addEventListener("load", triggerPrint, { once: true });
    window.setTimeout(triggerPrint, 500);
  };
  const handlePrint = () => {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIos) { printFromIosPreview(); return; }
    window.print();
  };

  return <div className="fixed inset-0 z-[80] flex flex-col bg-black/45 backdrop-blur-sm lg:flex-row">
    <style>{printCss}</style>
    <aside className="print-controls z-10 w-full overflow-y-auto p-4 lg:h-screen lg:w-[360px]" style={{ background: "var(--surface-solid)" }}>
      <div className="flex items-start gap-3"><div className="flex-1"><h2 className="m-0 flex items-center gap-2 text-xl font-black"><Printer size={20} />二维码打印</h2><p className="mb-0 mt-1 text-xs muted">已选择 {items.length} 件物品，共 {printableItems.length} 个标签。</p></div><button onClick={onClose} className="btn-ghost grid size-9 place-items-center p-0"><X size={17} /></button></div>
      <div className="mt-6 space-y-5">
        <Control label="纸张规格"><select className="input" value={preset} onChange={(e) => setPreset(e.target.value as PaperPreset)}><option value="a4-portrait">A4 纵向</option><option value="a4-landscape">A4 横向</option><option value="custom">自定义尺寸</option></select></Control>
        {preset === "custom" && <div className="grid grid-cols-2 gap-3"><Control label="宽度 mm"><NumberInput value={customWidth} min={40} max={500} onChange={setCustomWidth} /></Control><Control label="高度 mm"><NumberInput value={customHeight} min={40} max={500} onChange={setCustomHeight} /></Control></div>}
        <div className="grid grid-cols-2 gap-3"><Control label="每行标签数"><select className="input" value={columns} onChange={(e) => setColumns(Number(e.target.value))}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} 列</option>)}</select></Control><Control label="二维码尺寸"><select className="input" value={qrSize} onChange={(e) => setQrSize(Number(e.target.value))}>{[80,96,112,128,144,160].map((value) => <option key={value} value={value}>{value}px</option>)}</select></Control></div>
        <div><div className="mb-2 flex items-center gap-2 text-xs font-bold muted"><Settings2 size={14} />标签大小</div><div className="grid grid-cols-2 gap-3"><Control label="标签宽度 mm"><NumberInput value={labelWidth} min={20} max={200} step="0.1" onChange={setLabelWidth} /></Control><Control label="标签高度 mm"><NumberInput value={labelHeight} min={20} max={200} step="0.1" onChange={setLabelHeight} /></Control></div>{layoutAdjusted && <p className="mb-0 mt-2 text-[11px] leading-5 text-amber-600">当前纸张最多容纳 {fittedColumns} 列，每张标签最大宽度 {maxLabelWidth} mm，已自动调整。</p>}{labelScale < 1 && <p className="mb-0 mt-2 text-[11px] leading-5 muted">标签较矮，二维码和文字已自动缩小以保留完整内容。</p>}</div>
        <div className="grid grid-cols-2 gap-3"><Control label="左右页边距 mm"><NumberInput value={horizontalMargin} min={0} max={60} step="0.1" onChange={setHorizontalMargin} /></Control><Control label="上下页边距 mm"><NumberInput value={verticalMargin} min={0} max={60} step="0.1" onChange={setVerticalMargin} /></Control></div>
        <div className="grid grid-cols-2 gap-3"><Control label="标签列间距 mm"><NumberInput value={columnGap} min={0} max={40} step="0.1" onChange={setColumnGap} /></Control><Control label="标签行间距 mm"><NumberInput value={rowGap} min={0} max={40} step="0.1" onChange={setRowGap} /></Control></div>
        <Control label="从第几行开始打印"><NumberInput value={startRow} min={1} max={99} integer onChange={setStartRow} /><span className="mt-1.5 block text-[11px] leading-5 muted">已用完第一行后，设为 2，标签会从第二行开始打印。</span></Control>
        <div><div className="mb-2 text-xs font-bold muted">每件物品打印数量</div><div className="grid grid-cols-[1fr_110px] gap-3"><select className="input" value={countMode} onChange={(e) => setCountMode(e.target.value as PrintCountMode)}><option value="single">每件 1 个标签</option><option value="inventory">按库存数量打印</option><option value="custom">统一指定数量</option></select>{countMode === "custom" ? <NumberInput value={customCount} min={1} max={999} integer onChange={setCustomCount} /> : <div className="input flex items-center text-xs muted">{countMode === "inventory" ? "按各自库存" : "1"}</div>}</div><p className="mb-0 mt-1.5 text-[11px] leading-5 muted">按库存时会使用每件物品的当前数量；指定数量会为每种物品打印相同份数。</p></div>
        <div><div className="mb-2 flex items-center gap-2 text-xs font-bold muted"><Settings2 size={14} />标签内容</div><div className="flex flex-wrap gap-2"><Toggle checked={showLabelBorder} onChange={setShowLabelBorder} label="二维码标签边框" /><Toggle checked={showConsumeQr} onChange={setShowConsumeQr} label="扫码消耗二维码" /><Toggle checked={showLocation} onChange={setShowLocation} label="存放位置" /><Toggle checked={showQuantity} onChange={setShowQuantity} label="数量" /><Toggle checked={showPurchaseDate} onChange={setShowPurchaseDate} label="购买日期" /><Toggle checked={showExpiry} onChange={setShowExpiry} label="到期日" /></div></div>
      </div>
      <button onClick={handlePrint} disabled={openingPrint} className="btn-primary mt-7 flex w-full items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-70"><Printer size={18} />{openingPrint ? "正在打开打印预览…" : "打印 / 保存 PDF"}</button>
      <p className="mt-3 text-[11px] leading-5 muted">打印对话框中请选择“实际大小”或 100% 缩放。iPhone/iPad 会先打开打印预览；若未自动弹窗，可点浏览器分享菜单里的“打印”。</p>
    </aside>
    <div className="flex-1 overflow-auto p-4 lg:p-8" style={{ background: "#d9dae0" }}>
      <div ref={sheetRef} className="print-sheet mx-auto grid content-start bg-white text-black shadow-2xl" style={{ width: `${paper.width * 3}px`, minHeight: `${paper.height * 3}px`, padding: `${verticalMargin * 3}px ${horizontalMargin * 3}px`, gridTemplateColumns: `repeat(${fittedColumns}, ${fittedLabelWidth * 3}px)`, columnGap: `${columnGap * 3}px`, rowGap: `${rowGap * 3}px` }}>
        {Array.from({ length: skippedLabelSlots }, (_, index) => <div key={`placeholder-${index}`} aria-hidden="true" className="print-placeholder" style={{ width: `${fittedLabelWidth * 3}px`, height: `${labelHeight * 3}px` }} />)}
        {printableItems.map(({ item, copy }) => <div key={`${item.id}-${copy}`} className={`print-label flex min-w-0 flex-col items-center rounded-xl text-center ${showLabelBorder ? "border border-gray-300" : "border-0"}`} style={{ width: `${fittedLabelWidth * 3}px`, height: `${labelHeight * 3}px`, padding: `${scaledPadding}px` }}><div className="flex items-start justify-center" style={{ gap: `${qrGap}px` }}>{item.type === "CONSUMABLE" && showConsumeQr ? <><div className="flex min-w-0 flex-col items-center"><QRCodeSVG value={`${globalThis.location?.origin || ""}/items/${item.id}`} size={labelQrSize} level="M" includeMargin /><span className="font-bold text-gray-500" style={{ marginTop: Math.max(1, Math.round(scaledGap / 3)), fontSize: `${scaledCodeSize}px`, lineHeight: 1 }}>查看</span></div><div className="flex min-w-0 flex-col items-center"><QRCodeSVG value={`${globalThis.location?.origin || ""}/consume/${item.id}`} size={labelQrSize} level="M" includeMargin /><span className="font-bold" style={{ marginTop: Math.max(1, Math.round(scaledGap / 3)), color: "#dc2626", fontSize: `${scaledCodeSize}px`, lineHeight: 1 }}>消耗1{item.unit}</span></div></> : <div className="flex min-w-0 flex-col items-center"><QRCodeSVG value={`${globalThis.location?.origin || ""}/items/${item.id}`} size={scaledQrSize} level="M" includeMargin /><span className="font-bold text-gray-500" style={{ marginTop: Math.max(1, Math.round(scaledGap / 3)), fontSize: `${scaledCodeSize}px`, lineHeight: 1 }}>查看</span></div>}</div><div className="w-full truncate font-bold" style={{ marginTop: scaledGap, fontSize: `${scaledNameSize}px`, lineHeight: 1.2 }}>{item.name}</div><div className="w-full truncate font-mono text-gray-500" style={{ marginTop: Math.max(1, Math.round(scaledGap / 2)), fontSize: `${scaledCodeSize}px`, lineHeight: 1.2 }}>{item.itemCode || item.id}</div><div className="w-full text-gray-700" style={{ marginTop: scaledGap, fontSize: `${scaledSummarySize}px`, lineHeight: 1.35 }}>{item.category}{showLocation && ` · ${item.location?.name || "未设置位置"}`}{showQuantity && ` · ${item.quantity}${item.unit}`}{showPurchaseDate && item.purchaseDate && <><br />购买：{new Date(item.purchaseDate).toLocaleDateString("zh-CN")}</>}{showExpiry && item.type === "CONSUMABLE" && item.expiryDate && <><br />到期：{new Date(item.expiryDate).toLocaleDateString("zh-CN")}</>}</div></div>)}
      </div>
    </div>
  </div>;
}

function Control({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold muted">{label}</span>{children}</label>; }
function NumberInput({ value, min, max, step = "1", integer = false, onChange }: { value: number; min: number; max: number; step?: string; integer?: boolean; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { if (Number(draft) !== value) setDraft(String(value)); }, [value]);
  const commit = (raw: string) => { const parsed = Number(raw); if (!Number.isFinite(parsed)) { setDraft(String(value)); return; } onChange(Math.min(max, Math.max(min, integer ? Math.floor(parsed) : parsed))); };
  return <input className="input" type="text" inputMode={integer ? "numeric" : "decimal"} autoComplete="off" value={draft} onChange={(event) => { const next = event.target.value; if (next === "" || (integer ? /^\d*$/.test(next) : /^\d*(?:\.\d*)?$/.test(next))) setDraft(next); }} onBlur={() => commit(draft)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(draft); event.currentTarget.blur(); } }} onFocus={(event) => event.currentTarget.select()} aria-valuemin={min} aria-valuemax={max} step={step} />;
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) { return <button type="button" onClick={() => onChange(!checked)} className="rounded-xl px-3 py-2 text-xs font-bold" style={checked ? { background: "var(--primary)", color: "white" } : { background: "var(--surface-soft)", color: "var(--muted)" }}>{label}</button>; }
