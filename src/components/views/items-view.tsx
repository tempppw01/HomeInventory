"use client";

import { motion } from "motion/react";
import { BellOff, BellRing, Check, CheckSquare, ChevronDown, Copy, Download, ImagePlus, Minus, MoreHorizontal, Package, Pencil, Pill, Printer, QrCode, Search, ShoppingBasket, Sparkles, Trash2, X } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { categoryIconMap } from "@/components/shared";
import type { Item, Location, ShoppingItem } from "@/types";
import { SearchBox } from "@/components/search-box";
import { BatchEditModal } from "@/components/batch-edit-modal";
import { isLiquidConsumable } from "@/lib/item-metrics";
import { itemAiHighlights } from "@/lib/item-ai";
import { aiConclusionStale } from "@/lib/item-staleness";
import { ContextMenu, useContextMenu, ContextMenuItem } from "@/components/context-menu";
import { isMedicineCategory, medicineCategoryLabel } from "@/lib/categories";
import { Field } from "@/components/ui-kit";
import { formatLocationPath, locationSegmentsById } from "@/lib/location-path";
import { isSortMode, SORT_MODES, sortHint, sortItems, type SortMode } from "@/lib/item-sort";
import { useConfirm } from "@/components/confirm-dialog";
import { Chip, Empty, ListRow, Panel, Screen, Toolbar } from "@/components/ui-kit";
import { ReadOnlyContext, ItemQuickFilter, expiryDays, expiryDateLabel, request } from "../shared";
import { Modal } from "./modals";
import { localDateString } from "@/lib/local-date";
import { isLowStock, isRestockPaused } from "@/lib/low-stock";
import { isExpiringSoonDays } from "@/lib/expiry-status";

const TYPE_FILTERS = [["ALL", "全部"], ["DURABLE", "耐用品"], ["CONSUMABLE", "消耗品"], ["MEDICINE", "医药"]] as const;

/** 卡片/采购行共用的小徽标:靠字重和淡色面表达状态,不额外画重边框。 */
function TagBadge({ tone, children }: { tone: "warning" | "danger" | "muted"; children: React.ReactNode }) {
  // 文字用 -strong 那一档:原色压在 14~16% 的混色底上只有 4.4:1,axe 实测不达 AA。
  const palette = tone === "danger"
    ? { background: "color-mix(in srgb, var(--danger) 14%, var(--surface-solid))", color: "var(--danger-strong)" }
    : tone === "warning"
      ? { background: "color-mix(in srgb, var(--warning) 16%, var(--surface-solid))", color: "var(--warning-strong)" }
      : { background: "var(--surface-soft)", color: "var(--muted)" };
  return <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold" style={palette}>{children}</span>;
}

// 一屏大约能看到 12-20 张卡片,60 是个「首屏够用、滚动不空窗」的量。
const PAGE_SIZE = 60;

