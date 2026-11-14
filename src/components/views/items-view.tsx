"use client";

import { motion } from "motion/react";
import {
  Check, CheckSquare, ChevronDown, ImagePlus, Minus, MoreHorizontal, Plus, Printer, QrCode, Search, ShoppingBasket, Sparkles, Copy, Pencil, Trash2, X,
} from "lucide-react";
import { useContext, useState } from "react";
import type { Item, Location, ShoppingItem } from "@/types";
import { SearchBox } from "@/components/search-box";
import { BatchEditModal } from "@/components/batch-edit-modal";
import { isLiquidConsumable } from "@/lib/item-metrics";
import { itemAiHighlights } from "@/lib/item-ai";
import { ContextMenu, useContextMenu, ContextMenuItem } from "@/components/context-menu";
import { isMedicineCategory, medicineCategoryLabel } from "@/lib/categories";
import { Field } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { ReadOnlyContext, ItemQuickFilter, request, PageTitle, EmptyState } from "../shared";
import { Modal } from "./modals";
export function ItemsView({ allItems, locations, items, shopping, search, setSearch, filter, setFilter, categoryFilter, setCategoryFilter, onEdit, onOpenDetail, onImageUpload, onDuplicate, onConsume, onRemainingChange, onDelete, onQr, onAi, onPrint, onToast, onCopy, onToggleShopping, onFavoriteShopping, onAddShopping, onDeleteShopping, onBatchAi }: { allItems: Item[]; locations: Location[]; items: Item[]; shopping: ShoppingItem[]; search: string; setSearch: (s: string) => void; filter: ItemQuickFilter; setFilter: (f: ItemQuickFilter) => void; categoryFilter: string; setCategoryFilter: (f: string) => void; onEdit: (i: Item) => void; onOpenDetail: (i: Item) => void; onImageUpload: (i: Item, file?: File) => void; onDuplicate: (i: Item) => void; onConsume: (i: Item) => void; onRemainingChange: (item: Item, remainingPercent: number) => void; onDelete: (i: Item) => void; onQr: (i: Item) => void; onAi: (i: Item) => void; onPrint: (items: Item[]) => void; onToast: (message: string) => void; onCopy: (i: Item) => void; onToggleShopping: (item: ShoppingItem) => void; onFavoriteShopping: (item: ShoppingItem) => void; onAddShopping: () => void; onDeleteShopping: (id: string) => void; onBatchAi: () => void }) {
  const askConfirm = useConfirm();
  const readOnly = useContext(ReadOnlyContext);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 勾选只在「选择模式」下出现:平时每张卡片少一个控件,界面更安静。
  const [selectMode, setSelectMode] = useState(false);
  const [bulkLocationOpen, setBulkLocationOpen] = useState(false);
  const [bulkLocationId, setBulkLocationId] = useState("");
    const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const selectedItems = allItems.filter((item) => selected.has(item.id));
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selectVisible = () => setSelected(new Set(items.map((item) => item.id)));
  const bulk = async (body: Record<string, unknown>, successMessage = "批量更新完成") => { try { await request("/api/items/bulk", { method: "PATCH", body: JSON.stringify({ ...body, ids: [...selected] }) }); setSelected(new Set()); setBulkLocationOpen(false); onToast(successMessage); } catch (error) { onToast(error instanceof Error ? error.message : "批量更新失败"); } };
  const bulkDelete = async () => { if (!(await askConfirm(`确定将选中的 ${selected.size} 件物品移入回收站吗?可以稍后在回收站恢复。`, { title: "移入回收站", confirmLabel: "移入回收站" }))) return; try { await request("/api/items/bulk", { method: "DELETE", body: JSON.stringify({ ids: [...selected] }) }); setSelected(new Set()); onToast("已移入回收站"); } catch (error) { onToast(error instanceof Error ? error.message : "批量删除失败"); } };
  const pendingShopping = shopping.filter((item) => item.status === "PENDING");
  const presentCategories = Array.from(new Set(allItems.map((item) => item.category).filter(Boolean)));
  const medicineCategories = presentCategories.filter(isMedicineCategory);
  const categoryOptions = filter === "MEDICINE"
    ? ["MEDICINE", ...medicineCategories]
    : ["ALL", ...presentCategories.filter((category) => !isMedicineCategory(category))];
  return <><PageTitle title="物品与采购" text="知道家里有什么，也记得还要买什么。" action={<>{!readOnly && <button onClick={onBatchAi} className="btn-ghost flex items-center gap-1.5 text-xs" aria-label="AI 批量识别物品" title="上传多张照片或小票,AI 生成草稿后批量入库"><Sparkles size={15} /><span className="desktop-only">批量识别</span></button>}{!readOnly && <button onClick={onAddShopping} className="btn-ghost flex items-center gap-1.5 text-xs" aria-label="添加采购项"><ShoppingBasket size={15} /><span className="desktop-only">添加采购项</span></button>}</>} />
    <div className="mb-4 space-y-3"><div className="md:hidden"><SearchBox items={allItems} value={search} onChange={setSearch} onSelect={(item) => setSearch(item.name)} placeholder="搜索名称或物品编号…" /></div>{!selectMode ? <div className="flex min-w-0 items-center gap-3 overflow-x-auto pb-1"><div className="flex shrink-0 rounded-xl p-1" style={{ background: "var(--surface-soft)" }}>{([ ["ALL", "全部"], ["DURABLE", "耐用品"], ["CONSUMABLE", "消耗品"], ["MEDICINE", "医药"] ] as const).map(([id, label]) => <button key={id} onClick={() => setFilter(id)} className="rounded-lg px-3 py-1.5 text-sm font-bold transition" style={filter === id ? { background: "var(--surface-solid)", color: "var(--primary)", boxShadow: "var(--shadow-sm)" } : { color: "var(--muted)" }}>{label}</button>)}</div><span className="shrink-0 text-xs muted">{items.length} 件</span><span className="h-5 w-px shrink-0" style={{ background: "var(--border)" }} /><button onClick={() => setSelectMode(true)} disabled={items.length === 0} className="flex shrink-0 items-center gap-1.5 text-xs font-bold muted transition hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"><CheckSquare size={15} />选择</button></div> : <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1"><span className="shrink-0 text-xs font-black" style={{ color: "var(--primary)" }}>已选 {selected.size} 件</span><span className="h-5 w-px shrink-0" style={{ background: "var(--border)" }} /><button onClick={selectVisible} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">全选</button><button onClick={() => bulk({ category: items.find((item) => selected.has(item.id))?.category || "日用" })} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">沿用分类</button><button onClick={() => { setBulkLocationId(selectedItems[0]?.locationId ?? ""); setBulkLocationOpen(true); }} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">批量移动位置</button><button onClick={() => setBulkEditOpen(true)} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">批量编辑</button><button onClick={() => onPrint(selectedItems)} className="btn-primary flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs"><Printer size={15} />打印二维码</button><button onClick={bulkDelete} className="btn-ghost shrink-0 px-3 py-1.5 text-xs text-red-500">移入回收站</button><button onClick={() => { setSelected(new Set()); setSelectMode(false); }} className="shrink-0 px-2 py-1.5 text-xs font-bold muted hover:text-[var(--foreground)]">完成</button></div>}</div>
    <div className="browse-layout"><nav className="browse-rail" aria-label="物品分类">{categoryOptions.map((category) => { const count = category === "ALL" ? allItems.length : category === "MEDICINE" ? allItems.filter((item) => isMedicineCategory(item.category)).length : allItems.filter((item) => item.category === category).length; return <button key={category} type="button" className="browse-rail-item" data-active={categoryFilter === category} onClick={() => setCategoryFilter(category)}><span>{category === "ALL" ? "全部分类" : category === "MEDICINE" ? "医药（按用途）" : isMedicineCategory(category) ? medicineCategoryLabel(category) : category}</span><span className="browse-rail-count">{count}</span></button>; })}</nav><div className="min-w-0">{items.length ? <><div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{items.map((item, index) => <motion.div className="h-full min-w-0" key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.05, 0.2) }}><ItemCard item={item} selected={selected.has(item.id)} showSelect={selectMode} onSelect={() => toggle(item.id)} onEdit={() => onEdit(item)} onOpenDetail={() => onOpenDetail(item)} onImageUpload={(file) => onImageUpload(item, file)} onDuplicate={() => void onDuplicate(item)} onConsume={() => onConsume(item)} onRemainingChange={(remainingPercent) => onRemainingChange(item, remainingPercent)} onDelete={() => onDelete(item)} onQr={() => onQr(item)} onAi={() => onAi(item)} onCopy={() => onCopy(item)} /></motion.div>)}</div></> : <div className="surface rounded-3xl py-16"><EmptyState icon={Search} title="没有找到物品" text="换个关键词或筛选条件试试" /></div>}</div></div>
    <details className="surface group mt-6 rounded-3xl p-5">
    <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><ShoppingBasket size={20} /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-black">采购清单</span><span className="mt-1 block truncate text-xs muted">{pendingShopping.length ? `${pendingShopping.length} 项等你顺路带回家` : "暂时没有需要采购的东西"}</span></span>
      <ChevronDown size={17} className="shrink-0 muted transition-transform group-open:rotate-180" />
    </summary>
    <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--hairline)" }}><div className="mb-3"><h2 className="m-0 text-base font-black">采购清单</h2><p className="mb-0 mt-1 text-xs muted">{pendingShopping.length ? `${pendingShopping.length} 项等你顺路带回家` : "暂时没有需要采购的东西"}</p></div>{pendingShopping.length ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{pendingShopping.map((item) => <ShoppingRow key={item.id} item={item} onToggle={() => onToggleShopping(item)} onFavorite={() => onFavoriteShopping(item)} onDelete={() => onDeleteShopping(item.id)} />)}</div> : <p className="mb-0 text-xs muted">需要添置时，使用页面右上角的采购按钮记下来。</p>}
    </div>
  </details>
    {bulkLocationOpen && <Modal title="批量移动位置" subtitle={`已选 ${selected.size} 件物品，统一移动到新的存放位置。`} onClose={() => setBulkLocationOpen(false)}><div className="space-y-4"><Field label="新的存放位置"><select autoFocus className="input" value={bulkLocationId} onChange={(e) => setBulkLocationId(e.target.value)}>{[{ id: "", name: "未设置 / 清空位置" }, ...locations].map((location) => <option key={location.id || "empty"} value={location.id}>{location.name}</option>)}</select></Field><p className="m-0 text-xs muted">确认后会更新全部已选物品的存放位置。</p><div className="flex gap-3 pt-2"><button type="button" onClick={() => setBulkLocationOpen(false)} className="btn-ghost flex-1">取消</button><button type="button" onClick={() => void bulk({ locationId: bulkLocationId || null }, "批量移动位置已完成")} className="btn-primary flex-1">确认移动</button></div></div></Modal>}
    {bulkEditOpen && <BatchEditModal selectedCount={selected.size} initialCategory={selectedItems[0]?.category || "日用"} initialLocationId={selectedItems[0]?.locationId ?? ""} locations={locations} onClose={() => setBulkEditOpen(false)} onApply={(updates) => { void bulk(updates, "批量编辑已完成"); setBulkEditOpen(false); }} />}
  </>;
}

