"use client";

import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertTriangle, Archive, Bath, Bell, Bot, Boxes, CalendarDays, Check, CheckSquare, ChevronDown, ChevronRight, CircleAlert, Cloud, CookingPot,
  Grid2X2, ImagePlus, Info, LayoutDashboard, LayoutGrid, List, MapPin, Minus, Monitor, Moon,
  Package, Plus, Printer, QrCode, Search, Settings, ShoppingBasket, Sofa, Sparkles, Copy, Pencil, ExternalLink,
  History, RotateCcw, Sun, Trash2, WalletCards, Warehouse, X, Zap, PanelLeftClose, PanelLeftOpen, Link2, Upload,
} from "lucide-react";
import { FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardData, Item, ItemType, Location, ShoppingItem } from "@/types";
import { AiSettings } from "@/components/ai-settings";
import { RecycleBinModal } from "@/components/recycle-bin-modal";
import { DataTools } from "@/components/data-tools";
import { AccountSettings } from "@/components/account-settings";
import { AiChat } from "@/components/ai-chat";
import { BatchAiImport } from "@/components/batch-ai-import";
import { AiAssistantModal, analyzeItem, type AiAnalysis } from "@/components/ai-assistant-modal";
import { PrintStudio } from "@/components/print-studio";
import { dailyUsageCost, isCountUnit, isLiquidConsumable, normalizeItemQuantity } from "@/lib/item-metrics";
import { itemAiHighlights } from "@/lib/item-ai";
import { APP_VERSION } from "@/lib/version";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/context-menu";

type View = "dashboard" | "items" | "locations" | "settings" | "about";
type ThemeMode = "light" | "dark" | "system";
type AssistantPosition = { x: number; y: number };
type ItemDraft = {
  name: string; category: string; type: ItemType; quantity: number; minQuantity: number; remainingPercent: number;
  unit: string; price: string; purchaseDate: string; expiryDate: string; locationId: string; notes: string; imageUrl: string;
  aiSummary: string; aiStorageAdvice: string; aiUsageAdvice: string; aiReplenishmentAdvice: string;
};

const emptyDraft: ItemDraft = {
  name: "", category: "日用", type: "DURABLE", quantity: 1, minQuantity: 0, remainingPercent: 100,
  unit: "件", price: "", purchaseDate: "", expiryDate: "", locationId: "", notes: "", imageUrl: "",
  aiSummary: "", aiStorageAdvice: "", aiUsageAdvice: "", aiReplenishmentAdvice: "",
};

async function compressImage(file: File): Promise<File> {
  if (file.size <= 5 * 1024 * 1024 && file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg", lastModified: Date.now() });
}

const navItems = [
  { id: "dashboard" as View, label: "概览", icon: LayoutDashboard },
  { id: "items" as View, label: "物品", icon: Boxes },
  { id: "locations" as View, label: "空间", icon: MapPin },
];
const mobileNavItems = [...navItems, { id: "settings" as View, label: "设置", icon: Settings }];

const iconMap = { Package, CookingPot, Sofa, Bath, Warehouse };
const categories = ["日用", "食品", "饮品", "清洁", "家电", "数码", "衣物", "医药", "户外", "其他"];
const units = ["件", "个", "盒", "瓶", "袋", "卷", "包", "台", "kg", "L", "ml"];
const welcomeStorageKey = "home-inventory-welcome-seen";
const legacyWelcomeStorageKeys = ["home-inventory-welcome-0.0.1"];
const appStartedAt = Date.now();
const assistantPositionStorageKey = "home-inventory-ai-assistant-position-v1";

function dateInputValue(daysFromToday = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isMoneyInput(value: string) {
  return /^(?:\d+)?(?:[.,]\d{0,2})?$/.test(value);
}

function moneyValue(value: string) {
  const normalized = value.replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const retryable = !options?.method || ["GET", "PATCH", "DELETE"].includes(options.method.toUpperCase());
  for (let attempt = 0; attempt < (retryable ? 2 : 1); attempt++) {
    try {
      const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(result.error || "操作失败");
      return result as T;
    } catch (error) {
      if (attempt === 0 && retryable) continue;
      const message = error instanceof Error ? error.message : "网络请求失败";
      if (/content-length|network response|failed to fetch/i.test(message)) throw new Error("网络响应不完整，请重试；已保存的内容不会丢失");
      throw error;
    }
  }
  throw new Error("操作失败");
}

export function InventoryApp() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | ItemType>("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [modal, setModal] = useState<"item" | "shopping" | "location" | "notifications" | "recycle" | "batch-ai" | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [qrItem, setQrItem] = useState<Item | null>(null);
  const [printItems, setPrintItems] = useState<Item[] | null>(null);
  const [aiItem, setAiItem] = useState<Item | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [showWelcome, setShowWelcome] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await request<DashboardData>("/api/dashboard"));
    } catch (error) {
      setToast(error instanceof Error ? error.message : "载入失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    request<DashboardData>("/api/dashboard")
      .then((result) => { if (active) setData(result); })
      .catch((error) => { if (active) setToast(error instanceof Error ? error.message : "载入失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem("home-inventory-sidebar-collapsed");
    if (saved === null) return;
    const frame = requestAnimationFrame(() => setSidebarCollapsed(saved === "true"));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (localStorage.getItem(welcomeStorageKey) || legacyWelcomeStorageKeys.some((key) => localStorage.getItem(key))) {
      localStorage.setItem(welcomeStorageKey, "seen");
      return;
    }
    const frame = requestAnimationFrame(() => setShowWelcome(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem("home-inventory-theme") as ThemeMode | null;
    const next = saved ?? "system";
    const frame = requestAnimationFrame(() => {
      setTheme(next);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme; };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => { request<{ id: string }[]>("/api/members").then((members) => setMemberId(members[0]?.id ?? null)).catch(() => undefined); }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const setThemeMode = (next: ThemeMode) => {
    setTheme(next);
    localStorage.setItem("home-inventory-theme", next);
  };
  const cycleTheme = () => setThemeMode(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem("home-inventory-sidebar-collapsed", String(next));
      return next;
    });
  };

  const filteredItems = useMemo(() => {
    const term = search.toLowerCase().trim();
    return (data?.items ?? []).filter((item) =>
      (typeFilter === "ALL" || item.type === typeFilter) &&
      (categoryFilter === "ALL" || item.category === categoryFilter) &&
      (!term || [item.name, item.itemCode, item.category, item.location?.name].some((value) => value?.toLowerCase().includes(term))),
    );
  }, [categoryFilter, data, search, typeFilter]);

  const lowStock = (data?.items ?? []).filter((item) => item.type === "CONSUMABLE" && (!item.restockPausedUntil || new Date(item.restockPausedUntil).getTime() <= appStartedAt) && ((item.minQuantity > 0 && item.quantity <= item.minQuantity) || (isLiquidConsumable(item) && item.remainingPercent <= 20)));
  const pendingShopping = (data?.shopping ?? []).filter((item) => item.status === "PENDING");
  const expiring = (data?.items ?? []).filter((item) => item.type === "CONSUMABLE" && item.expiryDate && new Date(item.expiryDate).getTime() - appStartedAt < 14 * 86400000 && new Date(item.expiryDate).getTime() > appStartedAt);
  const expired = (data?.items ?? []).filter((item) => item.type === "CONSUMABLE" && item.expiryDate && new Date(item.expiryDate).getTime() <= appStartedAt);
  const totalValue = (data?.items ?? []).reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0);

  const openEdit = (item: Item) => { setEditing(item); setModal("item"); };
  const copyText = async (value: string, message: string) => { try { await navigator.clipboard.writeText(value); setToast(message); } catch { setToast("复制失败，请手动复制"); } };
  const closeModal = () => { setModal(null); setEditing(null); setEditingLocation(null); };

  const consume = async (item: Item) => {
    if (isLiquidConsumable(item)) {
      setToast(`${item.name} 请通过右侧余量刻度记录使用进度`);
      return;
    }
    if (item.quantity <= 0) return;
    try {
      await request(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ quantity: Math.max(0, item.quantity - 1) }) });
      setToast(`${item.name} 已使用 1 ${item.unit}`); await refresh();
    } catch (error) { setToast(error instanceof Error ? error.message : "操作失败"); }
  };

  const updateRemaining = async (item: Item, remainingPercent: number) => {
    const next = Math.min(100, Math.max(0, Math.round(remainingPercent)));
    const previous = item.remainingPercent;
    setData((current) => current ? { ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, remainingPercent: next } : entry) } : current);
    try {
      await request(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ remainingPercent: next }) });
      setToast(`${item.name} 剩余量已调整为 ${next}%`);
    } catch (error) {
      setData((current) => current ? { ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, remainingPercent: previous } : entry) } : current);
      setToast(error instanceof Error ? error.message : "剩余量保存失败");
    }
  };

  const removeItem = async (item: Item) => {
    if (!confirm(`确定将“${item.name}”移入回收站吗？`)) return;
    await request(`/api/items/${item.id}`, { method: "DELETE", body: JSON.stringify({ memberId }) }); setToast("物品已移入回收站，可在回收站恢复"); await refresh();
  };

  const addRestockSuggestion = async (item: Item) => {
    const quantity = isLiquidConsumable(item) ? 1 : Math.max(item.minQuantity - item.quantity, 1);
    try {
      await request("/api/shopping", { method: "POST", body: JSON.stringify({ name: item.name, quantity, unit: item.unit, category: item.category, priority: 2, source: "restock-suggestion" }) });
      setToast(`${item.name} 已加入采购清单`);
      await refresh();
    } catch (error) { setToast(error instanceof Error ? error.message : "加入采购清单失败"); }
  };

  const toggleShopping = async (item: ShoppingItem) => {
    await request(`/api/shopping/${item.id}`, { method: "PATCH", body: JSON.stringify({ status: item.status === "PENDING" ? "PURCHASED" : "PENDING" }) });
    await refresh();
  };

  return (
    <div className={`min-h-screen md:grid ${sidebarCollapsed ? "md:grid-cols-[76px_minmax(0,1fr)]" : "md:grid-cols-[232px_minmax(0,1fr)]"}`}>
      <aside className={`desktop-only sticky top-0 h-screen border-r px-3 py-5 transition-[width] duration-200 ${sidebarCollapsed ? "items-center" : ""}`} style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <button onClick={toggleSidebar} className={`flex w-full items-center rounded-xl p-1 text-left transition hover:bg-[var(--surface-soft)] ${sidebarCollapsed ? "justify-center" : "justify-between gap-2"}`} aria-label={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"} title={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}>
          <Brand compact={sidebarCollapsed} />
          {!sidebarCollapsed && <span className="grid size-8 shrink-0 place-items-center rounded-lg muted"><span className="sr-only">折叠侧栏</span><PanelLeftClose size={17} /></span>}
        </button>
        <nav className="mt-9 space-y-1.5">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setView(id)} className={`ds-nav-item flex w-full items-center rounded-xl py-3 text-sm font-semibold transition ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3"}`}
              aria-label={label} title={sidebarCollapsed ? label : undefined}
              data-active={view === id} data-compact={sidebarCollapsed}>
              <Icon size={19} strokeWidth={2.2} /> {!sidebarCollapsed && label}
            </button>
          ))}
        </nav>
        <div className={`absolute bottom-5 ${sidebarCollapsed ? "left-3 right-3" : "left-4 right-4"}`}>
          <button onClick={() => setView("settings")} className={`ds-nav-item flex w-full items-center rounded-xl py-2.5 text-sm font-semibold ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3"}`} data-active={view === "settings"} data-compact={sidebarCollapsed} aria-label="设置" title={sidebarCollapsed ? "设置" : undefined}>
            <Settings size={19} /> {!sidebarCollapsed && "设置"}
          </button>
          <button onClick={() => setModal("recycle")} className={`flex w-full items-center rounded-xl py-2.5 text-sm font-semibold muted hover:bg-[var(--surface-soft)] ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3"}`} aria-label="回收站" title={sidebarCollapsed ? "回收站" : undefined}><Trash2 size={19} />{!sidebarCollapsed && "回收站"}</button>
          <button onClick={() => setView("about")} className={`ds-nav-item flex w-full items-center rounded-xl py-2.5 text-sm font-semibold ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3"}`} data-active={view === "about"} data-compact={sidebarCollapsed} aria-label="关于" title={sidebarCollapsed ? `关于 v${APP_VERSION}` : undefined}><Info size={19} />{!sidebarCollapsed && <>关于 <span className="ml-auto text-[10px]">v{APP_VERSION}</span></>}</button>
          {!sidebarCollapsed && <div className="mt-3 rounded-xl p-3" style={{ background: "linear-gradient(135deg, var(--primary-soft), var(--surface-soft))" }}>
            <div className="flex items-center gap-2 text-sm font-bold"><Sparkles size={16} style={{ color: "var(--primary)" }} /> 今日小结</div>
            <p className="mb-0 mt-2 text-xs leading-5 muted">{lowStock.length ? `${lowStock.length} 件消耗品需要补充` : "库存充足，家里井井有条"}</p>
          </div>}
        </div>
      </aside>

      <main className="min-w-0 px-4 pb-8 pt-4 sm:px-6 md:px-8 md:py-7 xl:px-12">
        <header className="mobile-topbar mb-7 flex items-center gap-3">
          <div className="mobile-only"><Brand compact /></div>
          <div className="desktop-only max-w-md flex-1">
            <SearchBox items={data?.items ?? []} value={search} onChange={setSearch} onSelect={(item) => { setSearch(item.name); setView("items"); }} onFocus={() => setView("items")} placeholder="搜索名称、编号、分类或位置…" />
          </div>
          <button onClick={cycleTheme} className="btn-ghost grid size-11 place-items-center p-0" aria-label={`当前主题：${theme === "system" ? "跟随系统" : theme === "light" ? "浅色" : "深色"}`} title="切换主题">{theme === "system" ? <Monitor size={19} /> : theme === "light" ? <Moon size={19} /> : <Sun size={19} />}</button>
          <button onClick={() => setModal("notifications")} className="btn-ghost relative grid size-11 place-items-center p-0" aria-label="查看提醒"><Bell size={19} />{lowStock.length + expiring.length + expired.length > 0 && <span className="absolute right-2 top-2 size-2 rounded-full" style={{ background: "var(--danger)" }} />}</button>
          <button onClick={() => setModal("batch-ai")} className="btn-ghost flex items-center gap-2 whitespace-nowrap"><ImagePlus size={18} /><span className="hidden min-[1100px]:inline">图片识别</span></button><button onClick={() => setModal("item")} className="btn-primary flex items-center gap-2 whitespace-nowrap"><Plus size={19} /><span className="hidden min-[1100px]:inline">录入物品</span></button>
        </header>

        <AnimatePresence mode="wait">
          <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .22 }}>
            {loading ? <LoadingView /> : view === "dashboard" ? (
              <DashboardView data={data!} lowStock={lowStock} expiring={expiring} expired={expired} pending={pendingShopping} totalValue={totalValue} onNavigate={setView} onEdit={openEdit} onConsume={consume} onDelete={removeItem} onAddRestock={addRestockSuggestion} onQr={setQrItem} onAi={setAiItem} onAlerts={() => setModal("notifications")} />
            ) : view === "items" ? (
              <ItemsView allItems={data!.items} locations={data!.locations} items={filteredItems} shopping={data!.shopping} search={search} setSearch={setSearch} filter={typeFilter} setFilter={setTypeFilter} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} onEdit={openEdit} onConsume={consume} onRemainingChange={updateRemaining} onDelete={removeItem} onQr={setQrItem} onAi={setAiItem} onPrint={setPrintItems} onToast={setToast} onCopy={(item) => copyText(item.itemCode || item.id, "物品编号已复制")} onToggleShopping={toggleShopping} onAddShopping={() => setModal("shopping")} onDeleteShopping={async (id) => { await request(`/api/shopping/${id}`, { method: "DELETE" }); await refresh(); }} />
            ) : view === "locations" ? (
              <LocationsView locations={data!.locations} items={data!.items} onAdd={() => { setEditingLocation(null); setModal("location"); }} onOpen={(name) => { setSearch(name); setView("items"); }} onEdit={(location) => { setEditingLocation(location); setModal("location"); }} onToast={setToast} />
            ) : view === "settings" ? <SettingsView onToast={setToast} onAbout={() => setView("about")} onRecycle={() => setModal("recycle")} /> : <AboutView />}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav aria-label="移动端主导航" className="mobile-only mobile-bottom-nav fixed bottom-0 left-0 right-0 z-30 grid grid-cols-5 gap-1 border-t px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl" style={{ background: "color-mix(in srgb, var(--surface) 94%, transparent)", borderColor: "var(--border)" }}>
        {mobileNavItems.map(({ id, label, icon: Icon }, index) => {
          const active = view === id;
          return <button key={id} onClick={() => setView(id)} aria-current={active ? "page" : undefined} data-active={active} className="ds-mobile-nav-item relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-semibold transition" style={{ gridColumn: index > 1 ? index + 2 : index + 1 }}><span className="ds-mobile-nav-icon"><Icon size={19} strokeWidth={active ? 2.4 : 2} /></span><span>{label}</span></button>;
        })}
        <button onClick={() => setModal("item")} className="mobile-add-button" aria-label="添加物品" title="添加物品"><Plus size={23} strokeWidth={2.2} /></button>
      </nav>

      <AnimatePresence>
        {modal === "item" && <ItemModal locations={data?.locations ?? []} allItems={data?.items ?? []} item={editing} onClose={closeModal} onSaved={async () => { closeModal(); setToast(editing ? "物品已更新" : "物品已录入"); await refresh(); }} />}
        {modal === "shopping" && <ShoppingModal onClose={closeModal} onSaved={async () => { closeModal(); setToast("已加入采购清单"); await refresh(); }} />}
        {modal === "location" && <LocationModal location={editingLocation} onClose={closeModal} onSaved={async () => { const wasEditing = Boolean(editingLocation); closeModal(); setToast(wasEditing ? "空间已更新" : "新空间已创建"); await refresh(); }} />}
        {modal === "notifications" && <NotificationsModal lowStock={lowStock} expiring={expiring} expired={expired} onClose={closeModal} onOpenItem={(item) => { closeModal(); openEdit(item); }} onDispose={removeItem} onShopping={() => { closeModal(); setView("items"); }} />}
        {modal === "recycle" && <RecycleBinModal onClose={closeModal} onRestored={async () => { setToast("物品已恢复"); await refresh(); }} onToast={setToast} />}
        {modal === "batch-ai" && <BatchAiImport locations={data?.locations ?? []} onClose={closeModal} onSaved={refresh} onToast={setToast} />}
        {qrItem && <QrModal item={qrItem} onClose={() => setQrItem(null)} onPrint={() => { setQrItem(null); setPrintItems([qrItem]); }} />}
        {aiItem && <AiAssistantModal item={aiItem} onClose={() => setAiItem(null)} onApplied={async (message) => { setToast(message); await refresh(); }} />}
      </AnimatePresence>
      {!chatOpen && <AssistantLauncher onOpen={() => setChatOpen(true)} />}
      {chatOpen && <AiChat onClose={() => setChatOpen(false)} />}
      {printItems && <PrintStudio items={printItems} onClose={() => setPrintItems(null)} />}
      {showWelcome && <WelcomeModal hasDemoData={data?.items.some((item) => item.itemCode?.startsWith("INV-DEMO-")) ?? false} onClose={() => { localStorage.setItem(welcomeStorageKey, "seen"); setShowWelcome(false); }} onAction={(action) => { localStorage.setItem(welcomeStorageKey, "seen"); setShowWelcome(false); if (action === "item") setModal("item"); else if (action === "location") setModal("location"); else setModal("shopping"); }} />}
      <AnimatePresence>{toast && <motion.div initial={{ opacity: 0, y: 20, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 12, x: "-50%" }} className="fixed bottom-24 left-1/2 z-[70] rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-2xl md:bottom-8" style={{ background: "#24242d" }}>{toast}</motion.div>}</AnimatePresence>
    </div>
  );
}