export function ItemsView({ locationFilter, onChangeLocationFilter, allItems, locations, items, shopping, search, setSearch, filter, setFilter, categoryFilter, setCategoryFilter, onEdit, onOpenDetail, onImageUpload, onDuplicate, onConsume, onRemainingChange, onPauseRestock, onDelete, onQr, onAi, onPrint, onToast, onCopy, onToggleShopping, onFavoriteShopping, onAddShopping, onDeleteShopping, onBatchAi, onToastWithUndo, onCreate }: { allItems: Item[]; locations: Location[]; items: Item[]; shopping: ShoppingItem[]; search: string; setSearch: (s: string) => void; filter: ItemQuickFilter; setFilter: (f: ItemQuickFilter) => void; categoryFilter: string; setCategoryFilter: (f: string) => void; onEdit: (i: Item) => void; onOpenDetail: (i: Item) => void; onImageUpload: (i: Item, file?: File) => void; onDuplicate: (i: Item) => void; onConsume: (i: Item) => void; onRemainingChange: (item: Item, remainingPercent: number) => void;
  onPauseRestock?: (item: Item, days: number | null) => void | Promise<unknown>; onDelete: (i: Item) => void; onQr: (i: Item) => void; onAi: (i: Item) => void; onPrint: (items: Item[]) => void; onToast: (message: string) => void; onCopy: (i: Item) => void; onToggleShopping: (item: ShoppingItem) => void; onFavoriteShopping: (item: ShoppingItem) => void; onAddShopping: () => void; onDeleteShopping: (id: string) => void; onBatchAi: () => void; onToastWithUndo: (message: string, undo: () => Promise<void>) => void; onCreate: () => void; locationFilter?: string; onChangeLocationFilter?: (id: string) => void }) {
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

  // 列表分批渲染:一次只挂载 PAGE_SIZE 张卡片,滚到底部自动追加(也有「加载更多」兜底按钮)。
  // 500 件时此前会一次性渲染 537 张卡片,现在首屏只挂载 60 张。
  // 翻页进度按「查询条件」重置:数据每 15 秒刷新一次不应该把用户已经展开的列表收回去,
  // 所以这里用渲染期比较 key 的写法(React 官方推荐的 adjust-state-during-render),
  // 而不是在 effect 里同步 setState(那会触发级联渲染,React 19 的 lint 也会报错)。
  // 排序偏好存在本地:下次进来还是按上次的方式排。
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    if (typeof window === "undefined") return "updated";
    const saved = localStorage.getItem("home-inventory-item-sort");
    return isSortMode(saved) ? saved : "updated";
  });
  const changeSort = (mode: SortMode) => {
    setSortMode(mode);
    try { localStorage.setItem("home-inventory-item-sort", mode); } catch { /* 隐私模式忽略 */ }
  };
  const queryKey = `${search}|${filter}|${categoryFilter}|${sortMode}`;
  const [page, setPage] = useState({ key: queryKey, count: PAGE_SIZE });
  const [coldOnly, setColdOnly] = useState(false);
  if (page.key !== queryKey) setPage({ key: queryKey, count: PAGE_SIZE });
  // 「只看需冷藏」叠加在类型/分类之上,不影响原有筛选状态。
  // 先按用户选的顺序排,再叠加「只看需冷藏」,最后交给分批渲染。
  const sortedItems = sortItems(items, sortMode);
  const shownItems = coldOnly ? sortedItems.filter((item) => item.storage === "COLD" || item.storage === "COLD_AFTER_OPEN") : sortedItems;
  const visibleCount = Math.min(page.count, Math.max(shownItems.length, PAGE_SIZE));
  const visibleItems = shownItems.slice(0, visibleCount);
  const loadMoreRef = useRef<HTMLButtonElement | null>(null);
  const loadMore = () => setPage((current) => ({ ...current, count: current.count + PAGE_SIZE }));
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || visibleCount >= shownItems.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { rootMargin: "600px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [visibleCount, shownItems.length]);
  const bulk = async (body: Record<string, unknown>, successMessage = "批量更新完成") => { try { await request("/api/items/bulk", { method: "PATCH", body: JSON.stringify({ ...body, ids: [...selected] }) }); setSelected(new Set()); setBulkLocationOpen(false); onToast(successMessage); } catch (error) { onToast(error instanceof Error ? error.message : "批量更新失败"); } };
  const bulkDelete = async () => { if (!(await askConfirm(`确定将选中的 ${selected.size} 件物品移入回收站吗?可以稍后在回收站恢复。`, { title: "移入回收站", confirmLabel: "移入回收站" }))) return; try { await request("/api/items/bulk", { method: "DELETE", body: JSON.stringify({ ids: [...selected] }) }); const ids = [...selected]; setSelected(new Set()); onToastWithUndo(ids.length + " 件已移入回收站", async () => { await request("/api/items/bulk", { method: "PATCH", body: JSON.stringify({ ids, restore: true }) }); }); } catch (error) { onToast(error instanceof Error ? error.message : "批量删除失败"); } };
  const pendingShopping = shopping.filter((item) => item.status === "PENDING");
  const presentCategories = Array.from(new Set(allItems.map((item) => item.category).filter(Boolean)));
  const medicineCategories = presentCategories.filter(isMedicineCategory);
  const categoryOptions = filter === "MEDICINE"
    ? ["MEDICINE", ...medicineCategories]
    : ["ALL", ...presentCategories.filter((category) => !isMedicineCategory(category)), ...(medicineCategories.length ? ["MEDICINE"] : [])];
  // 导出「当前筛选结果」为 CSV。纯前端生成:数据本来就在内存里,不必再多一个接口。
  // 带 UTF-8 BOM,否则 Excel 打开中文会乱码。
  const exportCsv = () => {
    // 导出写「厨房/吊柜」这样的完整路径,导入时才能还原层级。
    const segments = locationSegmentsById(locations.map((row) => ({ id: row.id, name: row.name, parentId: row.parentId ?? null })));
    const pathById = new Map([...segments.entries()].map(([id, list]) => [id, formatLocationPath(list)]));
    const header = ["名称", "数量", "单位", "分类", "类型", "存放位置", "剩余量(%)", "购入日期", "到期日期", "单价", "物品编号", "备注"];
    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows = items.map((item) => [
      item.name, item.quantity, item.unit, item.category, item.type === "CONSUMABLE" ? "消耗品" : "耐用品",
      pathById.get(item.locationId ?? "") ?? "", item.remainingPercent, item.purchaseDate?.slice(0, 10) ?? "", item.expiryDate?.slice(0, 10) ?? "",
      item.price ?? "", item.itemCode ?? "", item.notes ?? "",
    ]);
    const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `归物-物品清单-${localDateString()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    onToast(`已导出 ${items.length} 件物品`);
  };

  const exitSelectMode = () => { setSelected(new Set()); setSelectMode(false); };
  // 类型筛选:桌面在工具行,移动端并入分类轨道,让「搜索 / 类型 / 分类」只占两行。
  const typeChips = TYPE_FILTERS.map(([id, label]) => <Chip key={id} active={filter === id} onClick={() => setFilter(id)}>{label}</Chip>);
  // 一键筛出该放冰箱的物品;数量来自后台规则引擎写入的 storage。
  const coldCount = allItems.filter((item) => item.storage === "COLD" || item.storage === "COLD_AFTER_OPEN").length;
  const coldChip = coldCount > 0 ? <Chip active={coldOnly} onClick={() => setColdOnly(!coldOnly)} ariaLabel={`需冷藏 ${coldCount},只看需冷藏的物品`}>需冷藏 {coldCount}</Chip> : null;
  const categoryButtons = categoryOptions.map((category) => {
    const count = category === "ALL" ? allItems.length : category === "MEDICINE" ? allItems.filter((item) => isMedicineCategory(item.category)).length : allItems.filter((item) => item.category === category).length;
    return <button key={category} type="button" className="browse-rail-item" data-active={categoryFilter === category} onClick={() => setCategoryFilter(category)}><span>{category === "ALL" ? "全部分类" : category === "MEDICINE" ? "医药(按用途)" : isMedicineCategory(category) ? medicineCategoryLabel(category) : category}</span><span className="browse-rail-count">{count}</span></button>;
  });
  return <>
    <Screen
      title="物品与采购"
      description="知道家里有什么,也记得还要买什么。"
      actions={<>{!readOnly && <button onClick={onBatchAi} className="btn-ghost flex items-center gap-1.5 text-xs" aria-label="AI 批量识别物品" title="上传多张照片或小票,AI 生成草稿后批量入库"><Sparkles size={15} /><span className="desktop-only">批量识别</span></button>}{!readOnly && <button onClick={onAddShopping} className="btn-ghost flex items-center gap-1.5 text-xs" aria-label="添加采购项"><ShoppingBasket size={15} /><span className="desktop-only">添加采购项</span></button>}</>}
    >
      <Toolbar>
        {/* 窄屏下让搜索框独占一行:此前它和「空间 / 排序 / 导出」挤在一行,
            在 390px 上被压到只剩「搜」一个字,连占位提示都看不见。Toolbar 本身是 flex-wrap,
            所以这里给满宽就会自然换行。 */}
        <div className="min-w-0 w-full md:hidden"><SearchBox items={allItems} value={search} onChange={setSearch} onSelect={(item) => setSearch(item.name)} placeholder="搜索名称或物品编号..." /></div>
        <label className="flex shrink-0 items-center gap-1 text-xs font-bold muted">
  <span className="sr-only">空间</span>
  <select
    aria-label="按空间筛选物品"
    value={locationFilter ?? "ALL"}
    onChange={(event) => onChangeLocationFilter?.(event.target.value)}
    className="input w-auto py-1.5 text-xs"
  >
    <option value="ALL">全部空间</option>
    {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
  </select>
</label>
<label className="flex shrink-0 items-center gap-1 text-xs font-bold muted">
          排序
          <select
            aria-label="物品排序方式"
            value={sortMode}
            onChange={(event) => changeSort(event.target.value as SortMode)}
            className="input w-auto py-1.5 text-xs"
          >
            {SORT_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
          </select>
        </label>
        <div className="hidden min-w-0 items-center gap-2 md:flex">{typeChips}{coldChip}</div>
        <span className="hidden shrink-0 text-xs tabular-nums muted md:inline">{shownItems.length} 件</span>
{locationFilter && locationFilter !== "ALL" && (
  <button
    type="button"
    onClick={() => onChangeLocationFilter?.("ALL")}
    className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold"
    style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
    aria-label={`清除空间筛选:${locations.find((location) => location.id === locationFilter)?.name ?? ""}`}
  >
    空间:{locations.find((location) => location.id === locationFilter)?.name ?? "未知"}
    <X size={12} />
  </button>
)}
        {sortMode === "expiry" && (() => {
          const hint = sortHint(sortMode, shownItems);
          return hint ? <span className="hidden shrink-0 text-xs muted lg:inline">{hint}</span> : null;
        })()}
        <button onClick={exportCsv} disabled={items.length === 0} className="btn-ghost flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs disabled:opacity-40" aria-label="导出当前筛选为 CSV" title="把当前筛选出的物品导出成 CSV(Excel 可直接打开)"><Download size={15} /><span className="desktop-only">导出</span></button>
        <div className="flex shrink-0 items-center gap-2 md:ml-auto">
          {selectMode
            ? <button onClick={exitSelectMode} className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs">完成</button>
            : <button onClick={() => setSelectMode(true)} disabled={items.length === 0} className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"><CheckSquare size={15} />选择</button>}
        </div>
      </Toolbar>

      {selectMode && <Toolbar className="mt-2 flex-nowrap overflow-x-auto">
        <span className="shrink-0 text-xs font-black" style={{ color: "var(--primary)" }}>已选 {selected.size} 件</span>
        <span className="h-5 w-px shrink-0" style={{ background: "var(--border)" }} />
        <button onClick={selectVisible} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">全选</button>
        <button onClick={() => bulk({ category: items.find((item) => selected.has(item.id))?.category || "日用" })} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">沿用分类</button>
        <button onClick={() => { setBulkLocationId(selectedItems[0]?.locationId ?? ""); setBulkLocationOpen(true); }} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">批量移动位置</button>
        <button onClick={() => setBulkEditOpen(true)} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">批量编辑</button>
        <button onClick={() => onPrint(selectedItems)} className="btn-primary flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs"><Printer size={15} />打印二维码</button>
        <button onClick={bulkDelete} className="btn-ghost shrink-0 px-3 py-1.5 text-xs text-red-500">移入回收站</button>
      </Toolbar>}

      <div className="browse-layout">
        <nav className="browse-rail" aria-label="物品分类">
          <div className="flex shrink-0 items-center gap-2 md:hidden">{typeChips}</div>
          <span className="h-5 w-px shrink-0 md:hidden" style={{ background: "var(--border)" }} />
          {categoryButtons}
        </nav>
        <div className="min-w-0">
          {shownItems.length
            ? <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visibleItems.map((item, index) => <motion.div className="h-full min-w-0" key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.05, 0.2) }}><ItemCard item={item} selected={selected.has(item.id)} showSelect={selectMode} onSelect={() => toggle(item.id)} onEdit={() => onEdit(item)} onOpenDetail={() => onOpenDetail(item)} onImageUpload={(file) => onImageUpload(item, file)} onDuplicate={() => void onDuplicate(item)} onConsume={() => onConsume(item)} onRemainingChange={(remainingPercent) => onRemainingChange(item, remainingPercent)} onPauseRestock={onPauseRestock} onDelete={() => onDelete(item)} onQr={() => onQr(item)} onAi={() => onAi(item)} onCopy={() => onCopy(item)} /></motion.div>)}
              {visibleItems.length < shownItems.length && (
                <div className="col-span-full flex justify-center py-4">
                  <button ref={(node) => { loadMoreRef.current = node; }} type="button" onClick={loadMore} className="btn-ghost min-h-11 px-4 text-xs">
                    还有 {shownItems.length - visibleItems.length} 件,加载更多
                  </button>
                </div>
              )}
            </div>
            : allItems.length === 0
              ? <Panel><Empty icon={Package} title="还没有录入物品" text="从眼前的一件东西开始:名称和数量就够,其他信息之后补。" action={<button onClick={onCreate} className="btn-primary min-h-11 px-4 text-sm">录入第一件物品</button>} /></Panel>
              : coldOnly
                ? <Panel><Empty icon={Search} title="没有需要冷藏的物品" text="录入饮料、乳制品或生鲜后会自动标注" action={<button onClick={() => setColdOnly(false)} className="btn-ghost min-h-11 px-4 text-sm">看全部物品</button>} /></Panel>
                : <Panel><Empty icon={Search} title="没有找到物品" text="换个关键词或筛选条件试试" /></Panel>}
        </div>
      </div>

      <details className="surface group mt-6 min-w-0 rounded-[20px] p-4 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><ShoppingBasket size={20} /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-black">采购清单</span><span className="mt-1 block truncate text-xs muted">{pendingShopping.length ? `${pendingShopping.length} 项等你顺路带回家` : "暂时没有需要采购的东西"}</span></span>
          <ChevronDown size={17} className="shrink-0 muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 border-t pt-1" style={{ borderColor: "var(--hairline)" }}>
          {pendingShopping.length
            ? pendingShopping.map((item) => <ShoppingRow key={item.id} item={item} onToggle={() => onToggleShopping(item)} onFavorite={() => onFavoriteShopping(item)} onDelete={() => onDeleteShopping(item.id)} />)
            : <Empty icon={ShoppingBasket} title="暂时没有需要采购的东西" text="需要添置时,用页面右上角的「添加采购项」记一笔。" />}
        </div>
      </details>
    </Screen>
    {bulkLocationOpen && <Modal title="批量移动位置" subtitle={`已选 ${selected.size} 件物品,统一移动到新的存放位置。`} onClose={() => setBulkLocationOpen(false)}><div className="space-y-4"><Field label="新的存放位置"><select autoFocus className="input" value={bulkLocationId} onChange={(e) => setBulkLocationId(e.target.value)}>{[{ id: "", name: "未设置 / 清空位置" }, ...locations].map((location) => <option key={location.id || "empty"} value={location.id}>{location.name}</option>)}</select></Field><p className="m-0 text-xs muted">确认后会更新全部已选物品的存放位置。</p><div className="flex gap-3 pt-2"><button type="button" onClick={() => setBulkLocationOpen(false)} className="btn-ghost flex-1">取消</button><button type="button" onClick={() => void bulk({ locationId: bulkLocationId || null }, "批量移动位置已完成")} className="btn-primary flex-1">确认移动</button></div></div></Modal>}
    {bulkEditOpen && <BatchEditModal selectedCount={selected.size} initialCategory={selectedItems[0]?.category || "日用"} initialLocationId={selectedItems[0]?.locationId ?? ""} locations={locations} onClose={() => setBulkEditOpen(false)} onApply={(updates) => { void bulk(updates, "批量编辑已完成"); setBulkEditOpen(false); }} />}
  </>;
}

export function ItemCard({ item, onEdit, onOpenDetail, onImageUpload, onDuplicate, onConsume, onRemainingChange, onPauseRestock, onDelete, onQr, onAi, onCopy, onSelect, selected = false, showSelect = false, compact = false }: { item: Item; onEdit: () => void; onOpenDetail?: () => void; onImageUpload?: (file: File) => void; onDuplicate?: () => void; onConsume: () => void; onRemainingChange?: (remainingPercent: number) => void;
  onPauseRestock?: (item: Item, days: number | null) => void | Promise<unknown>; onDelete?: () => void; onQr: () => void; onAi: () => void; onCopy?: () => void; onSelect?: () => void; selected?: boolean; showSelect?: boolean; compact?: boolean }) {
  const low = isLowStock(item);
  const CategoryIcon = isMedicineCategory(item.category) ? Pill : (categoryIconMap[item.category] || Package);
  const readOnly = useContext(ReadOnlyContext);
  const ai = itemAiHighlights(item);
  // 物品改过、但结论还是旧的:列表上给个明确提示,免得用户以为 AI 已经看过最新信息。
  const aiStale = ai.hasHighlights && aiConclusionStale({ updatedAt: item.updatedAt, aiAnalyzedAt: item.aiAnalyzedAt });
  const isMedicine = isMedicineCategory(item.category);
  const showRemaining = !compact && isLiquidConsumable(item) && onRemainingChange;
  // 「用掉一个」只对按个数消耗的消耗品有意义:液体交给右侧滑块。
  const canConsumeOne = !compact && !readOnly && item.type === "CONSUMABLE" && !isLiquidConsumable(item) && Boolean(onConsume);
  const expiry = item.expiryDate ? expiryDays(item) : null;
  const expired = expiry !== null && expiry <= 0;
  const expiring = expiry !== null && isExpiringSoonDays(expiry);
  const context = useContextMenu();
  const contextItems: ContextMenuItem[] = [{ label: "编辑物品", icon: Pencil, onClick: onEdit, disabled: readOnly }, ...(onDuplicate ? [{ label: "复制为新物品", icon: Copy, onClick: onDuplicate, disabled: readOnly }] : []), ...(onCopy ? [{ label: "复制物品编号", icon: Copy, onClick: onCopy }] : []), { label: "显示二维码", icon: QrCode, onClick: onQr }, { label: isMedicine ? "AI 补全药品说明" : "AI 识别与建议", icon: Sparkles, onClick: onAi }];
  // 「暂停补货提醒」此前只有字段与逻辑、界面没有入口:用户根本开不了这个功能。
  if (!readOnly && item.type === "CONSUMABLE" && onPauseRestock) {
    const paused = isRestockPaused(item);
    contextItems.push(paused
      ? { label: "恢复补货提醒", icon: BellRing, onClick: () => onPauseRestock(item, null) }
      : { label: "暂停补货提醒 7 天", icon: BellOff, onClick: () => onPauseRestock(item, 7) },
    );
  }
  if (onDelete) contextItems.push({ label: "移入回收站", icon: Trash2, onClick: onDelete, disabled: readOnly, danger: true, separatorBefore: true });
  return <><div onContextMenu={context.onContextMenu} className="h-full min-w-0">
    <Panel padded={false} className={`group relative flex h-full min-w-0 flex-col overflow-hidden transition-transform duration-200 active:scale-[.99] ${compact ? "p-3" : "p-3.5"} ${selected ? "shadow-[inset_0_0_0_2px_var(--primary)]" : "hover:-translate-y-0.5"}`}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <label className={`file-label ${compact ? "size-11 text-lg" : "size-12 text-xl"} relative grid shrink-0 place-items-center rounded-2xl bg-cover bg-center`} style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : { background: "var(--surface-soft)", color: "var(--muted)" }} title="点击上传物品照片">{!item.imageUrl && <CategoryIcon size={compact ? 18 : 20} />}{onImageUpload && <><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" aria-label={`上传「${item.name}」的照片`} onChange={(event) => { const file = event.target.files?.[0]; if (file) onImageUpload(file); event.currentTarget.value = ""; }} /><span className="pointer-events-none absolute inset-0 grid place-items-center rounded-2xl bg-black/35 text-white opacity-0 transition group-hover:opacity-100"><ImagePlus size={16} /></span></>}</label>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 pr-8">
            <button type="button" onClick={onOpenDetail} className="flex min-h-11 min-w-0 flex-1 items-center text-left md:min-h-10"><span className="min-w-0 truncate text-sm font-extrabold hover:underline" title={item.name}>{item.name}</span></button>
            {ai.hasHighlights && <Sparkles size={12} className="shrink-0" style={{ color: "var(--primary)" }} aria-label="有 AI 信息" />}{/* 「建议重新分析」移到下面那行状态标签里 —— 它挤在这里会把物品名压到 50px 左右(实测「可口可乐罐装」被截成「可口...」) */}
            <span className="shrink-0 text-sm font-black tabular-nums">{item.quantity}<span className="ml-0.5 text-xs font-normal muted">{item.unit}</span></span>
          </div>
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs muted">
            <span className="min-w-0 flex-1 truncate">{[item.location?.name || "未设置位置", item.category.replace(/^医药·/, ""), item.type === "CONSUMABLE" ? "消耗品" : "耐用品"].join(" · ")}</span>
            {expired || expiring ? <TagBadge tone={expired ? "danger" : "warning"}>{expiryDateLabel(item)}</TagBadge> : null}
            {low && <TagBadge tone="warning">需补货</TagBadge>}
            {item.storage === "COLD" && <TagBadge tone="muted">需冷藏</TagBadge>}
            {aiStale && (
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); event.preventDefault(); onAi(); }}
                className="flex min-h-11 shrink-0 items-center rounded-full px-2 text-[10px] font-bold transition-transform active:scale-95 sm:min-h-0 sm:px-1.5 sm:py-0.5"
                style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
                title="物品信息改过,点这里让 AI 重新看一遍"
                aria-label={`建议重新分析「${item.name}」`}
              >
                建议重新分析
              </button>
            )}
            {item.storage === "COLD_AFTER_OPEN" && <TagBadge tone="muted">开封后冷藏</TagBadge>}
          </div>
          {canConsumeOne && <button type="button" onClick={onConsume} className="tap-target mt-2 inline-flex min-h-10 shrink-0 items-center justify-center gap-1 rounded-full px-2 text-xs font-bold transition-colors md:px-2.5" style={{ background: "var(--primary-soft)", color: "var(--primary-strong)" }} title={`消耗 1 ${item.unit}`} aria-label={`用掉 1 ${item.unit}`}><Minus size={13} /><span className="hidden md:inline">用掉 1 {item.unit}</span></button>}
        </div>
        {showRemaining && <RemainingLevel value={item.remainingPercent} onChange={onRemainingChange} />}
      </div>
      {!readOnly && showSelect && onSelect && <button onClick={onSelect} className={`icon-action absolute left-1 top-1 z-10 backdrop-blur-sm ${selected ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"}`} style={{ background: selected ? "var(--primary)" : "color-mix(in srgb, var(--surface-solid) 88%, transparent)", color: selected ? "var(--on-primary)" : "var(--muted)" }} aria-label={selected ? "取消选择" : "选择物品"} title={selected ? "取消选择" : "选择物品"}>{selected ? <X size={15} /> : <CheckSquare size={15} />}</button>}
      <button type="button" onClick={(event) => context.onContextMenu(event)} className="icon-action absolute right-1 top-1" aria-haspopup="menu" aria-label="更多操作" title="更多操作"><MoreHorizontal size={16} /></button>
    </Panel>
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


export function ShoppingRow({ item, onToggle, onFavorite, onDelete, compact = false }: { item: ShoppingItem; onToggle: () => void; onFavorite?: () => void; onDelete: () => void; compact?: boolean }) {
  const done = item.status === "PURCHASED";
  const context = useContextMenu();
  const contextItems: ContextMenuItem[] = [{ label: done ? "标记为待采购" : "标记为已采购", icon: Check, onClick: onToggle }, { label: "删除采购项", icon: X, onClick: onDelete, danger: true, separatorBefore: true }];
  return <><motion.div layout onContextMenu={context.onContextMenu} className="group min-w-0">
    <ListRow
      icon={done ? Check : ShoppingBasket}
      title={<span className={done ? "line-through opacity-50" : ""}>{item.name}</span>}
      meta={compact ? undefined : `${item.quantity} ${item.unit} · ${item.source === "low-stock" ? "库存提醒" : item.category || "手动添加"}`}
      trailing={<>
        {!compact && item.priority === 2 && !done && <TagBadge tone="danger">优先</TagBadge>}
        <button onClick={onToggle} aria-label={done ? "标记为未购买" : "标记为已购买"} title={done ? "标记为未购买" : "标记为已购买"} aria-pressed={done} className="grid size-11 shrink-0 place-items-center rounded-xl border transition md:size-10" style={done ? { background: "var(--success)", borderColor: "var(--success)", color: "var(--on-primary)" } : { borderColor: "var(--border)", background: "var(--surface-solid)" }}>{done && <Check size={16} />}</button>
        {onFavorite && <button onClick={onFavorite} className="icon-action" aria-label={item.isFavorite ? "取消常买" : "标记为常买"} title={item.isFavorite ? "取消常买" : "标记为常买"} style={item.isFavorite ? { color: "var(--warning)" } : undefined}>★</button>}
        <button onClick={onDelete} aria-label="删除采购项" title="删除采购项" className="grid size-11 shrink-0 place-items-center rounded-xl muted opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100 md:size-10"><X size={16} /></button>
      </>}
    />
  </motion.div><ContextMenu menu={context.menu} items={contextItems} onClose={context.close} /></>;
}