export function ItemCard({ item, onEdit, onOpenDetail, onImageUpload, onDuplicate, onConsume, onRemainingChange, onDelete, onQr, onAi, onCopy, onSelect, selected = false, showSelect = false, compact = false }: { item: Item; onEdit: () => void; onOpenDetail?: () => void; onImageUpload?: (file: File) => void; onDuplicate?: () => void; onConsume: () => void; onRemainingChange?: (remainingPercent: number) => void; onDelete?: () => void; onQr: () => void; onAi: () => void; onCopy?: () => void; onSelect?: () => void; selected?: boolean; showSelect?: boolean; compact?: boolean }) {
  const low = item.type === "CONSUMABLE" && ((item.minQuantity > 0 && item.quantity <= item.minQuantity) || (isLiquidConsumable(item) && item.remainingPercent <= 20));
  const emoji = isMedicineCategory(item.category) ? "💊" : ({ 食品: "🍚", 饮品: "🥛", 清洁: "🧴", 家电: "📺", 数码: "💻", 衣物: "👕", 户外: "⛺" } as Record<string, string>)[item.category] || "📦";
  const readOnly = useContext(ReadOnlyContext);
  const ai = itemAiHighlights(item);
  const isMedicine = isMedicineCategory(item.category);
  const showRemaining = !compact && isLiquidConsumable(item) && onRemainingChange;
  const context = useContextMenu();
  const contextItems: ContextMenuItem[] = [{ label: "编辑物品", icon: Pencil, onClick: onEdit, disabled: readOnly }, ...(onDuplicate ? [{ label: "复制为新物品", icon: Copy, onClick: onDuplicate, disabled: readOnly }] : []), ...(onCopy ? [{ label: "复制物品编号", icon: Copy, onClick: onCopy }] : []), { label: "显示二维码", icon: QrCode, onClick: onQr }, { label: isMedicine ? "AI 补全药品说明" : "AI 识别与建议", icon: Sparkles, onClick: onAi }];
  if (!compact && item.type === "CONSUMABLE" && !isLiquidConsumable(item)) contextItems.push({ label: "用掉 1 个单位", icon: Minus, onClick: onConsume, disabled: readOnly, separatorBefore: true });
  if (onDelete) contextItems.push({ label: "移入回收站", icon: Trash2, onClick: onDelete, disabled: readOnly, danger: true, separatorBefore: true });
  return <><div onContextMenu={context.onContextMenu} className={`group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl transition-transform duration-200 active:scale-[.99] ${compact ? "p-3" : "p-3.5"} ${selected ? "" : "hover:-translate-y-0.5"}`} style={{ background: "var(--surface-solid)", boxShadow: selected ? "inset 0 0 0 2px var(--primary)" : "var(--shadow-sm)" }}>
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <label className={`${compact ? "size-11 text-lg" : "size-12 text-xl"} relative grid shrink-0 cursor-pointer place-items-center rounded-2xl bg-cover bg-center`} style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : { background: "var(--surface-soft)" }} title="点击上传物品照片">{!item.imageUrl && emoji}{onImageUpload && <><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImageUpload(file); event.currentTarget.value = ""; }} /><span className="pointer-events-none absolute inset-0 grid place-items-center rounded-2xl bg-black/35 text-white opacity-0 transition group-hover:opacity-100"><ImagePlus size={16} /></span></>}</label>
      <div className="min-w-0 flex-1 pr-9">
        <div className="flex min-w-0 items-start gap-2">
          <button type="button" onClick={onOpenDetail} className="min-w-0 flex-1 truncate text-left text-sm font-extrabold hover:underline">{item.name}</button>
          {ai.hasHighlights && <Sparkles size={12} className="mt-1 shrink-0" style={{ color: "var(--primary)" }} aria-label="有 AI 信息" />}
          <span className="shrink-0 text-sm font-black tabular-nums">{item.quantity}<span className="ml-0.5 text-xs font-normal muted">{item.unit}</span></span>
        </div>
        <p className="mb-0 mt-1 flex min-w-0 items-center gap-1.5 text-xs muted">
          <span className="min-w-0 truncate">{[item.location?.name || "未设置位置", item.category, item.type === "CONSUMABLE" ? "消耗品" : "耐用品"].join(" · ")}</span>
          {low && <span className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold" style={{ background: "var(--warning-soft, #fff4dc)", color: "var(--warning)" }}>需补货</span>}
        </p>
      </div>
      {showRemaining && <RemainingLevel value={item.remainingPercent} onChange={onRemainingChange} />}
    </div>
    {!readOnly && showSelect && onSelect && <button onClick={onSelect} className={`icon-action absolute left-1 top-1 z-10 backdrop-blur-sm ${selected ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"}`} style={{ background: selected ? "var(--primary)" : "color-mix(in srgb, var(--surface-solid) 88%, transparent)", color: selected ? "var(--on-primary)" : "var(--muted)" }} aria-label={selected ? "取消选择" : "选择物品"} title={selected ? "取消选择" : "选择物品"}>{selected ? <X size={15} /> : <CheckSquare size={15} />}</button>}
    <button type="button" onClick={(event) => context.onContextMenu(event)} className="icon-action absolute right-1 top-1" aria-haspopup="menu" aria-label="更多操作" title="更多操作"><MoreHorizontal size={16} /></button>
  </div><ContextMenu menu={context.menu} items={contextItems} onClose={context.close} /></>;
}

export function RemainingLevel({ value, onChange }: { value: number; onChange: (remainingPercent: number) => void }) {
  const normalized = Math.min(100, Math.max(0, Math.round(value)));
  const [drag, setDrag] = useState<{ startY: number; startValue: number } | null>(null);
  const [draftLevel, setDraftLevel] = useState<number | null>(null);
  const level = draftLevel ?? normalized;
  const clamp = (next: number) => Math.min(100, Math.max(0, next));
  const valueAt = (clientY: number, rect: DOMRect) => clamp(drag ? drag.startValue + ((drag.startY - clientY) / rect.height) * 100 : normalized);
  // 直接操纵(apple-design §2):按下瞬间不改数值,记住抓取偏移后与指针 1:1 跟随;
  // 松手才量化到 5% 并提交,拖动过程不做台阶式跳动。
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ startY: event.clientY, startValue: normalized });
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setDraftLevel(Math.round(valueAt(event.clientY, event.currentTarget.getBoundingClientRect())));
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const next = valueAt(event.clientY, event.currentTarget.getBoundingClientRect());
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
    setDraftLevel(null);
    onChange(Math.round(next / 5) * 5);
  };
  const color = level <= 20 ? "var(--danger)" : level <= 45 ? "var(--warning)" : "var(--primary)";
  return <div className="flex shrink-0 flex-col items-center" onClick={(event) => event.stopPropagation()}>
    <div role="slider" tabIndex={0} aria-label={`${level}% 剩余量,上下拖动调整`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={level} title="上下拖动调整剩余量" className="relative h-[70px] w-10 touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => { setDrag(null); setDraftLevel(null); }} onKeyDown={(event) => { if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const next = event.key === "Home" ? 0 : event.key === "End" ? 100 : normalized + (event.key === "ArrowUp" ? 5 : -5); onChange(clamp(Math.round(next / 5) * 5)); }}>
      <div className="absolute left-1/2 top-0 h-3 w-4 -translate-x-1/2 rounded-t-md border border-b-0" style={{ borderColor: "var(--muted)" }} />
      <div className="absolute inset-x-0 bottom-0 top-2 overflow-hidden rounded-[11px] border-2" style={{ borderColor: "var(--muted)", background: "var(--surface-soft)" }}>
        <div className="absolute inset-x-0 bottom-0 h-full origin-bottom transition-transform duration-100" style={{ transform: `scaleY(${level / 100})`, transitionTimingFunction: "var(--ease-out)", background: `linear-gradient(180deg, color-mix(in srgb, ${color} 68%, white), ${color})` }}><span className="absolute left-1 top-1 h-5 w-1 rounded-full bg-white/45" /></div>
      </div>
    </div>
    <span className="mt-1 text-xs font-black" style={{ color }}>{level}%</span>
  </div>;
}