function AssistantLauncher({ onOpen }: { onOpen: () => void }) {
  const buttonSize = 48;
  const edge = 12;
  const bottomClearance = 96;
  const [mobile, setMobile] = useState(false);
  const [position, setPosition] = useState<AssistantPosition | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; moved: boolean; position: AssistantPosition } | null>(null);
  const suppressClickRef = useRef(false);

  const clampPosition = useCallback((candidate: AssistantPosition): AssistantPosition => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const maxY = Math.max(edge, height - buttonSize - bottomClearance);
    const y = Math.min(Math.max(candidate.y, edge), maxY);
    const x = Math.min(Math.max(candidate.x, edge), Math.max(edge, width - buttonSize - edge));
    return { x, y };
  }, []);

  useEffect(() => {
    const restore = () => {
      const isMobile = window.matchMedia("(max-width: 767px)").matches;
      setMobile(isMobile);
      if (!isMobile) return;
      try {
        const saved = JSON.parse(localStorage.getItem(assistantPositionStorageKey) || "null") as AssistantPosition | null;
        setPosition(clampPosition(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : { x: window.innerWidth - buttonSize - edge, y: window.innerHeight - buttonSize - bottomClearance }));
      } catch {
        setPosition(clampPosition({ x: window.innerWidth - buttonSize - edge, y: window.innerHeight - buttonSize - bottomClearance }));
      }
    };
    restore();
    window.addEventListener("resize", restore);
    return () => window.removeEventListener("resize", restore);
  }, [clampPosition]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!mobile) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top, moved: false, position: { x: bounds.left, y: bounds.top } };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!mobile || !drag || drag.pointerId !== event.pointerId) return;
    const next = clampPosition({ x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY });
    if (Math.abs(next.y - (position?.y ?? next.y)) > 4 || Math.abs(next.x - (position?.x ?? next.x)) > 4) drag.moved = true;
    drag.position = next;
    setPosition(next);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    if (drag.moved) {
      suppressClickRef.current = true;
      localStorage.setItem(assistantPositionStorageKey, JSON.stringify(drag.position));
    }
  };

  const mobileStyle = mobile && position ? { left: position.x, top: position.y, right: "auto", bottom: "auto", background: "var(--primary)" } : { background: "var(--primary)" };
  return <button onClick={() => { if (suppressClickRef.current) { suppressClickRef.current = false; return; } onOpen(); }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-[90] grid size-12 touch-none select-none place-items-center rounded-full text-white shadow-xl transition hover:scale-105 md:bottom-5 md:right-5 md:size-14" style={mobileStyle} aria-label="打开归物助手" title="归物助手：可在手机上沿屏幕边缘拖动"><Bot size={21} /></button>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-2.5"><div className="grid size-10 place-items-center rounded-2xl text-white shadow-lg" style={{ background: "var(--primary)" }}><Archive size={21} /></div>{!compact && <div><div className="flex items-center gap-2 text-lg font-black tracking-tight">归物 <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>v{APP_VERSION}</span></div><div className="text-[10px] font-semibold tracking-[.18em] muted">HOME INVENTORY</div></div>}</div>;
}

