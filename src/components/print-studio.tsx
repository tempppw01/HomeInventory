"use client";

import { Printer, Settings2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useMemo, useState } from "react";
import type { Item } from "@/types";

type PaperPreset = "a4-portrait" | "a4-landscape" | "custom";

export function PrintStudio({ items, onClose }: { items: Item[]; onClose: () => void }) {
  const [preset, setPreset] = useState<PaperPreset>("a4-portrait");
  const [customWidth, setCustomWidth] = useState(210);
  const [customHeight, setCustomHeight] = useState(297);
  const [columns, setColumns] = useState(3);
  const [qrSize, setQrSize] = useState(112);
  const [margin, setMargin] = useState(10);
  const [gap, setGap] = useState(5);
  const [showLocation, setShowLocation] = useState(true);
  const [showQuantity, setShowQuantity] = useState(true);
  const [showExpiry, setShowExpiry] = useState(false);

  const paper = useMemo(() => preset === "a4-landscape" ? { width: 297, height: 210 } : preset === "custom" ? { width: customWidth, height: customHeight } : { width: 210, height: 297 }, [preset, customWidth, customHeight]);
  const printCss = `
    @media print {
      @page { size: ${paper.width}mm ${paper.height}mm; margin: 0; }
      html, body { width: ${paper.width}mm; min-height: ${paper.height}mm; background: white !important; }
      body * { visibility: hidden !important; }
      .print-sheet, .print-sheet * { visibility: visible !important; }
      .print-sheet { position: absolute !important; inset: 0 auto auto 0 !important; width: ${paper.width}mm !important; min-height: ${paper.height}mm !important; padding: ${margin}mm !important; display: grid !important; grid-template-columns: repeat(${columns}, minmax(0, 1fr)) !important; gap: ${gap}mm !important; align-content: start !important; background: white !important; color: black !important; box-shadow: none !important; }
      .print-label { break-inside: avoid; page-break-inside: avoid; border: 0.25mm solid #d7d7dc !important; color: black !important; }
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
        <div className="grid grid-cols-2 gap-3"><Control label="页边距 mm"><input className="input" type="number" min="0" max="30" value={margin} onChange={(e) => setMargin(Number(e.target.value))} /></Control><Control label="标签间距 mm"><input className="input" type="number" min="0" max="20" value={gap} onChange={(e) => setGap(Number(e.target.value))} /></Control></div>
        <div><div className="mb-2 flex items-center gap-2 text-xs font-bold muted"><Settings2 size={14} />摘要内容</div><div className="flex flex-wrap gap-2"><Toggle checked={showLocation} onChange={setShowLocation} label="存放位置" /><Toggle checked={showQuantity} onChange={setShowQuantity} label="数量" /><Toggle checked={showExpiry} onChange={setShowExpiry} label="到期日" /></div></div>
      </div>
      <button onClick={() => window.print()} className="btn-primary mt-7 flex w-full items-center justify-center gap-2"><Printer size={18} />打印 / 保存 PDF</button>
      <p className="mt-3 text-[11px] leading-5 muted">打印对话框中请选择“实际大小”或 100% 缩放。物品较多时浏览器会自动分页，每页保持相同布局。</p>
    </aside>
    <div className="flex-1 overflow-auto p-4 lg:p-8" style={{ background: "#d9dae0" }}>
      <div className="print-sheet mx-auto grid content-start bg-white text-black shadow-2xl" style={{ width: `${paper.width * 3}px`, minHeight: `${paper.height * 3}px`, padding: `${margin * 3}px`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${gap * 3}px` }}>
        {items.map((item) => <div key={item.id} className="print-label flex min-w-0 flex-col items-center rounded-xl border border-gray-300 p-3 text-center"><QRCodeSVG value={`${globalThis.location?.origin || ""}/items/${item.id}`} size={qrSize} level="M" includeMargin /><div className="mt-2 w-full truncate text-sm font-bold">{item.name}</div><div className="mt-1 w-full truncate font-mono text-[9px] text-gray-500">{item.itemCode || item.id}</div><div className="mt-2 w-full text-[10px] leading-4 text-gray-700">{item.category}{showLocation && ` · ${item.location?.name || "未设置位置"}`}{showQuantity && ` · ${item.quantity}${item.unit}`}{showExpiry && item.type === "CONSUMABLE" && item.expiryDate && <><br />到期：{new Date(item.expiryDate).toLocaleDateString("zh-CN")}</>}</div></div>)}
      </div>
    </div>
  </div>;
}

function Control({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold muted">{label}</span>{children}</label>; }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) { return <button type="button" onClick={() => onChange(!checked)} className="rounded-xl px-3 py-2 text-xs font-bold" style={checked ? { background: "var(--primary)", color: "white" } : { background: "var(--surface-soft)", color: "var(--muted)" }}>{label}</button>; }