export function ShoppingView({ items, onToggle, onAdd, onDelete }: { items: ShoppingItem[]; onToggle: (i: ShoppingItem) => void; onAdd: () => void; onDelete: (id: string) => void }) {
  const pending = items.filter((i) => i.status === "PENDING"), done = items.filter((i) => i.status === "PURCHASED");
  return <><PageTitle title="采购清单" text="低库存自动提醒，也可以随手记一笔。" action={<button onClick={onAdd} className="btn-primary flex items-center gap-2"><Plus size={18} /><span className="desktop-only">添加采购项</span></button>} />
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]"><section className="surface rounded-3xl p-4 sm:p-5"><div className="mb-3 flex items-center justify-between"><b>待采购</b><span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>{pending.length} 项</span></div><div className="space-y-2">{pending.map((item) => <ShoppingRow key={item.id} item={item} onToggle={() => onToggle(item)} onDelete={() => onDelete(item.id)} />)}{pending.length === 0 && <EmptyState icon={Check} title="全部买齐啦" text="新的低库存物品会自动出现在这里" />}</div></section>
      {(pending.length > 0 || done.length > 0) && <aside className="surface p-4"><h3 className="m-0 text-base">本次采购概览</h3><div className="my-4 grid grid-cols-2 gap-3"><div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><b className="text-2xl">{pending.length}</b><div className="mt-1 text-xs muted">待采购</div></div><div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><b className="text-2xl">{done.length}</b><div className="mt-1 text-xs muted">已完成</div></div></div>{done.length > 0 && <><div className="mb-2 text-xs font-bold muted">最近完成</div>{done.slice(0, 4).map((item) => <ShoppingRow key={item.id} item={item} onToggle={() => onToggle(item)} onDelete={() => onDelete(item.id)} compact />)}</>}</aside>}</div>
  </>;
}