function PageTitle({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="mb-4 flex items-end justify-between gap-3 sm:mb-5"><div><h1 className="m-0 text-2xl font-black tracking-tight sm:text-3xl">{title}</h1><p className="mb-0 mt-1.5 text-sm muted">{text}</p></div>{action}</div>;
}

function DashboardView({ data, lowStock, expiring, expired, pending, totalValue, onNavigate, onEdit, onConsume, onDelete, onAddRestock, onQr, onAi, onAlerts }: { data: DashboardData; lowStock: Item[]; expiring: Item[]; expired: Item[]; pending: ShoppingItem[]; totalValue: number; onNavigate: (v: View) => void; onEdit: (i: Item) => void; onConsume: (i: Item) => void; onDelete: (i: Item) => void; onAddRestock: (i: Item) => void; onQr: (i: Item) => void; onAi: (i: Item) => void; onAlerts: () => void }) {
  const [recentView, setRecentView] = useState<"cards" | "list">("list");
  useEffect(() => {
    const saved = localStorage.getItem("home-inventory-recent-view-v2");
    if (saved !== "cards" && saved !== "list") return;
    const frame = requestAnimationFrame(() => setRecentView(saved));
    return () => cancelAnimationFrame(frame);
  }, []);
  const changeRecentView = (next: "cards" | "list") => { setRecentView(next); localStorage.setItem("home-inventory-recent-view-v2", next); };
  const stats = [
    { label: "全部物品", value: data.items.length, suffix: "件", icon: Boxes, color: "var(--primary)", bg: "var(--primary-soft)" },
    { label: "低库存", value: lowStock.length, suffix: "项", icon: CircleAlert, color: "#e37d25", bg: "#fff1df" },
    { label: "待采购", value: pending.length, suffix: "项", icon: ShoppingBasket, color: "#eb5b66", bg: "#ffe8eb" },
    { label: "估算价值", value: totalValue >= 10000 ? `${(totalValue / 10000).toFixed(1)}万` : `¥${Math.round(totalValue)}`, suffix: "", icon: Zap, color: "var(--success)", bg: "var(--success-soft)" },
  ];
  const visibleStats = data.items.length === 0 ? stats.slice(0, 1) : stats.filter(({ label, value }) => label === "全部物品" || (typeof value === "number" ? value > 0 : value !== "¥0"));
  const pendingNames = new Set(pending.map((item) => item.name.trim().toLocaleLowerCase()));
  const restockSuggestions = lowStock.filter((item) => !pendingNames.has(item.name.trim().toLocaleLowerCase())).slice(0, 3);
  const urgentExpiry = [...expired, ...expiring.filter((item) => new Date(item.expiryDate!).getTime() - appStartedAt <= 7 * 86400000)].slice(0, 4);
  return <>
    <PageTitle title="晚上好，家里一切有序" text={`今天有 ${lowStock.length + expiring.length + expired.length} 条库存与保质期事项值得留意。`} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {visibleStats.map(({ label, value, suffix, icon: Icon, color, bg }, index) => <motion.div layout key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .06 }} className="surface p-3.5 sm:p-4"><div className="mb-3 grid size-9 place-items-center rounded-xl" style={{ color, background: bg }}><Icon size={18} /></div><div className="flex items-end gap-1"><b className="text-2xl font-black sm:text-3xl">{value}</b><span className="mb-1 text-xs muted">{suffix}</span></div><div className="mt-1 text-xs font-semibold muted">{label}</div></motion.div>)}
    </div>

    {(lowStock.length > 0 || expiring.length > 0 || expired.length > 0) && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="my-4 flex min-h-16 items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm sm:gap-3 sm:px-4" style={{ background: "linear-gradient(100deg, #fff1df, #ffe8e8)", color: "#7d491f" }}><div className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/70 sm:size-9"><CircleAlert size={18} /></div><div className="min-w-0 flex-1 leading-tight"><b>{expired.length > 0 ? `${expired.length} 件物品已经过期` : "需要你的关注"}</b><div className="mt-1 truncate text-xs opacity-80">{lowStock.length} 件库存不足 · {expiring.length} 件即将到期</div></div><button onClick={onAlerts} className="flex shrink-0 items-center gap-0.5 text-xs font-bold sm:gap-1 sm:text-sm">查看提醒 <ChevronRight size={15} /></button></motion.div>}

    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,.7fr)]">
      <section className="surface min-w-0 p-3 sm:p-4"><div className="flex items-center justify-between gap-3"><h2 className="m-0 text-base font-black">最近更新</h2><div className="flex items-center gap-2"><div className="flex rounded-xl p-1" style={{ background: "var(--surface-soft)" }}><button data-testid="recent-view-cards" onClick={() => changeRecentView("cards")} className="grid size-8 place-items-center rounded-lg" style={recentView === "cards" ? { background: "var(--surface-solid)", color: "var(--primary)", boxShadow: "0 1px 4px rgba(0,0,0,.08)" } : { color: "var(--muted)" }} aria-label="卡片显示" title="卡片显示"><LayoutGrid size={15} /></button><button data-testid="recent-view-list" onClick={() => changeRecentView("list")} className="grid size-8 place-items-center rounded-lg" style={recentView === "list" ? { background: "var(--surface-solid)", color: "var(--primary)", boxShadow: "0 1px 4px rgba(0,0,0,.08)" } : { color: "var(--muted)" }} aria-label="列表显示" title="列表显示"><List size={16} /></button></div><button onClick={() => onNavigate("items")} className="flex items-center gap-1 text-xs font-bold" style={{ color: "var(--primary)" }}>查看全部<ChevronRight size={14} /></button></div></div>{recentView === "cards" ? <div data-testid="recent-cards" className="mt-3 grid gap-3 sm:grid-cols-2">{data.items.slice(0, 6).map((item) => <ItemCard key={item.id} item={item} onEdit={() => onEdit(item)} onConsume={() => onConsume(item)} onQr={() => onQr(item)} onAi={() => onAi(item)} compact />)}{data.items.length === 0 && <EmptyState icon={Boxes} title="还没有物品" text="点击右上角，录入家里的第一件物品" />}</div> : <div data-testid="recent-list" className="mt-3 space-y-1.5">{data.items.slice(0, 8).map((item) => <RecentItemRow key={item.id} item={item} onEdit={() => onEdit(item)} onQr={() => onQr(item)} onAi={() => onAi(item)} />)}{data.items.length === 0 && <EmptyState icon={Boxes} title="还没有物品" text="点击右上角，录入家里的第一件物品" />}</div>}</section>
      <div className="space-y-4"><HomeInsightsCompact data={data} />{restockSuggestions.length > 0 && <section className="surface p-4 sm:p-5"><SectionHead title="补货建议" action="查看物品与采购" onClick={() => onNavigate("items")} /><p className="mb-3 mt-1 text-xs muted">低库存但尚未在采购清单中，点一下就记好。</p><div className="space-y-1.5">{restockSuggestions.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background: "var(--surface-soft)" }}><CircleAlert size={15} style={{ color: "#e37d25" }} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{item.name}</div><div className="text-[11px] muted">{isLiquidConsumable(item) ? `余量 ${Math.round(item.remainingPercent)}%` : `建议补 ${Math.max(item.minQuantity - item.quantity, 1)} ${item.unit}`}</div></div><button type="button" onClick={() => onAddRestock(item)} className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs" style={{ color: "var(--primary)" }}>加入</button></div>)}</div></section>}{urgentExpiry.length > 0 && <section className="surface p-4 sm:p-5"><SectionHead title="临期处理" action="查看提醒" onClick={onAlerts} /><p className="mb-3 mt-1 text-xs muted">只收进 7 天内临期和已过期的东西，先处理最要紧的。</p><div className="space-y-1.5">{urgentExpiry.map((item) => { const isExpired = expired.some((entry) => entry.id === item.id); return <div key={item.id} className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background: "var(--surface-soft)" }}><AlertTriangle size={15} style={{ color: isExpired ? "var(--danger)" : "var(--warning)" }} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{item.name}</div><div className="text-[11px] muted">{isExpired ? "已过期" : `到期 ${new Date(item.expiryDate!).toLocaleDateString("zh-CN")}`}</div></div><button type="button" onClick={() => isExpired ? onDelete(item) : onEdit(item)} className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs" style={{ color: isExpired ? "var(--danger)" : "var(--primary)" }}>{isExpired ? "移入回收站" : "处理"}</button></div>; })}</div></section>}<section className="surface p-4 sm:p-5"><SectionHead title="采购清单" action="查看物品与采购" onClick={() => onNavigate("items")} /><div className="mt-4 space-y-2">{pending.slice(0, 4).map((item) => <div key={item.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><span className="size-2 rounded-full" style={{ background: item.priority === 2 ? "var(--danger)" : "var(--warning)" }} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{item.name}</div><div className="mt-0.5 text-xs muted">{item.quantity} {item.unit} · {item.category || "未分类"}</div></div></div>)}{pending.length === 0 && <EmptyState icon={Check} title="清单已完成" text="暂时没有需要采购的物品" />}</div></section></div>
    </div>
  </>;
}

function RecentItemRow({ item, onEdit, onQr, onAi }: { item: Item; onEdit: () => void; onQr: () => void; onAi: () => void }) {
  const ai = itemAiHighlights(item);
  const emoji = ({ 食品: "🍚", 饮品: "🥛", 清洁: "🧴", 家电: "📺", 数码: "💻", 衣物: "👕", 医药: "💊", 户外: "⛺" } as Record<string, string>)[item.category] || "📦";
  return <button onClick={onEdit} className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--surface-soft)]" style={{ background: "var(--surface-soft)" }}><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-cover bg-center text-base" style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : { background: "var(--surface-solid)" }}>{!item.imageUrl && emoji}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="truncate text-sm font-extrabold">{item.name}</span>{ai.hasHighlights && <Sparkles size={12} style={{ color: "var(--primary)" }} />}</div><div className="mt-0.5 truncate text-[11px] muted">{item.location?.name || "未设置位置"} · {item.category}{ai.summary ? ` · ${ai.summary}` : ai.storage ? ` · ${ai.storage}` : ""}</div></div><div className="flex shrink-0 items-center gap-1.5"><div className="text-right text-sm font-black">{item.quantity}<span className="ml-1 text-[10px] font-normal muted">{item.unit}</span></div><div className="flex gap-0.5 opacity-60 transition group-hover:opacity-100"><span onClick={(event) => { event.stopPropagation(); onAi(); }} className="grid size-6 place-items-center rounded-md hover:bg-[var(--surface-solid)]" aria-label="AI 物品助手"><Bot size={12} /></span><span onClick={(event) => { event.stopPropagation(); onQr(); }} className="grid size-6 place-items-center rounded-md hover:bg-[var(--surface-solid)]" aria-label="显示二维码"><QrCode size={12} /></span></div></div></button>;
}

function HomeInsightsCompact({ data }: { data: DashboardData }) {
  if (data.finance.currentMonthTotal <= 0 && data.finance.averageMonthly <= 0 && !data.finance.recent[0]) return null;
  return <section className="surface p-4 sm:p-5"><h2 className="m-0 text-base font-black">家庭状态</h2><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><div className="flex items-center gap-1.5 text-[11px] font-bold muted"><WalletCards size={13} />本月消费</div><div className="mt-2 text-lg font-black">¥{data.finance.currentMonthTotal.toFixed(0)}</div></div><div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><div className="text-[11px] font-bold muted">近 6 月均值</div><div className="mt-2 text-lg font-black">¥{data.finance.averageMonthly.toFixed(0)}</div></div></div>{data.finance.recent[0] && <div className="mt-3 truncate text-[11px] muted">最近：{data.finance.recent[0].itemName} ¥{data.finance.recent[0].totalPrice.toFixed(2)}</div>}</section>;
}

