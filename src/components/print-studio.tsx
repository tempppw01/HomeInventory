"use client";

import { Printer, Settings2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";
import type { Item } from "@/types";

type PaperPreset = "a4-portrait" | "a4-landscape" | "custom";
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
  const [settingsLoaded, setSettingsLoaded] = useState(false);

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
    localStorage.setItem(printSettingsKey, JSON.stringify({ preset, customWidth, customHeight, columns, qrSize, horizontalMargin, verticalMargin, columnGap, rowGap, labelWidth, labelHeight, startRow, showLabelBorder, showLocation, showQuantity, showExpiry }));
  }, [settingsLoaded, preset, customWidth, customHeight, columns, qrSize, horizontalMargin, verticalMargin, columnGap, rowGap, labelWidth, labelHeight, startRow, showLabelBorder, showLocation, showQuantity, showExpiry]);

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

  return <div className="fixed inset-0 z-[80] flex flex-col bg-black/45 backdrop-blur-sm lg:flex-row">
    <style>{printCss}</style>
    <aside className="print-controls z-10 w-full overflow-y-auto p-4 lg:h-screen lg:w-[360px]" style={{ background: "var(--surface-solid)" }}>
      <div className="flex items-start gap-3"><div className="flex-1"><h2 className="m-0 flex items-center gap-2 text-xl font-black"><Printer size={20} />二维码打印</h2><p className="mb-0 mt-1 text-xs muted">已选择 {items.length} 件物品，可在一页排版多个标签。</p></div><button onClick={onClose} className="btn-ghost grid size-9 place-items-center p-0"><X size={17} /></button></div>
      <div className="mt-6 space-y-5">
        <Control label="纸张规格"><select className="input" value={preset} onChange={(e) => setPreset(e.target.value as PaperPreset)}><option value="a4-portrait">A4 纵向</option><option value="a4-landscape">A4 横向</option><option value="custom">自定义尺寸</option></select></Control>
        {preset === "custom" && <div className="grid grid-cols-2 gap-3"><Control label="宽度 mm"><input className="input" type="number" min="40" max="500" value={customWidth} onChange={(e) => setCustomWidth(Number(e.target.value))} /></Control><Control label="高度 mm"><input className="input" type="number" min="40" max="500" value={customHeight} onChange={(e) => setCustomHeight(Number(e.target.value))} /></Control></div>}
        <div className="grid grid-cols-2 gap-3"><Control label="每行标签数"><select className="input" value={columns} onChange={(e) => setColumns(Number(e.target.value))}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} 列</option>)}</select></Control><Control label="二维码尺寸"><select className="input" value={qrSize} onChange={(e) => setQrSize(Number(e.target.value))}>{[80,96,112,128,144,160].map((value) => <option key={value} value={value}>{value}px</option>)}</select></Control></div>
        <div><div className="mb-2 flex items-center gap-2 text-xs font-bold muted"><Settings2 size={14} />标签大小</div><div className="grid grid-cols-2 gap-3"><Control label="标签宽度 mm"><input className="input" type="number" min="20" max="200" step="0.1" value={labelWidth} onChange={(e) => setLabelWidth(Number(e.target.value))} /></Control><Control label="标签高度 mm"><input className="input" type="number" min="20" max="200" step="0.1" value={labelHeight} onChange={(e) => setLabelHeight(Number(e.target.value))} /></Control></div>{layoutAdjusted && <p className="mb-0 mt-2 text-[11px] leading-5 text-amber-600">当前纸张最多容纳 {fittedColumns} 列，每张标签最大宽度 {maxLabelWidth} mm，已自动调整。</p>}{labelScale < 1 && <p className="mb-0 mt-2 text-[11px] leading-5 muted">标签较矮，二维码和文字已自动缩小以保留完整内容。</p>}</div>
        <div className="grid grid-cols-2 gap-3"><Control label="左右页边距 mm"><input className="input" type="number" min="0" max="60" step="0.1" value={horizontalMargin} onChange={(e) => setHorizontalMargin(Number(e.target.value))} /></Control><Control label="上下页边距 mm"><input className="input" type="number" min="0" max="60" step="0.1" value={verticalMargin} onChange={(e) => setVerticalMargin(Number(e.target.value))} /></Control></div>
        <div className="grid grid-cols-2 gap-3"><Control label="标签列间距 mm"><input className="input" type="number" min="0" max="40" step="0.1" value={columnGap} onChange={(e) => setColumnGap(Number(e.target.value))} /></Control><Control label="标签行间距 mm"><input className="input" type="number" min="0" max="40" step="0.1" value={rowGap} onChange={(e) => setRowGap(Number(e.target.value))} /></Control></div>
        <Control label="从第几行开始打印"><input className="input" type="number" min="1" max="99" step="1" value={startRow} onChange={(e) => setStartRow(Math.max(1, Math.floor(Number(e.target.value))))} /><span className="mt-1.5 block text-[11px] leading-5 muted">已用完第一行后，设为 2，标签会从第二行开始打印。</span></Control>
        <div><div className="mb-2 flex items-center gap-2 text-xs font-bold muted"><Settings2 size={14} />标签内容</div><div className="flex flex-wrap gap-2"><Toggle checked={showLabelBorder} onChange={setShowLabelBorder} label="二维码标签边框" /><Toggle checked={showLocation} onChange={setShowLocation} label="存放位置" /><Toggle checked={showQuantity} onChange={setShowQuantity} label="数量" /><Toggle checked={showExpiry} onChange={setShowExpiry} label="到期日" /></div></div>
      </div>
      <button onClick={() => window.print()} className="btn-primary mt-7 flex w-full items-center justify-center gap-2"><Printer size={18} />打印 / 保存 PDF</button>
      <p className="mt-3 text-[11px] leading-5 muted">打印对话框中请选择“实际大小”或 100% 缩放。物品较多时浏览器会自动分页，每页保持相同布局。</p>
    </aside>
    <div className="flex-1 overflow-auto p-4 lg:p-8" style={{ background: "#d9dae0" }}>
      <div className="print-sheet mx-auto grid content-start bg-white text-black shadow-2xl" style={{ width: `${paper.width * 3}px`, minHeight: `${paper.height * 3}px`, padding: `${verticalMargin * 3}px ${horizontalMargin * 3}px`, gridTemplateColumns: `repeat(${fittedColumns}, ${fittedLabelWidth * 3}px)`, columnGap: `${columnGap * 3}px`, rowGap: `${rowGap * 3}px` }}>
        {Array.from({ length: skippedLabelSlots }, (_, index) => <div key={`placeholder-${index}`} aria-hidden="true" className="print-placeholder" style={{ width: `${fittedLabelWidth * 3}px`, height: `${labelHeight * 3}px` }} />)}
        {items.map((item) => <div key={item.id} className={`print-label flex min-w-0 flex-col items-center rounded-xl text-center ${showLabelBorder ? "border border-gray-300" : "border-0"}`} style={{ width: `${fittedLabelWidth * 3}px`, height: `${labelHeight * 3}px`, padding: `${scaledPadding}px` }}><QRCodeSVG value={`${globalThis.location?.origin || ""}/items/${item.id}`} size={scaledQrSize} level="M" includeMargin /><div className="w-full truncate font-bold" style={{ marginTop: scaledGap, fontSize: `${scaledNameSize}px`, lineHeight: 1.2 }}>{item.name}</div><div className="w-full truncate font-mono text-gray-500" style={{ marginTop: Math.max(1, Math.round(scaledGap / 2)), fontSize: `${scaledCodeSize}px`, lineHeight: 1.2 }}>{item.itemCode || item.id}</div><div className="w-full text-gray-700" style={{ marginTop: scaledGap, fontSize: `${scaledSummarySize}px`, lineHeight: 1.35 }}>{item.category}{showLocation && ` · ${item.location?.name || "未设置位置"}`}{showQuantity && ` · ${item.quantity}${item.unit}`}{showExpiry && item.type === "CONSUMABLE" && item.expiryDate && <><br />到期：{new Date(item.expiryDate).toLocaleDateString("zh-CN")}</>}</div></div>)}
      </div>
    </div>
  </div>;
}

function Control({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold muted">{label}</span>{children}</label>; }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) { return <button type="button" onClick={() => onChange(!checked)} className="rounded-xl px-3 py-2 text-xs font-bold" style={checked ? { background: "var(--primary)", color: "white" } : { background: "var(--surface-soft)", color: "var(--muted)" }}>{label}</button>; }