export function ShoppingRow({ item, onToggle, onFavorite, onDelete, compact = false }: { item: ShoppingItem; onToggle: () => void; onFavorite?: () => void; onDelete: () => void; compact?: boolean }) {
  const done = item.status === "PURCHASED";
  const context = useContextMenu();
  const contextItems: ContextMenuItem[] = [{ label: done ? "标记为待采购" : "标记为已采购", icon: Check, onClick: onToggle }, { label: "删除采购项", icon: X, onClick: onDelete, danger: true, separatorBefore: true }];
  return <><motion.div layout onContextMenu={context.onContextMenu} className={`group flex items-center gap-3 rounded-2xl ${compact ? "py-2" : "p-3"}`} style={compact ? {} : { background: "var(--surface-soft)" }}><button onClick={onToggle} aria-label={done ? "标记为未购买" : "标记为已购买"} title={done ? "标记为未购买" : "标记为已购买"} aria-pressed={done} className="grid size-6 shrink-0 place-items-center rounded-lg border transition" style={done ? { background: "var(--success)", borderColor: "var(--success)", color: "var(--on-primary)" } : { borderColor: "var(--border)", background: "var(--surface-solid)" }}>{done && <Check size={14} />}</button><div className="min-w-0 flex-1"><div className={`truncate text-sm font-bold ${done ? "line-through opacity-50" : ""}`}>{item.name}</div>{!compact && <div className="mt-0.5 text-xs muted">{item.quantity} {item.unit} · {item.source === "low-stock" ? "库存提醒" : item.category || "手动添加"}</div>}</div>{!compact && item.priority === 2 && !done && <span className="rounded-lg px-2 py-1 text-xs font-bold" style={{ background: "#ffe8e8", color: "#d54b57" }}>优先</span>}{onFavorite && <button onClick={onFavorite} className="icon-action" aria-label={item.isFavorite ? "取消常买" : "标记为常买"} title={item.isFavorite ? "取消常买" : "标记为常买"} style={item.isFavorite ? { color: "var(--warning)" } : undefined}>★</button>}<button onClick={onDelete} aria-label="删除采购项" title="删除采购项" className="p-1.5 muted opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100"><X size={15} /></button></motion.div><ContextMenu menu={context.menu} items={contextItems} onClose={context.close} /></>;
}