function ItemsView({ allItems, locations, items, shopping, search, setSearch, filter, setFilter, categoryFilter, setCategoryFilter, onEdit, onConsume, onRemainingChange, onDelete, onQr, onAi, onPrint, onToast, onCopy, onToggleShopping, onAddShopping, onDeleteShopping }: { allItems: Item[]; locations: Location[]; items: Item[]; shopping: ShoppingItem[]; search: string; setSearch: (s: string) => void; filter: "ALL" | ItemType; setFilter: (f: "ALL" | ItemType) => void; categoryFilter: string; setCategoryFilter: (f: string) => void; onEdit: (i: Item) => void; onConsume: (i: Item) => void; onRemainingChange: (item: Item, remainingPercent: number) => void; onDelete: (i: Item) => void; onQr: (i: Item) => void; onAi: (i: Item) => void; onPrint: (items: Item[]) => void; onToast: (message: string) => void; onCopy: (i: Item) => void; onToggleShopping: (item: ShoppingItem) => void; onAddShopping: () => void; onDeleteShopping: (id: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLocationOpen, setBulkLocationOpen] = useState(false);
  const [bulkLocationId, setBulkLocationId] = useState("");
  const dragging = useRef(false);
  const moved = useRef(false);
  useEffect(() => {
    const stop = () => { dragging.current = false; window.getSelection()?.removeAllRanges(); };
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);
  const selectedItems = allItems.filter((item) => selected.has(item.id));
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const dragSelect = (id: string) => setSelected((current) => current.has(id) ? current : new Set([...current, id]));
  const startDrag = (id: string) => { dragging.current = true; moved.current = false; dragSelect(id); };
  const enterDrag = (id: string) => { if (!dragging.current) return; moved.current = true; dragSelect(id); };
  const cardClick = (item: Item) => { if (moved.current) { moved.current = false; return; } onEdit(item); };
  const selectVisible = () => setSelected(new Set(items.map((item) => item.id)));
  const bulk = async (body: Record<string, unknown>, successMessage = "批量更新完成") => { try { await request("/api/items/bulk", { method: "PATCH", body: JSON.stringify({ ...body, ids: [...selected] }) }); setSelected(new Set()); setBulkLocationOpen(false); onToast(successMessage); } catch (error) { onToast(error instanceof Error ? error.message : "批量更新失败"); } };
  const bulkDelete = async () => { try { await request("/api/items/bulk", { method: "DELETE", body: JSON.stringify({ ids: [...selected] }) }); setSelected(new Set()); onToast("已移入回收站"); } catch (error) { onToast(error instanceof Error ? error.message : "批量删除失败"); } };
  const pendingShopping = shopping.filter((item) => item.status === "PENDING");
  const categoryOptions = ["ALL", ...Array.from(new Set([...categories, ...allItems.map((item) => item.category).filter(Boolean)]))];
  return <><PageTitle title="物品与采购" text="知道家里有什么，也记得还要买什么。" action={<button onClick={onAddShopping} className="btn-ghost hidden items-center gap-1.5 text-xs sm:flex"><ShoppingBasket size={15} />添加采购项</button>} />
    <div className="mb-4 space-y-3"><div className="md:hidden"><SearchBox items={allItems} value={search} onChange={setSearch} onSelect={(item) => setSearch(item.name)} placeholder="搜索名称或物品编号…" /></div>{selected.size === 0 ? <div className="flex min-w-0 items-center gap-3 overflow-x-auto pb-1"><div className="flex shrink-0 rounded-xl p-1" style={{ background: "var(--surface-soft)" }}>{([ ["ALL", "全部"], ["DURABLE", "耐用品"], ["CONSUMABLE", "消耗品"] ] as const).map(([id, label]) => <button key={id} onClick={() => setFilter(id)} className="rounded-lg px-3 py-1.5 text-sm font-bold transition" style={filter === id ? { background: "var(--surface-solid)", color: "var(--primary)", boxShadow: "var(--shadow-sm)" } : { color: "var(--muted)" }}>{label}</button>)}</div><span className="shrink-0 text-xs muted">{items.length} 件</span><span className="h-5 w-px shrink-0" style={{ background: "var(--border)" }} /><button onClick={selectVisible} disabled={items.length === 0} className="flex shrink-0 items-center gap-1.5 text-xs font-bold muted transition hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"><CheckSquare size={15} />选择当前结果</button></div> : <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1"><span className="shrink-0 text-xs font-black" style={{ color: "var(--primary)" }}>已选 {selected.size} 件</span><span className="h-5 w-px shrink-0" style={{ background: "var(--border)" }} /><button onClick={() => bulk({ category: items.find((item) => selected.has(item.id))?.category || "日用" })} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">沿用分类</button><button onClick={() => { setBulkLocationId(selectedItems[0]?.locationId ?? ""); setBulkLocationOpen(true); }} className="btn-ghost shrink-0 px-3 py-1.5 text-xs">批量移动位置</button><button onClick={() => onPrint(selectedItems)} className="btn-primary flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs"><Printer size={15} />打印二维码</button><button onClick={bulkDelete} className="btn-ghost shrink-0 px-3 py-1.5 text-xs text-red-500">移入回收站</button><button onClick={() => setSelected(new Set())} className="shrink-0 px-2 py-1.5 text-xs font-bold muted hover:text-[var(--foreground)]">取消</button></div>}</div>
    <div className="browse-layout"><nav className="browse-rail" aria-label="物品分类">{categoryOptions.map((category) => { const count = category === "ALL" ? allItems.length : allItems.filter((item) => item.category === category).length; return <button key={category} type="button" className="browse-rail-item" data-active={categoryFilter === category} onClick={() => setCategoryFilter(category)}><span>{category === "ALL" ? "全部分类" : category}</span><span className="browse-rail-count">{count}</span></button>; })}</nav><div className="min-w-0">{items.length ? <><p className="mb-3 text-xs muted">提示：按住鼠标左键拖过卡片，可连续选择多个物品。</p><div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{items.map((item, index) => <motion.div className="h-full min-w-0" key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .025, .2) }}><ItemCard item={item} selected={selected.has(item.id)} onSelect={() => toggle(item.id)} onSelectionPointerDown={() => startDrag(item.id)} onSelectionPointerEnter={() => enterDrag(item.id)} onEdit={() => cardClick(item)} onConsume={() => onConsume(item)} onRemainingChange={(remainingPercent) => onRemainingChange(item, remainingPercent)} onDelete={() => onDelete(item)} onQr={() => onQr(item)} onAi={() => onAi(item)} onCopy={() => onCopy(item)} /></motion.div>)}</div></> : <div className="surface rounded-3xl py-16"><EmptyState icon={Search} title="没有找到物品" text="换个关键词或筛选条件试试" /></div>}</div></div>
    <section className="mt-7 border-t pt-5" style={{ borderColor: "var(--border)" }}><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="m-0 text-base font-black">采购清单</h2><p className="mb-0 mt-1 text-xs muted">{pendingShopping.length ? `${pendingShopping.length} 项等你顺路带回家` : "暂时没有需要采购的东西"}</p></div><button onClick={onAddShopping} className="icon-action md:mr-16" aria-label="添加采购项" title="添加采购项"><Plus size={18} /></button></div>{pendingShopping.length ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{pendingShopping.map((item) => <ShoppingRow key={item.id} item={item} onToggle={() => onToggleShopping(item)} onDelete={() => onDeleteShopping(item.id)} />)}</div> : <button onClick={onAddShopping} className="flex items-center gap-2 text-xs font-bold" style={{ color: "var(--primary)" }}><Plus size={15} />添加第一项采购</button>}</section>
    {bulkLocationOpen && <Modal title="批量移动位置" subtitle={`已选 ${selected.size} 件物品，统一移动到新的存放位置。`} onClose={() => setBulkLocationOpen(false)}><div className="space-y-4"><Field label="新的存放位置"><select autoFocus className="input" value={bulkLocationId} onChange={(e) => setBulkLocationId(e.target.value)}>{[{ id: "", name: "未设置 / 清空位置" }, ...locations].map((location) => <option key={location.id || "empty"} value={location.id}>{location.name}</option>)}</select></Field><p className="m-0 text-xs muted">确认后会更新全部已选物品的存放位置。</p><div className="flex gap-3 pt-2"><button type="button" onClick={() => setBulkLocationOpen(false)} className="btn-ghost flex-1">取消</button><button type="button" onClick={() => void bulk({ locationId: bulkLocationId || null }, "批量移动位置已完成")} className="btn-primary flex-1">确认移动</button></div></div></Modal>}
  </>;
}

function ItemCard({ item, onEdit, onConsume, onRemainingChange, onDelete, onQr, onAi, onCopy, onSelect, onSelectionPointerDown, onSelectionPointerEnter, selected = false, compact = false }: { item: Item; onEdit: () => void; onConsume: () => void; onRemainingChange?: (remainingPercent: number) => void; onDelete?: () => void; onQr: () => void; onAi: () => void; onCopy?: () => void; onSelect?: () => void; onSelectionPointerDown?: () => void; onSelectionPointerEnter?: () => void; selected?: boolean; compact?: boolean }) {
  const low = item.type === "CONSUMABLE" && ((item.minQuantity > 0 && item.quantity <= item.minQuantity) || (isLiquidConsumable(item) && item.remainingPercent <= 20));
  const emoji = ({ 食品: "🍚", 饮品: "🥛", 清洁: "🧴", 家电: "📺", 数码: "💻", 衣物: "👕", 医药: "💊", 户外: "⛺" } as Record<string, string>)[item.category] || "📦";
  const dailyCost = dailyUsageCost(item);
  const ai = itemAiHighlights(item);
  const showRemaining = !compact && isLiquidConsumable(item) && onRemainingChange;
  const context = useContextMenu();
  const contextItems: ContextMenuItem[] = [{ label: "编辑物品", icon: Pencil, onClick: onEdit }, ...(onCopy ? [{ label: "复制物品编号", icon: Copy, onClick: onCopy }] : []), { label: "显示二维码", icon: QrCode, onClick: onQr }, { label: "AI 识别与建议", icon: Sparkles, onClick: onAi }];
  if (!compact && item.type === "CONSUMABLE" && !isLiquidConsumable(item)) contextItems.push({ label: "用掉 1 个单位", icon: Minus, onClick: onConsume, separatorBefore: true });
  if (onDelete) contextItems.push({ label: "移入回收站", icon: Trash2, onClick: onDelete, danger: true, separatorBefore: true });
  return <><div onClick={onEdit} onPointerDown={(event) => { if (!(event.target as HTMLElement).closest("button")) onSelectionPointerDown?.(); }} onPointerEnter={() => onSelectionPointerEnter?.()} onContextMenu={context.onContextMenu} className={`group relative flex h-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border transition duration-200 hover:border-[color-mix(in_srgb,var(--primary)_38%,var(--border))] ${compact ? "p-3" : "min-h-40 p-4"}`} style={{ background: "var(--surface-solid)", borderColor: selected ? "var(--primary)" : "var(--border)", boxShadow: selected ? "0 0 0 2px color-mix(in srgb, var(--primary) 18%, transparent)" : undefined }}>
    {onSelect && <button onClick={(event) => { event.stopPropagation(); onSelect(); }} className="absolute left-2 top-2 z-10 grid size-7 place-items-center rounded-full border-2 text-xs shadow-sm transition hover:scale-105" style={selected ? { background: "var(--primary)", borderColor: "var(--surface-solid)", color: "white", boxShadow: "0 0 0 2px var(--primary)" } : { background: "var(--surface-solid)", borderColor: "var(--border)" }} aria-label={selected ? "取消选择" : "选择物品"} title={selected ? "取消选择" : "选择物品"}>{selected ? <X size={14} strokeWidth={2.8} /> : <span className="sr-only">选择</span>}</button>}
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <div className={`${compact ? "size-12 text-xl" : "size-14 text-2xl"} grid shrink-0 place-items-center rounded-2xl bg-cover bg-center`} style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : { background: "var(--surface-soft)" }}>{!item.imageUrl && emoji}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h3 className="m-0 truncate text-sm font-extrabold sm:text-base">{item.name}</h3><p className="mb-0 mt-1 truncate text-xs muted">{item.location?.name || "未设置位置"} · {item.category}</p>{item.type === "CONSUMABLE" && item.purchaseDate && <p className="mb-0 mt-1 truncate text-[10px] font-semibold muted">购买日期：{new Date(item.purchaseDate).toLocaleDateString("zh-CN")}</p>}<p className="mb-0 mt-1 truncate text-[10px] font-semibold muted">{item.itemCode || item.id}</p></div>{low && <span className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: "#ffe8e8", color: "#d54b57" }}>需补货</span>}</div>
        {!compact && dailyCost && <div className="mt-3 flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-[11px]" style={{ background: "var(--surface-soft)" }}><span className="font-bold">日均 ¥{dailyCost.cost.toFixed(dailyCost.cost >= 10 ? 0 : 2)}</span><span className="muted">已使用 {dailyCost.days} 天</span></div>}
        {ai.hasHighlights && <div className={`item-card-ai min-w-0 max-w-full overflow-hidden ${compact ? "mt-2" : "mt-3"} rounded-xl px-2.5 py-2`} style={{ background: "color-mix(in srgb, var(--primary) 7%, var(--surface-soft))" }}><div className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold" style={{ color: "var(--primary)" }}><Sparkles className="shrink-0" size={12} /><span className="min-w-0 flex-1 truncate">{ai.summary || ai.storage || ai.usage || ai.replenishment}</span></div>{!compact && <div className="mt-1.5 min-w-0 space-y-1 overflow-hidden text-[10px] muted">{ai.storage && <div className="truncate"><b>存储：</b>{ai.storage}</div>}{(ai.usage || ai.replenishment) && <div className="truncate"><b>建议：</b>{ai.usage || ai.replenishment}</div>}</div>}</div>}
      </div>
      {showRemaining && <RemainingLevel value={item.remainingPercent} onChange={onRemainingChange} />}
    </div>
    <div className={`mt-auto flex h-8 items-center gap-2 ${compact ? "pt-2" : "pt-4"}`}><div className="flex min-w-0 flex-1 items-center">{!compact && <><span className="text-xl font-black leading-none">{item.quantity}</span><span className="ml-1 text-xs muted">{item.unit}</span></>}</div><div className="flex h-8 shrink-0 items-center gap-1.5"><button onClick={(event) => { event.stopPropagation(); onAi(); }} className="icon-action" aria-label="AI 物品助手" title="AI 物品助手"><Bot size={15} /></button><button onClick={(event) => { event.stopPropagation(); onQr(); }} className="icon-action" aria-label="显示二维码" title="显示二维码"><QrCode size={15} /></button>{!compact && item.type === "CONSUMABLE" && !isLiquidConsumable(item) && <button onClick={(event) => { event.stopPropagation(); onConsume(); }} className="btn-ghost flex h-8 min-h-8 items-center gap-1 px-2.5 py-0 text-xs"><Minus size={14} /> 用掉</button>}{!compact && onDelete && <button onClick={(event) => { event.stopPropagation(); onDelete(); }} className="icon-action hidden text-red-500 group-hover:inline-grid" aria-label="删除物品"><Trash2 size={14} /></button>}</div></div>
  </div><ContextMenu menu={context.menu} items={contextItems} onClose={context.close} /></>;
}

function RemainingLevel({ value, onChange }: { value: number; onChange: (remainingPercent: number) => void }) {
  const normalized = Math.min(100, Math.max(0, Math.round(value)));
  const [draftLevel, setDraftLevel] = useState<number | null>(null);
  const level = draftLevel ?? normalized;
  const setNext = (next: number) => { const snapped = Math.min(100, Math.max(0, Math.round(next / 5) * 5)); setDraftLevel(snapped); return snapped; };
  const fromPointer = (event: React.PointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return setNext(((rect.bottom - event.clientY) / rect.height) * 100); };
  const color = level <= 20 ? "var(--danger)" : level <= 45 ? "var(--warning)" : "var(--primary)";
  return <div className="flex shrink-0 flex-col items-center" onClick={(event) => event.stopPropagation()}>
    <div role="slider" tabIndex={0} aria-label={`${level}% 剩余量，上下拖动调整`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={level} title="上下拖动调整剩余量" className="relative h-[70px] w-10 touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); fromPointer(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event); }} onPointerUp={(event) => { const next = fromPointer(event); event.currentTarget.releasePointerCapture(event.pointerId); onChange(next); setDraftLevel(null); }} onPointerCancel={() => { onChange(level); setDraftLevel(null); }} onKeyDown={(event) => { if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const next = event.key === "Home" ? 0 : event.key === "End" ? 100 : level + (event.key === "ArrowUp" ? 5 : -5); onChange(setNext(next)); setDraftLevel(null); }}>
      <div className="absolute left-1/2 top-0 h-3 w-4 -translate-x-1/2 rounded-t-md border border-b-0" style={{ borderColor: "var(--muted)" }} />
      <div className="absolute inset-x-0 bottom-0 top-2 overflow-hidden rounded-[11px] border-2" style={{ borderColor: "var(--muted)", background: "var(--surface-soft)" }}>
        <div className="absolute inset-x-0 bottom-0 transition-[height] duration-75" style={{ height: `${level}%`, background: `linear-gradient(180deg, color-mix(in srgb, ${color} 68%, white), ${color})` }}><span className="absolute left-1 top-1 h-5 w-1 rounded-full bg-white/45" /></div>
      </div>
    </div>
    <span className="mt-1 text-[10px] font-black" style={{ color }}>{level}%</span>
  </div>;
}

function ShoppingView({ items, onToggle, onAdd, onDelete }: { items: ShoppingItem[]; onToggle: (i: ShoppingItem) => void; onAdd: () => void; onDelete: (id: string) => void }) {
  const pending = items.filter((i) => i.status === "PENDING"), done = items.filter((i) => i.status === "PURCHASED");
  return <><PageTitle title="采购清单" text="低库存自动提醒，也可以随手记一笔。" action={<button onClick={onAdd} className="btn-primary flex items-center gap-2"><Plus size={18} /><span className="desktop-only">添加采购项</span></button>} />
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]"><section className="surface rounded-3xl p-4 sm:p-5"><div className="mb-3 flex items-center justify-between"><b>待采购</b><span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>{pending.length} 项</span></div><div className="space-y-2">{pending.map((item) => <ShoppingRow key={item.id} item={item} onToggle={() => onToggle(item)} onDelete={() => onDelete(item.id)} />)}{pending.length === 0 && <EmptyState icon={Check} title="全部买齐啦" text="新的低库存物品会自动出现在这里" />}</div></section>
      {(pending.length > 0 || done.length > 0) && <aside className="surface p-4"><h3 className="m-0 text-base">本次采购概览</h3><div className="my-4 grid grid-cols-2 gap-3"><div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><b className="text-2xl">{pending.length}</b><div className="mt-1 text-xs muted">待采购</div></div><div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><b className="text-2xl">{done.length}</b><div className="mt-1 text-xs muted">已完成</div></div></div>{done.length > 0 && <><div className="mb-2 text-xs font-bold muted">最近完成</div>{done.slice(0, 4).map((item) => <ShoppingRow key={item.id} item={item} onToggle={() => onToggle(item)} onDelete={() => onDelete(item.id)} compact />)}</>}</aside>}</div>
  </>;
}

function ShoppingRow({ item, onToggle, onDelete, compact = false }: { item: ShoppingItem; onToggle: () => void; onDelete: () => void; compact?: boolean }) {
  const done = item.status === "PURCHASED";
  const context = useContextMenu();
  const contextItems: ContextMenuItem[] = [{ label: done ? "标记为待采购" : "标记为已采购", icon: Check, onClick: onToggle }, { label: "删除采购项", icon: X, onClick: onDelete, danger: true, separatorBefore: true }];
  return <><motion.div layout onContextMenu={context.onContextMenu} className={`group flex items-center gap-3 rounded-2xl ${compact ? "py-2" : "p-3"}`} style={compact ? {} : { background: "var(--surface-soft)" }}><button onClick={onToggle} className="grid size-6 shrink-0 place-items-center rounded-lg border transition" style={done ? { background: "var(--success)", borderColor: "var(--success)", color: "white" } : { borderColor: "var(--border)", background: "var(--surface-solid)" }}>{done && <Check size={14} />}</button><div className="min-w-0 flex-1"><div className={`truncate text-sm font-bold ${done ? "line-through opacity-50" : ""}`}>{item.name}</div>{!compact && <div className="mt-0.5 text-xs muted">{item.quantity} {item.unit} · {item.source === "low-stock" ? "库存提醒" : item.category || "手动添加"}</div>}</div>{!compact && item.priority === 2 && !done && <span className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: "#ffe8e8", color: "#d54b57" }}>优先</span>}<button onClick={onDelete} className="p-1.5 opacity-0 muted transition group-hover:opacity-100"><X size={15} /></button></motion.div><ContextMenu menu={context.menu} items={contextItems} onClose={context.close} /></>;
}

function LocationsView({ locations, items, onAdd, onOpen, onEdit, onToast }: { locations: Location[]; items: Item[]; onAdd: () => void; onOpen: (name: string) => void; onEdit: (location: Location) => void; onToast: (message: string) => void }) {
  const [selectedLocationId, setSelectedLocationId] = useState("ALL");
  const visibleLocations = selectedLocationId === "ALL" ? locations : locations.filter((location) => location.id === selectedLocationId);
  return <><PageTitle title="家庭空间" text="按房间和收纳位置快速找到物品。" action={<button onClick={onAdd} className="btn-primary flex items-center gap-2"><Plus size={18} /><span className="desktop-only">添加空间</span></button>} /><div className="browse-layout"><nav className="browse-rail" aria-label="空间索引"><button type="button" className="browse-rail-item" data-active={selectedLocationId === "ALL"} onClick={() => setSelectedLocationId("ALL")}><span>全部空间</span><span className="browse-rail-count">{locations.length}</span></button>{locations.map((location) => <button key={location.id} type="button" className="browse-rail-item" data-active={selectedLocationId === location.id} onClick={() => setSelectedLocationId(location.id)}><span className="truncate">{location.name}</span><span className="browse-rail-count">{items.filter((item) => item.locationId === location.id).length}</span></button>)}</nav><div className="min-w-0"><div className="mb-3 text-xs muted">{selectedLocationId === "ALL" ? "选择一个空间，快速浏览其中的物品。" : "点击空间卡片可直接查看其中物品。"}</div>{visibleLocations.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visibleLocations.map((location, index) => <LocationCard key={location.id} location={location} items={items} index={index} onOpen={onOpen} onEdit={onEdit} onToast={onToast} />)}</div> : <div className="surface rounded-3xl py-16"><EmptyState icon={MapPin} title="还没有空间" text="先添加一个房间或收纳位置吧" /></div>}</div></div></>;
}

function LocationCard({ location, items, index, onOpen, onEdit, onToast }: { location: Location; items: Item[]; index: number; onOpen: (name: string) => void; onEdit: (location: Location) => void; onToast: (message: string) => void }) {
  const Icon = iconMap[location.icon as keyof typeof iconMap] || Package;
  const count = items.filter((i) => i.locationId === location.id).length;
  const consumables = items.filter((i) => i.locationId === location.id && i.type === "CONSUMABLE").length;
  const context = useContextMenu();
  const remove = async () => { if (!confirm(`确定删除空间“${location.name}”？`)) return; try { const response = await fetch(`/api/locations/${location.id}`, { method: "DELETE" }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "删除失败"); onToast("空间已删除"); window.location.reload(); } catch (error) { onToast(error instanceof Error ? error.message : "删除失败"); } };
  const setThumbnail = async () => { const value = window.prompt("输入该空间的缩略图 URL（留空可清除）", location.thumbnailUrl || ""); if (value === null) return; try { await request(`/api/locations/${location.id}`, { method: "PATCH", body: JSON.stringify({ thumbnailUrl: value.trim() }) }); onToast(value.trim() ? "空间缩略图已更新" : "空间缩略图已清除"); window.location.reload(); } catch (error) { onToast(error instanceof Error ? error.message : "缩略图保存失败"); } };
  const contextItems: ContextMenuItem[] = [{ label: "打开空间", icon: ExternalLink, onClick: () => onOpen(location.name) }, { label: "设置缩略图 URL", icon: ImagePlus, onClick: setThumbnail }, { label: "编辑空间", icon: Pencil, onClick: () => onEdit(location) }, { label: "复制空间名称", icon: Copy, onClick: async () => { try { await navigator.clipboard.writeText(location.name); onToast("空间名称已复制"); } catch { onToast("复制失败"); } } }, { label: "删除空间", icon: Trash2, danger: true, separatorBefore: true, onClick: remove }];
  return <><motion.button onContextMenu={context.onContextMenu} key={location.id} initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * .05 }} onClick={() => onOpen(location.name)} className="surface group relative overflow-hidden rounded-xl p-4 text-left transition hover:border-[color-mix(in_srgb,var(--primary)_38%,var(--border))]"><div className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20" style={location.thumbnailUrl ? { backgroundImage: `url(${location.thumbnailUrl})` } : undefined} /><div className="relative"><div className="mb-4 flex items-start justify-between"><div className="grid size-12 place-items-center rounded-2xl" style={{ color: location.color, background: `color-mix(in srgb, ${location.color} 12%, var(--surface-solid))` }}><Icon size={23} /></div><ChevronRight className="muted transition group-hover:translate-x-1" size={18} /></div><h3 className="m-0 text-lg font-black">{location.name}</h3><p className="mb-0 mt-1.5 text-sm muted">{count} 件物品 · {consumables} 件消耗品</p></div></motion.button><ContextMenu menu={context.menu} items={contextItems} onClose={context.close} /></>;
}

function SettingsView({ onToast, onAbout, onRecycle }: { onToast: (message: string) => void; onAbout: () => void; onRecycle: () => void }) {
  const [database, setDatabase] = useState<{ databaseLabel: string; storageMode: string } | null>(null);
  useEffect(() => { let active = true; request<{ databaseLabel: string; storageMode: string }>("/api/system/info").then((result) => { if (active) setDatabase(result); }).catch(() => undefined); return () => { active = false; }; }, []);
  return <><PageTitle title="设置" text="按类别展开需要修改的设置，保持页面简洁。" action={<button onClick={onRecycle} className="btn-ghost grid size-10 shrink-0 place-items-center p-0 sm:flex sm:h-auto sm:w-auto sm:gap-2 sm:px-3" aria-label="打开回收站" title="回收站"><Trash2 size={16} /><span className="hidden sm:inline">回收站</span></button>} /><div className="grid max-w-5xl items-start gap-4 lg:grid-cols-2">
    <AccountSettings onToast={onToast} />
    <AiSettings onToast={onToast} />
    <DataTools onToast={onToast} />
    <OssSettings onToast={onToast} />
    <details className="surface group rounded-3xl p-5"><summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden"><div className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><Grid2X2 size={20} /></div><div className="min-w-0 flex-1"><h3 className="m-0 text-sm font-black">数据与部署</h3><p className="mb-0 mt-1 truncate text-xs muted">{database ? `${database.databaseLabel} · ${database.storageMode}` : "正在读取运行环境"}</p></div><ChevronDown size={17} className="muted transition-transform group-open:rotate-180" /></summary><div className="mt-5 border-t pt-1" style={{ borderColor: "var(--border)" }}><SettingRow icon={Grid2X2} title={`当前数据库：${database?.databaseLabel || "检测中…"}`} text={database ? `${database.storageMode} · 可通过 DATABASE_PROVIDER 切换` : "正在读取运行环境"} action={<span className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>{database?.databaseLabel || "检测中"}</span>} /><SettingRow icon={Info} title="关于归物" text={`版本 ${APP_VERSION} · 更新说明与使用提示`} action={<button onClick={onAbout} className="btn-ghost text-xs">查看</button>} /></div></details>
  </div></>;
}

function SettingRow({ icon: Icon, title, text, action }: { icon: typeof Settings; title: string; text: string; action?: React.ReactNode }) { return <div className="mt-4 flex items-center gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}><div className="grid size-10 place-items-center rounded-2xl" style={{ background: "var(--surface-soft)" }}><Icon size={18} /></div><div className="min-w-0 flex-1"><div className="text-sm font-bold">{title}</div><div className="mt-0.5 text-xs muted">{text}</div></div>{action}</div>; }

function SearchBox({ items, value, onChange, onSelect, onFocus, placeholder }: { items: Item[]; value: string; onChange: (value: string) => void; onSelect: (item: Item) => void; onFocus?: () => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const suggestions = useMemo(() => {
    const term = value.trim().toLowerCase();
    const matches = term ? items.filter((item) => [item.name, item.itemCode, item.category, item.location?.name].some((field) => field?.toLowerCase().includes(term))) : items;
    return matches.slice(0, 6);
  }, [items, value]);
  return <div className="relative z-20"><Search className="pointer-events-none absolute left-3.5 top-[22px] -translate-y-1/2 muted" size={18} /><input value={value} onChange={(event) => { onChange(event.target.value); setOpen(true); }} onFocus={() => { setOpen(true); onFocus?.(); }} onBlur={() => setTimeout(() => setOpen(false), 120)} className="input search-input" placeholder={placeholder} autoComplete="off" />
    <AnimatePresence>{open && suggestions.length > 0 && <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 4 }} exit={{ opacity: 0, y: -4 }} className="absolute left-0 right-0 top-full overflow-hidden rounded-2xl border p-1 shadow-2xl" style={{ background: "var(--surface-solid)", borderColor: "var(--border)" }}>{suggestions.map((item) => <button type="button" key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { onSelect(item); setOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--surface-soft)]"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-cover bg-center text-lg" style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : { background: "var(--surface-soft)" }}>{!item.imageUrl && "📦"}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{item.name}</div><div className="mt-0.5 truncate text-[11px] muted">{item.itemCode || item.id} · {item.location?.name || "未设置位置"}</div></div><ChevronRight size={14} className="muted" /></button>)}</motion.div>}</AnimatePresence>
  </div>;
}

type OssForm = { configured: boolean; managedByEnvironment: boolean; storageMode: "local" | "oss" | "both"; localDirectory: string; region: string; endpoint: string; bucket: string; directory: string; accessKeyId: string; accessKeySecretConfigured: boolean; publicBaseUrl: string; accessKeySecret: string };
const emptyOssForm: OssForm = { configured: false, managedByEnvironment: false, storageMode: "local", localDirectory: "/app/data/uploads", region: "", endpoint: "", bucket: "", directory: "home-inventory", accessKeyId: "", accessKeySecretConfigured: false, publicBaseUrl: "", accessKeySecret: "" };

function OssSettings({ onToast }: { onToast: (message: string) => void }) {
  const [form, setForm] = useState<OssForm>(emptyOssForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    request<Omit<OssForm, "accessKeySecret">>("/api/settings/oss").then((result) => { if (active) setForm({ ...result, accessKeySecret: "" }); }).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const set = (key: keyof OssForm, value: string) => setForm((old) => ({ ...old, [key]: value }));
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); try { await request("/api/settings/oss", { method: "PATCH", body: JSON.stringify(form) }); setForm((old) => ({ ...old, configured: true, accessKeySecretConfigured: true, accessKeySecret: "" })); onToast("OSS 设置已保存"); } catch (error) { onToast(error instanceof Error ? error.message : "保存失败"); } finally { setSaving(false); } };
  const needsOss = form.storageMode === "oss" || form.storageMode === "both";
  return <details className="surface group rounded-3xl p-5"><summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden"><div className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><Cloud size={20} /></div><div className="min-w-0 flex-1"><h3 className="m-0 text-sm font-black">图片存储</h3><p className="mb-0 mt-1 truncate text-xs muted">{form.storageMode === "local" ? "本地目录 · 5MB 限制" : form.configured ? `${form.bucket}/${form.directory}` : "OSS / 本地目录"}</p></div><span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: form.configured ? "var(--success-soft)" : "var(--surface-soft)", color: form.configured ? "var(--success)" : "var(--muted)" }}>{loading ? "检测中" : form.configured ? "已配置" : "未配置"}</span><ChevronDown size={17} className="muted transition-transform group-open:rotate-180" /></summary>
    {!loading && <form onSubmit={save} className="mt-5 space-y-3 border-t pt-5" style={{ borderColor: "var(--border)" }}><Field label="保存方式"><select disabled={form.managedByEnvironment} className="input" value={form.storageMode} onChange={(e) => set("storageMode", e.target.value as OssForm["storageMode"])}><option value="local">仅本地目录（推荐，免 OSS）</option><option value="oss">仅 OSS</option><option value="both">本地目录 + OSS（双写）</option></select></Field><Field label="本地图片目录"><input disabled={form.managedByEnvironment} className="input" value={form.localDirectory} onChange={(e) => set("localDirectory", e.target.value)} placeholder="/app/data/uploads" /><span className="mt-1.5 block text-[11px] leading-5 muted">Docker 中建议使用 /app/data/uploads，图片会随 home_inventory_data 卷持久化。</span></Field>{needsOss && <><div className="grid gap-3 sm:grid-cols-2"><Field label="Region"><input required disabled={form.managedByEnvironment} className="input" value={form.region} onChange={(e) => set("region", e.target.value)} placeholder="oss-cn-hangzhou" /></Field><Field label="Bucket"><input required disabled={form.managedByEnvironment} className="input" value={form.bucket} onChange={(e) => set("bucket", e.target.value)} placeholder="home-inventory" /></Field></div><Field label="存储目录"><input required disabled={form.managedByEnvironment} className="input" value={form.directory} onChange={(e) => set("directory", e.target.value)} placeholder="home-inventory" /></Field><Field label="Endpoint（可选）"><input disabled={form.managedByEnvironment} className="input" value={form.endpoint} onChange={(e) => set("endpoint", e.target.value)} placeholder="https://oss-cn-hangzhou.aliyuncs.com" /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="AccessKey ID"><input required disabled={form.managedByEnvironment} className="input" value={form.accessKeyId} onChange={(e) => set("accessKeyId", e.target.value)} autoComplete="off" /></Field><Field label="AccessKey Secret"><input disabled={form.managedByEnvironment} className="input" type="password" value={form.accessKeySecret} onChange={(e) => set("accessKeySecret", e.target.value)} placeholder={form.accessKeySecretConfigured ? "已保存，留空则不修改" : "首次配置必填"} autoComplete="new-password" /></Field></div><Field label="公开访问域名（可选）"><input disabled={form.managedByEnvironment} className="input" value={form.publicBaseUrl} onChange={(e) => set("publicBaseUrl", e.target.value)} placeholder="https://img.example.com" /></Field></>}<div className="flex items-center justify-between gap-3 pt-1"><p className="m-0 text-[11px] leading-5 muted">图片支持 JPG、PNG、WebP、GIF，上传前自动压缩，最终大小限制 5MB。</p>{form.managedByEnvironment ? <span className="whitespace-nowrap text-xs font-bold muted">环境变量托管</span> : <button disabled={saving} className="btn-primary whitespace-nowrap px-4 py-2 text-sm">{saving ? "保存中…" : "保存图片设置"}</button>}</div></form>}
  </details>;
}

function NotificationsModal({ lowStock, expiring, expired, onClose, onOpenItem, onDispose, onShopping }: { lowStock: Item[]; expiring: Item[]; expired: Item[]; onClose: () => void; onOpenItem: (item: Item) => void; onDispose: (item: Item) => void; onShopping: () => void }) {
  const alerts = [
    ...expired.map((item) => ({ item, label: `${["食品", "饮品"].includes(item.category) ? "食品" : "物品"}已过期 · ${new Date(item.expiryDate!).toLocaleDateString("zh-CN")}`, color: "var(--danger)" })),
    ...expiring.filter((item) => !expired.some((old) => old.id === item.id)).map((item) => ({ item, label: `${["食品", "饮品"].includes(item.category) ? "食品即将到期" : "即将到期"} · ${new Date(item.expiryDate!).toLocaleDateString("zh-CN")}`, color: "var(--warning)" })),
    ...lowStock.filter((item) => !expired.some((old) => old.id === item.id)).map((item) => ({ item, label: isLiquidConsumable(item) && item.remainingPercent <= 20 ? `剩余量仅 ${Math.round(item.remainingPercent)}%` : `库存仅剩 ${item.quantity} ${item.unit}`, color: "#e37d25" })),
  ];
  return <Modal title="提醒中心" subtitle={`${alerts.length} 条待处理事项`} onClose={onClose}><div className="space-y-2">{alerts.map(({ item, label, color }) => <div key={`${item.id}-${label}`} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><span className="size-2 shrink-0 rounded-full" style={{ background: color }} /><button type="button" onClick={() => onOpenItem(item)} className="min-w-0 flex-1 text-left"><div className="truncate text-sm font-bold">{item.name}</div><div className="mt-1 text-xs muted">{label}</div></button>{expired.some((entry) => entry.id === item.id) ? <button type="button" onClick={() => onDispose(item)} className="shrink-0 text-xs font-bold" style={{ color: "var(--danger)" }}>移入回收站</button> : <ChevronRight size={16} className="muted" />}</div>)}{alerts.length === 0 && <EmptyState icon={Check} title="暂无提醒" text="库存和保质期都在安全范围内" />}</div>{lowStock.length > 0 && <button onClick={onShopping} className="btn-primary mt-4 w-full">查看采购清单</button>}</Modal>;
}

function AboutView() {
  return <><PageTitle title="关于归物" text="轻量、清楚、真正适合家庭日常使用。" /><div className="max-w-3xl space-y-3"><section className="surface rounded-3xl p-6"><div className="flex items-center gap-4"><div className="grid size-14 place-items-center rounded-3xl text-white" style={{ background: "var(--primary)" }}><Archive size={26} /></div><div><h2 className="m-0 text-xl font-black">归物 HomeInventory</h2><p className="mb-0 mt-1 text-sm muted">版本 {APP_VERSION} · MVP 迭代起点</p></div></div><p className="mb-0 mt-5 text-sm leading-7 muted">归物帮助家庭记录物品、消耗品、保质期、采购与价格。功能设计遵循“少一步操作、少一个干扰”的原则，复杂能力放在需要时再展开。</p></section><section className="surface flex flex-wrap items-center gap-2.5 px-4 py-3"><span className="text-xs font-black">{APP_VERSION} 更新</span><span className="h-3 w-px" style={{ background: "var(--border)" }} /><span className="text-xs muted">示范数据</span><span className="text-xs muted">保质期预警</span><span className="text-xs muted">消费概览</span></section></div></>;
}

function WelcomeModal({ hasDemoData, onClose, onAction }: { hasDemoData: boolean; onClose: () => void; onAction: (action: "item" | "location" | "shopping") => void }) {
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] grid place-items-center bg-black/35 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><motion.div initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="w-full max-w-md rounded-[28px] p-5 shadow-2xl sm:p-6" style={{ background: "var(--surface-solid)" }}><div className="flex items-start gap-3"><div className="grid size-11 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "var(--primary)" }}><Archive size={21} /></div><div className="min-w-0 flex-1"><div className="text-xs font-bold" style={{ color: "var(--primary)" }}>欢迎使用 · v{APP_VERSION}</div><h2 className="mb-0 mt-1 text-xl font-black">从一件小事开始整理</h2></div><button type="button" onClick={onClose} className="btn-ghost grid size-8 place-items-center p-0" aria-label="暂时跳过欢迎引导"><X size={16} /></button></div><p className="mb-0 mt-3 text-sm leading-6 muted">{hasDemoData ? "示范数据已经准备好。也可以从下面任意一步开始，完成后引导会自动收起。" : "只需选一个起点，剩下的以后慢慢补齐。完成第一步后，这张小卡会自动收起。"}</p><div className="mt-4 grid gap-2"><WelcomeAction icon={Package} title="录入一件物品" text="从眼前的东西开始" onClick={() => onAction("item")} /><WelcomeAction icon={MapPin} title="建一个家庭空间" text="例如厨房、衣柜或收纳箱" onClick={() => onAction("location")} /><WelcomeAction icon={ShoppingBasket} title="写一条购物清单" text="先把下次要买的记住" onClick={() => onAction("shopping")} /></div><button onClick={onClose} className="mt-4 w-full text-xs font-bold muted hover:text-[var(--foreground)]">我先随便看看</button></motion.div></motion.div>;
}

function WelcomePoint({ icon: Icon, text }: { icon: typeof Package; text: string }) { return <div className="flex items-center gap-2 rounded-2xl p-3 text-xs font-bold" style={{ background: "var(--surface-soft)" }}><Icon size={16} style={{ color: "var(--primary)" }} />{text}</div>; }
function WelcomeAction({ icon: Icon, title, text, onClick }: { icon: typeof Package; title: string; text: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-[var(--surface-soft)]" style={{ background: "var(--surface-soft)" }}><span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ background: "var(--surface-solid)", color: "var(--primary)" }}><Icon size={16} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold">{title}</span><span className="mt-0.5 block truncate text-[11px] muted">{text}</span></span><ChevronRight size={15} className="muted" /></button>; }

function QrModal({ item, onClose, onPrint }: { item: Item; onClose: () => void; onPrint: () => void }) {
  const url = `${globalThis.location?.origin || ""}/items/${item.id}`;
  return <Modal title="物品二维码" subtitle="扫码即可快速查看物品信息" onClose={onClose}><div className="grid place-items-center"><div className="rounded-3xl bg-white p-5"><QRCodeSVG value={url} size={220} level="M" includeMargin /></div><div className="mt-4 text-center"><div className="text-lg font-black">{item.name}</div><div className="mt-1 font-mono text-xs muted">{item.itemCode || item.id}</div><div className="mt-2 text-xs muted">{item.category} · {item.location?.name || "未设置位置"} · {item.quantity}{item.unit}</div></div><div className="mt-5 flex gap-2"><a href={url} target="_blank" rel="noreferrer" className="btn-ghost text-sm">打开详情</a><button onClick={onPrint} className="btn-primary flex items-center gap-2 text-sm"><Printer size={16} />打印二维码</button></div></div></Modal>;
}

function ItemModal({ locations, allItems, item, onClose, onSaved }: { locations: Location[]; allItems: Item[]; item: Item | null; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<ItemDraft>(() => item ? { name: item.name, category: item.category, type: item.type, quantity: item.quantity, minQuantity: item.minQuantity, remainingPercent: item.remainingPercent, unit: item.unit, price: item.price?.toString() ?? "", purchaseDate: item.purchaseDate?.slice(0, 10) ?? "", expiryDate: item.type === "CONSUMABLE" ? item.expiryDate?.slice(0, 10) ?? "" : "", locationId: item.locationId ?? "", notes: item.notes ?? "", imageUrl: item.imageUrl ?? "", aiSummary: item.aiSummary ?? "", aiStorageAdvice: item.aiStorageAdvice ?? "", aiUsageAdvice: item.aiUsageAdvice ?? "", aiReplenishmentAdvice: item.aiReplenishmentAdvice ?? "" } : emptyDraft);
  const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false); const [aiLoading, setAiLoading] = useState(false); const [moreOpen, setMoreOpen] = useState(false); const [imagePreviewOpen, setImagePreviewOpen] = useState(false); const [error, setError] = useState("");
  const [imageMode, setImageMode] = useState<"upload" | "link">(item?.imageUrl ? "link" : "upload");
  const [imageUrlDraft, setImageUrlDraft] = useState(item?.imageUrl ?? "");
  const [recordPurchase, setRecordPurchase] = useState(!item);
  const [purchaseStore, setPurchaseStore] = useState("");
  const [availableLocations, setAvailableLocations] = useState(locations);
  const [quickLocationOpen, setQuickLocationOpen] = useState(false);
  const normalizedName = draft.name.trim().replace(/\s+/g, "").toLocaleLowerCase();
  const duplicates = !item && normalizedName ? allItems.filter((entry) => entry.name.trim().replace(/\s+/g, "").toLocaleLowerCase() === normalizedName) : [];
  const suggestedLocation = useMemo(() => {
    if (item || draft.locationId) return null;
    const sameName = allItems.filter((entry) => normalizedName && entry.name.trim().replace(/\s+/g, "").toLocaleLowerCase() === normalizedName && entry.location);
    const sameCategory = allItems.filter((entry) => entry.category === draft.category && entry.location);
    return [...sameName, ...sameCategory].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]?.location ?? null;
  }, [allItems, draft.category, draft.locationId, item, normalizedName]);
  const set = (key: keyof ItemDraft, value: string | number) => setDraft((old) => ({ ...old, [key]: value }));
  const uploadImage = async (file?: File) => { if (!file) return; setUploading(true); setError(""); try { const compressed = await compressImage(file); const form = new FormData(); form.append("file", compressed); const response = await fetch("/api/upload", { method: "POST", body: form }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "上传失败"); set("imageUrl", result.url); } catch (e) { setError(e instanceof Error ? e.message : "上传失败"); } finally { setUploading(false); } };
  const applyImageUrl = () => { const value = imageUrlDraft.trim(); if (!value) { set("imageUrl", ""); setError(""); return; } try { const url = new URL(value); if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(); set("imageUrl", value); setError(""); } catch { setError("请粘贴以 http:// 或 https:// 开头的图片地址"); } };
  const applyAi = (analysis: AiAnalysis) => setDraft((old) => { const type = analysis.type || old.type; return { ...old, name: analysis.name || old.name, category: analysis.category || old.category, type, unit: analysis.unit || old.unit, expiryDate: type === "DURABLE" ? "" : analysis.suggestedExpiryDate || old.expiryDate, notes: analysis.suggestedNotes || old.notes, aiSummary: analysis.summary || old.aiSummary, aiStorageAdvice: analysis.storageAdvice || old.aiStorageAdvice, aiUsageAdvice: analysis.usageAdvice || old.aiUsageAdvice, aiReplenishmentAdvice: analysis.replenishmentAdvice || old.aiReplenishmentAdvice }; });
  const runAi = async (action: "identify" | "shelf_life") => { setAiLoading(true); setError(""); try { const result = await analyzeItem({ action, imageUrl: draft.imageUrl || null, hint: draft.name, item: { name: draft.name, category: draft.category, type: draft.type, quantity: draft.quantity, minQuantity: draft.minQuantity, unit: draft.unit, purchaseDate: draft.purchaseDate || null, expiryDate: draft.expiryDate || null, notes: draft.notes || null } }); applyAi(result.analysis); if (action === "shelf_life") setMoreOpen(true); } catch (e) { setError(e instanceof Error ? e.message : "AI 分析失败"); } finally { setAiLoading(false); } };
  const submit = async (event: FormEvent) => { event.preventDefault(); const parsedPrice = draft.price === "" ? null : moneyValue(draft.price); if (draft.price !== "" && (parsedPrice === null || parsedPrice < 0)) { setError("请输入正确的购买单价，例如 19.90"); return; } setSaving(true); setError(""); try { const payload = { ...(draft.type === "DURABLE" ? { ...draft, expiryDate: "" } : draft), price: parsedPrice }; await request(item ? `/api/items/${item.id}` : "/api/items", { method: item ? "PATCH" : "POST", body: JSON.stringify({ ...payload, recordPurchase, purchaseStore }) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setSaving(false); } };
  const dailyCostPreview = dailyUsageCost({ type: draft.type, price: draft.price === "" ? null : moneyValue(draft.price), purchaseDate: draft.purchaseDate || null });
  const addLocation = (location: Location) => { setAvailableLocations((current) => [...current, location]); set("locationId", location.id); setQuickLocationOpen(false); };
  return <><Modal title={item ? "编辑物品" : "录入新物品"} subtitle={item?.itemCode || "只填名称和数量也可以，其他信息稍后补充"} onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <div className="flex gap-3">{draft.imageUrl ? <button type="button" onClick={() => setImagePreviewOpen(true)} className="group relative grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-cover bg-center transition hover:brightness-90 focus-visible:outline-offset-2" style={{ backgroundImage: `url(${draft.imageUrl})`, borderColor: "var(--primary)" }} aria-label="放大查看物品图片" title="点击放大查看"><span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-[10px] font-bold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">放大</span></button> : <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-dashed" style={{ borderColor: "var(--border)", background: "var(--surface-soft)" }}>{uploading ? <Sparkles className="animate-pulse" size={22} /> : <ImagePlus className="muted" size={24} />}</div>}<div className="min-w-0 flex-1"><label className="mb-1.5 block text-xs font-bold muted">物品名称 *</label><input autoFocus required className="input" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="拍照让 AI 识别，或直接输入名称" /><div className="mt-2 flex gap-2"><button type="button" disabled={aiLoading || (!draft.name && !draft.imageUrl)} onClick={() => runAi("identify")} className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-40"><Sparkles size={14} />{aiLoading ? "分析中…" : "AI 补全"}</button>{draft.type === "CONSUMABLE" && <button type="button" disabled={aiLoading || (!draft.name && !draft.imageUrl)} onClick={() => runAi("shelf_life")} className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-40"><Bot size={14} />分析保质期</button>}</div></div></div>
    <div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><div className="mb-2 flex items-center gap-1 border-b" style={{ borderColor: "var(--border)" }}><button type="button" onClick={() => setImageMode("upload")} className="flex items-center gap-1.5 border-b-2 px-2 py-1.5 text-xs font-bold transition" style={{ borderColor: imageMode === "upload" ? "var(--primary)" : "transparent", color: imageMode === "upload" ? "var(--primary)" : "var(--muted)" }}><Upload size={14} />上传</button><button type="button" onClick={() => setImageMode("link")} className="flex items-center gap-1.5 border-b-2 px-2 py-1.5 text-xs font-bold transition" style={{ borderColor: imageMode === "link" ? "var(--primary)" : "transparent", color: imageMode === "link" ? "var(--primary)" : "var(--muted)" }}><Link2 size={14} />链接</button>{draft.imageUrl && <button type="button" onClick={() => { set("imageUrl", ""); setImageUrlDraft(""); }} className="ml-auto text-xs font-bold text-red-500">移除图片</button>}</div>{imageMode === "upload" ? <label className="flex cursor-pointer items-center gap-2 py-1 text-sm font-bold"><ImagePlus size={16} style={{ color: "var(--primary)" }} />{uploading ? "正在压缩并上传…" : "选择图片上传"}<span className="ml-auto text-xs font-normal muted">最大 5MB</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={uploading} onChange={(e) => uploadImage(e.target.files?.[0])} /></label> : <div className="flex gap-2"><input className="input min-w-0 flex-1" value={imageUrlDraft} onChange={(event) => setImageUrlDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyImageUrl(); } }} onPaste={(event) => setImageUrlDraft(event.clipboardData.getData("text"))} placeholder="粘贴图片地址，例如 https://…" /><button type="button" onClick={applyImageUrl} className="btn-primary shrink-0 px-3 text-xs">应用</button></div>}<p className="mb-0 mt-2 text-[11px] muted">像 Notion 一样，可上传图片或直接粘贴网络图片地址。</p></div>
    <div className="grid grid-cols-2 gap-3"><label className="cursor-pointer rounded-2xl border px-3 py-2.5 transition" style={draft.type === "DURABLE" ? { borderColor: "var(--primary)", background: "var(--primary-soft)" } : { borderColor: "var(--border)" }}><input type="radio" className="hidden" checked={draft.type === "DURABLE"} onChange={() => setDraft((old) => ({ ...old, type: "DURABLE", expiryDate: "" }))} /><div className="text-sm font-bold">📦 耐用品</div></label><label className="cursor-pointer rounded-2xl border px-3 py-2.5 transition" style={draft.type === "CONSUMABLE" ? { borderColor: "var(--primary)", background: "var(--primary-soft)" } : { borderColor: "var(--border)" }}><input type="radio" className="hidden" checked={draft.type === "CONSUMABLE"} onChange={() => set("type", "CONSUMABLE")} /><div className="text-sm font-bold">🧴 消耗品</div></label></div>
    {duplicates.length > 0 && <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: "var(--warning-soft, #fff4dc)", color: "#8a571c" }}><CircleAlert size={15} className="shrink-0" /><span className="min-w-0 flex-1 truncate">已有同名物品：{duplicates.slice(0, 2).map((entry) => entry.location?.name || "未设置位置").join("、")}；仍可继续新增。</span></div>}
    <div className="grid grid-cols-2 gap-3"><Field label="分类"><select className="input" value={draft.category} onChange={(e) => set("category", e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select></Field><div><div className="mb-1.5 flex items-center justify-between"><span className="text-xs font-bold muted">存放位置</span><button type="button" onClick={() => setQuickLocationOpen(true)} className="flex items-center gap-1 text-[11px] font-bold" style={{ color: "var(--primary)" }}><Plus size={13} />新建</button></div><select className="input" value={draft.locationId} onChange={(e) => set("locationId", e.target.value)}><option value="">未设置</option>{availableLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>{suggestedLocation && <button type="button" onClick={() => set("locationId", suggestedLocation.id)} className="mt-1.5 flex max-w-full items-center gap-1 text-[11px] font-bold" style={{ color: "var(--primary)" }}><MapPin size={12} /><span className="truncate">建议放在 {suggestedLocation.name}</span></button>}</div></div>
    <div className="grid grid-cols-2 gap-3"><Field label="数量"><input required type="number" min="0" step={isCountUnit(draft.unit) ? "1" : "0.1"} className="input" value={draft.quantity} onChange={(e) => set("quantity", normalizeItemQuantity(Number(e.target.value), draft.unit))} /></Field><Field label="单位"><select className="input" value={draft.unit} onChange={(e) => setDraft((current) => ({ ...current, unit: e.target.value, quantity: normalizeItemQuantity(current.quantity, e.target.value) }))}>{units.map((u) => <option key={u}>{u}</option>)}</select></Field></div>
    {isLiquidConsumable(draft) && <p className="-mt-2 text-xs muted">按整瓶记录库存；日常用量请通过下方“剩余量”调整。</p>}
    {draft.type === "CONSUMABLE" && <div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><div className="mb-2 flex items-center justify-between text-xs"><span className="font-bold">剩余量</span><span className="font-black" style={{ color: draft.remainingPercent <= 20 ? "var(--danger)" : "var(--primary)" }}>{draft.remainingPercent}%</span></div><input aria-label="剩余量" type="range" min="0" max="100" step="5" className="w-full accent-[var(--primary)]" value={draft.remainingPercent} onChange={(e) => set("remainingPercent", Number(e.target.value))} /></div>}
    <button type="button" onClick={() => setMoreOpen(!moreOpen)} className="flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-sm font-bold" style={{ background: "var(--surface-soft)" }}><span>更多信息 <span className="ml-1 text-xs font-normal muted">价格、日期、提醒、备注</span></span><ChevronDown size={17} className={`transition ${moreOpen ? "rotate-180" : ""}`} /></button>
    {moreOpen && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-3 overflow-hidden"><div className={`grid gap-3 ${draft.type === "CONSUMABLE" ? "grid-cols-2" : "grid-cols-1"}`}><Field label="购买单价"><input type="text" inputMode="decimal" autoComplete="off" className="input" value={draft.price} onChange={(event) => { const next = event.target.value; if (isMoneyInput(next)) set("price", next); }} onBlur={() => { const amount = moneyValue(draft.price); if (amount !== null) set("price", amount.toFixed(2)); }} placeholder="¥ 0.00" aria-describedby="price-hint" /></Field>{draft.type === "CONSUMABLE" && <Field label="低库存阈值"><input type="number" min="0" step="0.1" className="input" value={draft.minQuantity} onChange={(e) => set("minQuantity", Number(e.target.value))} /></Field>}</div><p id="price-hint" className="-mt-1 text-[11px] muted">支持键盘输入小数，例如 19.90</p>{dailyCostPreview && <div className="flex items-center justify-between rounded-2xl p-3 text-sm" style={{ background: "var(--primary-soft)" }}><span className="font-bold">当前日均成本</span><span><b>¥{dailyCostPreview.cost.toFixed(dailyCostPreview.cost >= 10 ? 0 : 2)}</b><span className="ml-1 text-xs muted">/ 天 · 已使用 {dailyCostPreview.days} 天</span></span></div>}{draft.price && <div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><button type="button" onClick={() => setRecordPurchase(!recordPurchase)} className="flex w-full items-center justify-between text-sm"><span>记入本月消费记录</span><span className="font-bold" style={{ color: recordPurchase ? "var(--success)" : "var(--muted)" }}>{recordPurchase ? "是" : "否"}</span></button>{recordPurchase && <input className="input mt-3" value={purchaseStore} onChange={(e) => setPurchaseStore(e.target.value)} placeholder="购买商店（可选）" />}</div>}<div className={`grid gap-3 ${draft.type === "CONSUMABLE" ? "grid-cols-2" : "grid-cols-1"}`}><DateField label="购入日期" value={draft.purchaseDate} onChange={(value) => set("purchaseDate", value)} />{draft.type === "CONSUMABLE" && <DateField label="到期日期" value={draft.expiryDate} onChange={(value) => set("expiryDate", value)} />}</div><Field label="备注"><textarea className="input min-h-20 resize-none" value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="规格、保修、使用提示…" /></Field></motion.div>}
    {error && <p className="m-0 rounded-xl p-2.5 text-sm text-red-500" style={{ background: "#ffe8eb" }}>{error}</p>}<div className="flex gap-3 pt-1"><button type="button" onClick={onClose} className="btn-ghost flex-1">取消</button><button disabled={saving || uploading || aiLoading} className="btn-primary flex-1 disabled:opacity-60">{saving ? "保存中…" : item ? "保存修改" : "快速保存"}</button></div>
  </form></Modal><AnimatePresence>{imagePreviewOpen && draft.imageUrl && <motion.div className="fixed inset-0 z-[70] grid place-items-center bg-black/75 p-5 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && setImagePreviewOpen(false)}><motion.div className="relative max-h-full max-w-full" initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .96 }}><img src={draft.imageUrl} alt={draft.name || "物品图片"} className="max-h-[82dvh] max-w-[92vw] rounded-2xl object-contain shadow-2xl" /><button type="button" onClick={() => setImagePreviewOpen(false)} className="absolute -right-3 -top-3 grid size-9 place-items-center rounded-full bg-white text-black shadow-lg" aria-label="关闭图片预览"><X size={18} /></button></motion.div></motion.div>}</AnimatePresence><AnimatePresence>{quickLocationOpen && <QuickLocationDialog onClose={() => setQuickLocationOpen(false)} onCreated={addLocation} />}</AnimatePresence></>;
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const shortcuts = [
    { label: "今天", icon: CalendarDays, days: 0 },
    { label: "昨天", icon: RotateCcw, days: -1 },
    { label: "上周", icon: History, days: -7 },
  ];
  return <Field label={label}><div className="flex items-center gap-1.5"><input type="date" className="input min-w-0 flex-1" value={value} onChange={(event) => onChange(event.target.value)} />{shortcuts.map(({ label: shortcutLabel, icon: Icon, days }) => <button key={shortcutLabel} type="button" onClick={() => onChange(dateInputValue(days))} className="btn-ghost grid size-9 shrink-0 place-items-center p-0" aria-label={`设为${shortcutLabel}`} title={shortcutLabel}><Icon size={16} strokeWidth={2.2} /></button>)}</div></Field>;
}

function QuickLocationDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (location: Location) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { onCreated(await request<Location>("/api/locations", { method: "POST", body: JSON.stringify({ name, color: "#7c3aed", icon: "Package" }) })); } catch (reason) { setError(reason instanceof Error ? reason.message : "创建位置失败"); } finally { setSaving(false); } };
  return <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><motion.form aria-modal="true" role="dialog" aria-labelledby="quick-location-title" onSubmit={submit} initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .98 }} className="w-full max-w-sm rounded-3xl p-5 shadow-2xl" style={{ background: "var(--surface-solid)" }}><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><MapPin size={19} /></div><div className="min-w-0 flex-1"><h3 id="quick-location-title" className="m-0 text-base font-black">新建存放位置</h3><p className="mb-0 mt-1 text-xs leading-5 muted">创建后会自动选中，可继续录入物品。</p></div><button type="button" onClick={onClose} className="btn-ghost grid size-8 place-items-center p-0" aria-label="关闭新建位置"><X size={16} /></button></div><Field label="位置名称"><input autoFocus required maxLength={30} className="input mt-4" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：阳台收纳柜" /></Field>{error && <p className="m-0 mt-3 rounded-xl p-2.5 text-sm text-red-500" style={{ background: "#ffe8eb" }}>{error}</p>}<div className="mt-5 flex gap-3"><button type="button" onClick={onClose} className="btn-ghost flex-1">取消</button><button disabled={saving} className="btn-primary flex-1 disabled:opacity-60">{saving ? "创建中…" : "创建并选中"}</button></div></motion.form></motion.div>;
}

function ShoppingModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) { const [name, setName] = useState(""); const [quantity, setQuantity] = useState(1); const [unit, setUnit] = useState("件"); const submit = async (e: FormEvent) => { e.preventDefault(); await request("/api/shopping", { method: "POST", body: JSON.stringify({ name, quantity, unit, priority: 1, source: "manual" }) }); onSaved(); }; return <Modal title="添加采购项" subtitle="想到什么就记下来，买齐后打勾。" onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label="需要采购什么？"><input autoFocus required className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：厨房纸" /></Field><div className="grid grid-cols-2 gap-3"><Field label="数量"><input type="number" min="0.1" step="0.1" className="input" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></Field><Field label="单位"><select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>{units.map((u) => <option key={u}>{u}</option>)}</select></Field></div><div className="flex gap-3 pt-2"><button type="button" onClick={onClose} className="btn-ghost flex-1">取消</button><button className="btn-primary flex-1">加入清单</button></div></form></Modal>; }

function LocationModal({ location, onClose, onSaved }: { location: Location | null; onClose: () => void; onSaved: () => void }) { const [name, setName] = useState(location?.name || ""); const [color, setColor] = useState(location?.color || "#7c3aed"); const [error, setError] = useState(""); const submit = async (e: FormEvent) => { e.preventDefault(); setError(""); try { await request(location ? `/api/locations/${location.id}` : "/api/locations", { method: location ? "PATCH" : "POST", body: JSON.stringify({ name, color, icon: location?.icon || "Package" }) }); onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); } }; return <Modal title={location ? "编辑家庭空间" : "添加家庭空间"} subtitle="房间、柜子或任何方便查找的位置。" onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label="空间名称"><input autoFocus required className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：主卧衣柜" /></Field><Field label="标记颜色"><div className="flex items-center gap-3"><input type="color" className="h-11 w-16 cursor-pointer rounded-xl border-0 bg-transparent" value={color} onChange={(e) => setColor(e.target.value)} /><span className="text-sm muted">用于快速区分空间</span></div></Field>{error && <p className="m-0 rounded-xl p-2.5 text-sm text-red-500" style={{ background: "#ffe8eb" }}>{error}</p>}<div className="flex gap-3 pt-2"><button type="button" onClick={onClose} className="btn-ghost flex-1">取消</button><button className="btn-primary flex-1">{location ? "保存修改" : "创建空间"}</button></div></form></Modal>; }

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) { return <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 backdrop-blur-sm sm:items-center sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}><motion.div initial={{ y: 35, opacity: 0, scale: .98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 25, opacity: 0 }} transition={{ type: "spring", damping: 28, stiffness: 340 }} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] p-5 shadow-2xl sm:rounded-[28px] sm:p-6" style={{ background: "var(--surface-solid)" }}><div className="mb-6 flex items-start gap-3"><div className="flex-1"><h2 className="m-0 text-xl font-black">{title}</h2><p className="mb-0 mt-1 text-xs muted">{subtitle}</p></div><button type="button" onClick={onClose} className="btn-ghost grid size-9 place-items-center p-0 sm:hidden" aria-label={`关闭${title}`}><X size={17} /></button></div>{children}</motion.div></motion.div>; }

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold muted">{label}</span>{children}</label>; }
function SectionHead({ title, action, onClick }: { title: string; action: string; onClick: () => void }) { return <div className="flex items-center justify-between"><h2 className="m-0 text-base font-black sm:text-lg">{title}</h2><button onClick={onClick} className="flex items-center gap-1 text-xs font-bold" style={{ color: "var(--primary)" }}>{action}<ChevronRight size={14} /></button></div>; }
function EmptyState({ icon: Icon, title, text }: { icon: typeof Boxes; title: string; text: string }) { return <div className="col-span-full grid place-items-center py-10 text-center"><div className="mb-3 grid size-12 place-items-center rounded-2xl" style={{ background: "var(--surface-soft)", color: "var(--muted)" }}><Icon size={21} /></div><b className="text-sm">{title}</b><p className="mb-0 mt-1 text-xs muted">{text}</p></div>; }
function LoadingView() { return <div><div className="skeleton mb-3 h-9 w-64 rounded-xl" /><div className="skeleton mb-7 h-4 w-80 max-w-full rounded-lg" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1,2,3,4].map((i) => <div key={i} className="skeleton h-36 rounded-3xl" />)}</div><div className="mt-5 grid gap-4 md:grid-cols-2">{[1,2].map((i) => <div key={i} className="skeleton h-72 rounded-3xl" />)}</div></div>; }
