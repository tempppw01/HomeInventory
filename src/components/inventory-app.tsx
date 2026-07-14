"use client";

import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import {
  AlertTriangle, Archive, Bath, Bell, Bot, Boxes, Check, CheckSquare, ChevronDown, ChevronRight, CircleAlert, Cloud, CookingPot,
  Grid2X2, ImagePlus, Info, LayoutDashboard, MapPin, Minus, Monitor, Moon,
  Package, Plus, Printer, QrCode, Search, Settings, ShoppingBasket, Sofa, Sparkles,
  Snowflake, Sun, Thermometer, Trash2, WalletCards, Warehouse, X, Zap,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardData, FridgeSummary, Item, ItemType, Location, ShoppingItem } from "@/types";
import { AiSettings } from "@/components/ai-settings";
import { AiAssistantModal, analyzeItem, type AiAnalysis } from "@/components/ai-assistant-modal";
import { PrintStudio } from "@/components/print-studio";
import { dailyUsageCost, isLiquidConsumable } from "@/lib/item-metrics";
import { APP_VERSION } from "@/lib/version";

type View = "dashboard" | "items" | "shopping" | "locations" | "settings" | "about";
type ThemeMode = "light" | "dark" | "system";
type ItemDraft = {
  name: string; category: string; type: ItemType; quantity: number; minQuantity: number; remainingPercent: number;
  unit: string; price: string; purchaseDate: string; expiryDate: string; locationId: string; notes: string; imageUrl: string;
};

const emptyDraft: ItemDraft = {
  name: "", category: "日用", type: "DURABLE", quantity: 1, minQuantity: 0, remainingPercent: 100,
  unit: "件", price: "", purchaseDate: "", expiryDate: "", locationId: "", notes: "", imageUrl: "",
};

const navItems = [
  { id: "dashboard" as View, label: "概览", icon: LayoutDashboard },
  { id: "items" as View, label: "物品", icon: Boxes },
  { id: "shopping" as View, label: "采购", icon: ShoppingBasket },
  { id: "locations" as View, label: "空间", icon: MapPin },
];
const mobileNavItems = [...navItems, { id: "settings" as View, label: "设置", icon: Settings }];

const iconMap = { Package, CookingPot, Sofa, Bath, Warehouse };
const categories = ["日用", "食品", "饮品", "清洁", "家电", "数码", "衣物", "医药", "户外", "其他"];
const units = ["件", "个", "盒", "瓶", "袋", "卷", "包", "台", "kg", "L", "ml"];
const welcomeStorageKey = "home-inventory-welcome-seen";
const legacyWelcomeStorageKeys = ["home-inventory-welcome-0.0.1"];
const appStartedAt = Date.now();

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
  const [modal, setModal] = useState<"item" | "shopping" | "location" | "notifications" | "fridge" | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [qrItem, setQrItem] = useState<Item | null>(null);
  const [printItems, setPrintItems] = useState<Item[] | null>(null);
  const [aiItem, setAiItem] = useState<Item | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [showWelcome, setShowWelcome] = useState(false);

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

  const filteredItems = useMemo(() => {
    const term = search.toLowerCase().trim();
    return (data?.items ?? []).filter((item) =>
      (typeFilter === "ALL" || item.type === typeFilter) &&
      (!term || [item.name, item.itemCode, item.category, item.location?.name].some((value) => value?.toLowerCase().includes(term))),
    );
  }, [data, search, typeFilter]);

  const lowStock = (data?.items ?? []).filter((item) => item.type === "CONSUMABLE" && ((item.minQuantity > 0 && item.quantity <= item.minQuantity) || (isLiquidConsumable(item) && item.remainingPercent <= 20)));
  const pendingShopping = (data?.shopping ?? []).filter((item) => item.status === "PENDING");
  const expiring = (data?.items ?? []).filter((item) => item.type === "CONSUMABLE" && item.expiryDate && new Date(item.expiryDate).getTime() - appStartedAt < 14 * 86400000 && new Date(item.expiryDate).getTime() > appStartedAt);
  const expired = (data?.items ?? []).filter((item) => item.type === "CONSUMABLE" && item.expiryDate && new Date(item.expiryDate).getTime() <= appStartedAt);
  const totalValue = (data?.items ?? []).reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0);

  const openEdit = (item: Item) => { setEditing(item); setModal("item"); };
  const closeModal = () => { setModal(null); setEditing(null); };

  const consume = async (item: Item) => {
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
    if (!confirm(`确定删除“${item.name}”吗？`)) return;
    await request(`/api/items/${item.id}`, { method: "DELETE" }); setToast("物品已删除"); await refresh();
  };

  const toggleShopping = async (item: ShoppingItem) => {
    await request(`/api/shopping/${item.id}`, { method: "PATCH", body: JSON.stringify({ status: item.status === "PENDING" ? "PURCHASED" : "PENDING" }) });
    await refresh();
  };

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="desktop-only sticky top-0 h-screen border-r px-4 py-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <Brand />
        <nav className="mt-9 space-y-1.5">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setView(id)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition"
              style={view === id ? { background: "var(--primary-soft)", color: "var(--primary)" } : { color: "var(--muted)" }}>
              <Icon size={19} strokeWidth={2.2} /> {label}
              {id === "shopping" && pendingShopping.length > 0 && <span className="ml-auto rounded-full px-2 py-0.5 text-xs text-white" style={{ background: "var(--danger)" }}>{pendingShopping.length}</span>}
            </button>
          ))}
        </nav>
        <div className="absolute bottom-5 left-4 right-4">
          <button onClick={() => setView("settings")} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold muted hover:bg-[var(--surface-soft)]">
            <Settings size={19} /> 设置
          </button>
          <button onClick={() => setView("about")} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold muted hover:bg-[var(--surface-soft)]"><Info size={19} />关于 <span className="ml-auto text-[10px]">v{APP_VERSION}</span></button>
          <div className="mt-3 rounded-2xl p-3" style={{ background: "linear-gradient(135deg, var(--primary-soft), var(--surface-soft))" }}>
            <div className="flex items-center gap-2 text-sm font-bold"><Sparkles size={16} style={{ color: "var(--primary)" }} /> 今日小结</div>
            <p className="mb-0 mt-2 text-xs leading-5 muted">{lowStock.length ? `${lowStock.length} 件消耗品需要补充` : "库存充足，家里井井有条"}</p>
          </div>
        </div>
      </aside>

      <main className="min-w-0 px-4 pb-8 pt-4 sm:px-6 md:px-8 md:py-7 xl:px-12">
        <header className="mb-7 flex items-center gap-3">
          <div className="mobile-only"><Brand compact /></div>
          <div className="desktop-only max-w-md flex-1">
            <SearchBox items={data?.items ?? []} value={search} onChange={setSearch} onSelect={(item) => { setSearch(item.name); setView("items"); }} onFocus={() => setView("items")} placeholder="搜索名称、编号、分类或位置…" />
          </div>
          <button onClick={cycleTheme} className="btn-ghost ml-auto grid size-11 place-items-center p-0" aria-label={`当前主题：${theme === "system" ? "跟随系统" : theme === "light" ? "浅色" : "深色"}`} title="切换主题">{theme === "system" ? <Monitor size={19} /> : theme === "light" ? <Moon size={19} /> : <Sun size={19} />}</button>
          <button onClick={() => setModal("notifications")} className="btn-ghost relative grid size-11 place-items-center p-0" aria-label="查看提醒"><Bell size={19} />{(lowStock.length + expiring.length + expired.length + (data?.fridge.status === "TOO_WARM" || data?.fridge.status === "TOO_COLD" ? 1 : 0)) > 0 && <span className="absolute right-2 top-2 size-2 rounded-full" style={{ background: "var(--danger)" }} />}</button>
          <button onClick={() => setModal("item")} className="btn-primary flex items-center gap-2 whitespace-nowrap"><Plus size={19} /><span className="desktop-only">录入物品</span></button>
        </header>

        <AnimatePresence mode="wait">
          <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .22 }}>
            {loading ? <LoadingView /> : view === "dashboard" ? (
              <DashboardView data={data!} lowStock={lowStock} expiring={expiring} expired={expired} pending={pendingShopping} totalValue={totalValue} onNavigate={setView} onEdit={openEdit} onConsume={consume} onQr={setQrItem} onAi={setAiItem} onFridge={() => setModal("fridge")} onAlerts={() => setModal("notifications")} />
            ) : view === "items" ? (
              <ItemsView allItems={data!.items} items={filteredItems} search={search} setSearch={setSearch} filter={typeFilter} setFilter={setTypeFilter} onEdit={openEdit} onConsume={consume} onRemainingChange={updateRemaining} onDelete={removeItem} onQr={setQrItem} onAi={setAiItem} onPrint={setPrintItems} />
            ) : view === "shopping" ? (
              <ShoppingView items={data!.shopping} onToggle={toggleShopping} onAdd={() => setModal("shopping")} onDelete={async (id) => { await request(`/api/shopping/${id}`, { method: "DELETE" }); await refresh(); }} />
            ) : view === "locations" ? (
              <LocationsView locations={data!.locations} items={data!.items} onAdd={() => setModal("location")} onOpen={(name) => { setSearch(name); setView("items"); }} />
            ) : view === "settings" ? <SettingsView theme={theme} onTheme={setThemeMode} onToast={setToast} onAbout={() => setView("about")} /> : <AboutView onWelcome={() => setShowWelcome(true)} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="mobile-only fixed bottom-0 left-0 right-0 z-30 grid grid-cols-5 border-t px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        {mobileNavItems.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setView(id)} className="relative flex flex-col items-center gap-1 py-1 text-[11px] font-semibold" style={{ color: view === id ? "var(--primary)" : "var(--muted)" }}><Icon size={20} /><span>{label}</span>{id === "shopping" && pendingShopping.length > 0 && <span className="absolute right-[26%] top-0 size-2 rounded-full" style={{ background: "var(--danger)" }} />}</button>)}
      </nav>

      <AnimatePresence>
        {modal === "item" && <ItemModal locations={data?.locations ?? []} item={editing} onClose={closeModal} onSaved={async () => { closeModal(); setToast(editing ? "物品已更新" : "物品已录入"); await refresh(); }} />}
        {modal === "shopping" && <ShoppingModal onClose={closeModal} onSaved={async () => { closeModal(); setToast("已加入采购清单"); await refresh(); }} />}
        {modal === "location" && <LocationModal onClose={closeModal} onSaved={async () => { closeModal(); setToast("新空间已创建"); await refresh(); }} />}
        {modal === "notifications" && <NotificationsModal lowStock={lowStock} expiring={expiring} expired={expired} fridge={data?.fridge} onClose={closeModal} onOpenItem={(item) => { closeModal(); openEdit(item); }} onShopping={() => { closeModal(); setView("shopping"); }} onFridge={() => setModal("fridge")} />}
        {modal === "fridge" && data?.fridge && <FridgeModal fridge={data.fridge} onClose={closeModal} onSaved={async () => { closeModal(); setToast("冰箱温度已记录"); await refresh(); }} />}
        {qrItem && <QrModal item={qrItem} onClose={() => setQrItem(null)} onPrint={() => { setQrItem(null); setPrintItems([qrItem]); }} />}
        {aiItem && <AiAssistantModal item={aiItem} onClose={() => setAiItem(null)} onApplied={async (message) => { setToast(message); await refresh(); }} />}
      </AnimatePresence>
      {printItems && <PrintStudio items={printItems} onClose={() => setPrintItems(null)} />}
      {showWelcome && <WelcomeModal hasDemoData={data?.items.some((item) => item.itemCode?.startsWith("INV-DEMO-")) ?? false} onClose={() => { localStorage.setItem(welcomeStorageKey, "seen"); setShowWelcome(false); }} />}
      <AnimatePresence>{toast && <motion.div initial={{ opacity: 0, y: 20, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 12, x: "-50%" }} className="fixed bottom-24 left-1/2 z-[70] rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-2xl md:bottom-8" style={{ background: "#24242d" }}>{toast}</motion.div>}</AnimatePresence>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-2.5"><div className="grid size-10 place-items-center rounded-2xl text-white shadow-lg" style={{ background: "linear-gradient(145deg, var(--primary), #a177ff)" }}><Archive size={21} /></div>{!compact && <div><div className="flex items-center gap-2 text-lg font-black tracking-tight">归物 <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>v{APP_VERSION}</span></div><div className="text-[10px] font-semibold tracking-[.18em] muted">HOME INVENTORY</div></div>}</div>;
}

function PageTitle({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="mb-6 flex items-end justify-between gap-4"><div><h1 className="m-0 text-2xl font-black tracking-tight sm:text-3xl">{title}</h1><p className="mb-0 mt-2 text-sm muted">{text}</p></div>{action}</div>;
}

function DashboardView({ data, lowStock, expiring, expired, pending, totalValue, onNavigate, onEdit, onConsume, onQr, onAi, onFridge, onAlerts }: { data: DashboardData; lowStock: Item[]; expiring: Item[]; expired: Item[]; pending: ShoppingItem[]; totalValue: number; onNavigate: (v: View) => void; onEdit: (i: Item) => void; onConsume: (i: Item) => void; onQr: (i: Item) => void; onAi: (i: Item) => void; onFridge: () => void; onAlerts: () => void }) {
  const stats = [
    { label: "全部物品", value: data.items.length, suffix: "件", icon: Boxes, color: "#6d4aff", bg: "#eeeaff" },
    { label: "低库存", value: lowStock.length, suffix: "项", icon: CircleAlert, color: "#e37d25", bg: "#fff1df" },
    { label: "待采购", value: pending.length, suffix: "项", icon: ShoppingBasket, color: "#eb5b66", bg: "#ffe8eb" },
    { label: "估算价值", value: totalValue >= 10000 ? `${(totalValue / 10000).toFixed(1)}万` : `¥${Math.round(totalValue)}`, suffix: "", icon: Zap, color: "#15966a", bg: "#e0f7ef" },
  ];
  return <>
    <PageTitle title="晚上好，家里一切有序" text={`今天有 ${lowStock.length + expiring.length + expired.length} 条库存与保质期事项值得留意。`} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {stats.map(({ label, value, suffix, icon: Icon, color, bg }, index) => <motion.div key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .06 }} className="surface rounded-3xl p-4 sm:p-5"><div className="mb-4 grid size-10 place-items-center rounded-2xl" style={{ color, background: bg }}><Icon size={20} /></div><div className="flex items-end gap-1"><b className="text-2xl font-black sm:text-3xl">{value}</b><span className="mb-1 text-xs muted">{suffix}</span></div><div className="mt-1 text-xs font-semibold muted">{label}</div></motion.div>)}
    </div>

    {(lowStock.length > 0 || expiring.length > 0 || expired.length > 0 || data.fridge.status === "TOO_WARM" || data.fridge.status === "TOO_COLD") && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="my-5 flex items-center gap-3 rounded-3xl p-4 text-sm" style={{ background: "linear-gradient(100deg, #fff1df, #ffe8e8)", color: "#7d491f" }}><div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/70"><CircleAlert size={20} /></div><div className="min-w-0 flex-1"><b>{expired.length > 0 ? `${expired.length} 件物品已经过期` : "需要你的关注"}</b><div className="mt-0.5 truncate text-xs opacity-80">{lowStock.length} 件库存不足 · {expiring.length} 件即将到期{data.fridge.status === "TOO_WARM" ? " · 冰箱温度偏高" : data.fridge.status === "TOO_COLD" ? " · 冰箱温度偏低" : ""}</div></div><button onClick={onAlerts} className="flex items-center gap-1 font-bold">查看提醒 <ChevronRight size={16} /></button></motion.div>}

    <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,.7fr)]">
      <section className="surface min-w-0 rounded-3xl p-4 sm:p-5"><SectionHead title="最近更新" action="查看全部" onClick={() => onNavigate("items")} /><div className="mt-4 grid gap-3 sm:grid-cols-2">{data.items.slice(0, 6).map((item) => <ItemCard key={item.id} item={item} onEdit={() => onEdit(item)} onConsume={() => onConsume(item)} onQr={() => onQr(item)} onAi={() => onAi(item)} compact />)}{data.items.length === 0 && <EmptyState icon={Boxes} title="还没有物品" text="点击右上角，录入家里的第一件物品" />}</div></section>
      <div className="space-y-5"><HomeInsights data={data} onFridge={onFridge} /><section className="surface rounded-3xl p-4 sm:p-5"><SectionHead title="采购清单" action="全部" onClick={() => onNavigate("shopping")} /><div className="mt-4 space-y-2">{pending.slice(0, 4).map((item) => <div key={item.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><span className="size-2 rounded-full" style={{ background: item.priority === 2 ? "var(--danger)" : "var(--warning)" }} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{item.name}</div><div className="mt-0.5 text-xs muted">{item.quantity} {item.unit} · {item.category || "未分类"}</div></div></div>)}{pending.length === 0 && <EmptyState icon={Check} title="清单已完成" text="暂时没有需要采购的物品" />}</div></section></div>
    </div>
  </>;
}

function HomeInsights({ data, onFridge }: { data: DashboardData; onFridge: () => void }) {
  const fridgeText = data.fridge.status === "TOO_WARM" ? "温度偏高，检查门封与档位" : data.fridge.status === "TOO_COLD" ? "温度偏低，避免食材冻伤" : data.fridge.status === "NORMAL" ? "温度处于安全范围" : data.fridge.status === "DISABLED" ? "异常提醒已关闭" : "尚未记录温度";
  const fridgeNormal = data.fridge.status === "NORMAL";
  const fridgeWarning = data.fridge.status === "TOO_WARM" || data.fridge.status === "TOO_COLD";
  return <section className="surface rounded-3xl p-4 sm:p-5"><h2 className="m-0 text-base font-black">家庭状态</h2><button onClick={onFridge} className="mt-4 flex w-full items-center gap-3 rounded-2xl p-3 text-left" style={{ background: "var(--surface-soft)" }}><div className="grid size-10 place-items-center rounded-2xl" style={{ background: fridgeNormal ? "#e0f7ef" : fridgeWarning ? "#fff1df" : "var(--primary-soft)", color: fridgeNormal ? "var(--success)" : fridgeWarning ? "var(--warning)" : "var(--primary)" }}><Thermometer size={19} /></div><div className="min-w-0 flex-1"><div className="text-sm font-bold">冰箱 {data.fridge.latest ? `${data.fridge.latest.temperature}℃` : "待记录"}</div><div className="mt-0.5 truncate text-[11px] muted">{fridgeText}</div></div><ChevronRight size={15} className="muted" /></button><div className="mt-3 grid grid-cols-2 gap-3"><div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><div className="flex items-center gap-1.5 text-[11px] font-bold muted"><WalletCards size={13} />本月消费</div><div className="mt-2 text-lg font-black">¥{data.finance.currentMonthTotal.toFixed(0)}</div></div><div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><div className="text-[11px] font-bold muted">近 6 月均值</div><div className="mt-2 text-lg font-black">¥{data.finance.averageMonthly.toFixed(0)}</div></div></div>{data.finance.recent[0] && <div className="mt-3 truncate text-[11px] muted">最近：{data.finance.recent[0].itemName} ¥{data.finance.recent[0].totalPrice.toFixed(2)}</div>}</section>;
}

function ItemsView({ allItems, items, search, setSearch, filter, setFilter, onEdit, onConsume, onRemainingChange, onDelete, onQr, onAi, onPrint }: { allItems: Item[]; items: Item[]; search: string; setSearch: (s: string) => void; filter: "ALL" | ItemType; setFilter: (f: "ALL" | ItemType) => void; onEdit: (i: Item) => void; onConsume: (i: Item) => void; onRemainingChange: (item: Item, remainingPercent: number) => void; onDelete: (i: Item) => void; onQr: (i: Item) => void; onAi: (i: Item) => void; onPrint: (items: Item[]) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedItems = allItems.filter((item) => selected.has(item.id));
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selectVisible = () => setSelected(new Set(items.map((item) => item.id)));
  return <><PageTitle title="我的物品" text="随时知道家里有什么、放在哪里。" />
    <div className="mb-5 flex flex-col gap-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="flex-1 md:hidden"><SearchBox items={allItems} value={search} onChange={setSearch} onSelect={(item) => setSearch(item.name)} placeholder="搜索名称或物品编号…" /></div><div className="flex gap-2 overflow-x-auto">{([ ["ALL", "全部"], ["DURABLE", "耐用品"], ["CONSUMABLE", "消耗品"] ] as const).map(([id, label]) => <button key={id} onClick={() => setFilter(id)} className="whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition" style={filter === id ? { background: "var(--primary)", color: "white" } : { background: "var(--surface-solid)", color: "var(--muted)", border: "1px solid var(--border)" }}>{label}</button>)}</div><span className="ml-auto text-sm muted">{items.length} 件</span></div><div className="flex flex-wrap items-center gap-2"><button onClick={selected.size === items.length && items.length > 0 ? () => setSelected(new Set()) : selectVisible} className="btn-ghost flex items-center gap-2 text-xs"><CheckSquare size={15} />{selected.size === items.length && items.length > 0 ? "取消全选" : "选择当前结果"}</button>{selected.size > 0 && <><span className="text-xs font-bold" style={{ color: "var(--primary)" }}>已选 {selected.size} 件</span><button onClick={() => onPrint(selectedItems)} className="btn-primary flex items-center gap-2 px-3 py-2 text-xs"><Printer size={15} />批量打印二维码</button><button onClick={() => setSelected(new Set())} className="btn-ghost px-3 py-2 text-xs">清空</button></>}</div></div>
    {items.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{items.map((item, index) => <motion.div className="h-full" key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .025, .2) }}><ItemCard item={item} selected={selected.has(item.id)} onSelect={() => toggle(item.id)} onEdit={() => onEdit(item)} onConsume={() => onConsume(item)} onRemainingChange={(remainingPercent) => onRemainingChange(item, remainingPercent)} onDelete={() => onDelete(item)} onQr={() => onQr(item)} onAi={() => onAi(item)} /></motion.div>)}</div> : <div className="surface rounded-3xl py-16"><EmptyState icon={Search} title="没有找到物品" text="换个关键词或筛选条件试试" /></div>}
  </>;
}

function ItemCard({ item, onEdit, onConsume, onRemainingChange, onDelete, onQr, onAi, onSelect, selected = false, compact = false }: { item: Item; onEdit: () => void; onConsume: () => void; onRemainingChange?: (remainingPercent: number) => void; onDelete?: () => void; onQr: () => void; onAi: () => void; onSelect?: () => void; selected?: boolean; compact?: boolean }) {
  const low = item.type === "CONSUMABLE" && ((item.minQuantity > 0 && item.quantity <= item.minQuantity) || (isLiquidConsumable(item) && item.remainingPercent <= 20));
  const emoji = ({ 食品: "🍚", 饮品: "🥛", 清洁: "🧴", 家电: "📺", 数码: "💻", 衣物: "👕", 医药: "💊", 户外: "⛺" } as Record<string, string>)[item.category] || "📦";
  const dailyCost = dailyUsageCost(item);
  const showRemaining = !compact && isLiquidConsumable(item) && onRemainingChange;
  return <div onClick={onEdit} className={`group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-3xl border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${compact ? "p-3" : "min-h-40 p-4"}`} style={{ background: "var(--surface-solid)", borderColor: selected ? "var(--primary)" : "var(--border)", boxShadow: selected ? "0 0 0 2px color-mix(in srgb, var(--primary) 18%, transparent)" : undefined }}>
    {onSelect && <button onClick={(event) => { event.stopPropagation(); onSelect(); }} className="absolute left-2 top-2 z-10 grid size-6 place-items-center rounded-lg border text-xs" style={selected ? { background: "var(--primary)", borderColor: "var(--primary)", color: "white" } : { background: "var(--surface-solid)", borderColor: "var(--border)" }} aria-label={selected ? "取消选择" : "选择物品"}>{selected && <Check size={13} />}</button>}
    <div className="flex flex-1 items-start gap-3"><div className={`${compact ? "size-12 text-xl" : "size-14 text-2xl"} grid shrink-0 place-items-center rounded-2xl bg-cover bg-center`} style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : { background: "var(--surface-soft)" }}>{!item.imageUrl && emoji}</div><div className="min-w-0 flex-1"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h3 className="m-0 truncate text-sm font-extrabold sm:text-base">{item.name}</h3><p className="mb-0 mt-1 truncate text-xs muted">{item.location?.name || "未设置位置"} · {item.category}</p><p className="mb-0 mt-1 truncate text-[10px] font-semibold muted">{item.itemCode || item.id}</p></div>{low && <span className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: "#ffe8e8", color: "#d54b57" }}>需补货</span>}</div>{!compact && dailyCost && <div className="mt-3 flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-[11px]" style={{ background: "var(--surface-soft)" }}><span className="font-bold">日均 ¥{dailyCost.cost.toFixed(dailyCost.cost >= 10 ? 0 : 2)}</span><span className="muted">已使用 {dailyCost.days} 天</span></div>}</div>{showRemaining && <RemainingLevel value={item.remainingPercent} onChange={onRemainingChange} />}</div>
    <div className={`mt-auto flex items-center justify-between gap-2 ${compact ? "pt-2" : "pt-4"}`}><div>{!compact && <><span className="text-xl font-black">{item.quantity}</span><span className="ml-1 text-xs muted">{item.unit}</span></>}</div><div className="flex items-center gap-1.5"><button onClick={(event) => { event.stopPropagation(); onAi(); }} className="btn-ghost grid size-8 place-items-center p-0" aria-label="AI 物品助手" title="AI 物品助手"><Bot size={15} /></button><button onClick={(event) => { event.stopPropagation(); onQr(); }} className="btn-ghost grid size-8 place-items-center p-0" aria-label="显示二维码" title="显示二维码"><QrCode size={15} /></button>{!compact && item.type === "CONSUMABLE" && <button onClick={(event) => { event.stopPropagation(); onConsume(); }} className="btn-ghost flex h-8 items-center gap-1 px-2.5 py-0 text-xs"><Minus size={14} /> 用掉</button>}{!compact && onDelete && <button onClick={(event) => { event.stopPropagation(); onDelete(); }} className="btn-ghost hidden size-8 place-items-center p-0 text-red-500 group-hover:grid" aria-label="删除物品"><Trash2 size={14} /></button>}</div></div>
  </div>;
}

function RemainingLevel({ value, onChange }: { value: number; onChange: (remainingPercent: number) => void }) {
  const normalized = Math.min(100, Math.max(0, Math.round(value)));
  const [draftLevel, setDraftLevel] = useState<number | null>(null);
  const level = draftLevel ?? normalized;
  const setNext = (next: number) => { const snapped = Math.min(100, Math.max(0, Math.round(next / 5) * 5)); setDraftLevel(snapped); return snapped; };
  const fromPointer = (event: React.PointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return setNext(((rect.bottom - event.clientY) / rect.height) * 100); };
  const color = level <= 20 ? "var(--danger)" : level <= 45 ? "var(--warning)" : "#65bff2";
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
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]"><section className="surface rounded-3xl p-4 sm:p-6"><div className="mb-4 flex items-center justify-between"><b>待采购</b><span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>{pending.length} 项</span></div><div className="space-y-2">{pending.map((item) => <ShoppingRow key={item.id} item={item} onToggle={() => onToggle(item)} onDelete={() => onDelete(item.id)} />)}{pending.length === 0 && <EmptyState icon={Check} title="全部买齐啦" text="新的低库存物品会自动出现在这里" />}</div></section>
      <aside className="surface rounded-3xl p-4 sm:p-5"><h3 className="m-0 text-base">本次采购概览</h3><div className="my-5 grid grid-cols-2 gap-3"><div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><b className="text-2xl">{pending.length}</b><div className="mt-1 text-xs muted">待采购</div></div><div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><b className="text-2xl">{done.length}</b><div className="mt-1 text-xs muted">已完成</div></div></div>{done.length > 0 && <><div className="mb-2 text-xs font-bold muted">最近完成</div>{done.slice(0, 4).map((item) => <ShoppingRow key={item.id} item={item} onToggle={() => onToggle(item)} onDelete={() => onDelete(item.id)} compact />)}</>}</aside></div>
  </>;
}

function ShoppingRow({ item, onToggle, onDelete, compact = false }: { item: ShoppingItem; onToggle: () => void; onDelete: () => void; compact?: boolean }) {
  const done = item.status === "PURCHASED";
  return <motion.div layout className={`group flex items-center gap-3 rounded-2xl ${compact ? "py-2" : "p-3"}`} style={compact ? {} : { background: "var(--surface-soft)" }}><button onClick={onToggle} className="grid size-6 shrink-0 place-items-center rounded-lg border transition" style={done ? { background: "var(--success)", borderColor: "var(--success)", color: "white" } : { borderColor: "var(--border)", background: "var(--surface-solid)" }}>{done && <Check size={14} />}</button><div className="min-w-0 flex-1"><div className={`truncate text-sm font-bold ${done ? "line-through opacity-50" : ""}`}>{item.name}</div>{!compact && <div className="mt-0.5 text-xs muted">{item.quantity} {item.unit} · {item.source === "low-stock" ? "库存提醒" : item.category || "手动添加"}</div>}</div>{!compact && item.priority === 2 && !done && <span className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: "#ffe8e8", color: "#d54b57" }}>优先</span>}<button onClick={onDelete} className="p-1.5 opacity-0 muted transition group-hover:opacity-100"><X size={15} /></button></motion.div>;
}

function LocationsView({ locations, items, onAdd, onOpen }: { locations: Location[]; items: Item[]; onAdd: () => void; onOpen: (name: string) => void }) {
  return <><PageTitle title="家庭空间" text="按房间和收纳位置快速找到物品。" action={<button onClick={onAdd} className="btn-primary flex items-center gap-2"><Plus size={18} /><span className="desktop-only">添加空间</span></button>} /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{locations.map((location, index) => { const Icon = iconMap[location.icon as keyof typeof iconMap] || Package; const count = items.filter((i) => i.locationId === location.id).length; const consumables = items.filter((i) => i.locationId === location.id && i.type === "CONSUMABLE").length; return <motion.button key={location.id} initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * .05 }} onClick={() => onOpen(location.name)} className="surface group rounded-3xl p-5 text-left transition hover:-translate-y-1 hover:shadow-lg"><div className="mb-6 flex items-start justify-between"><div className="grid size-12 place-items-center rounded-2xl" style={{ color: location.color, background: `color-mix(in srgb, ${location.color} 12%, var(--surface-solid))` }}><Icon size={23} /></div><ChevronRight className="muted transition group-hover:translate-x-1" size={18} /></div><h3 className="m-0 text-lg font-black">{location.name}</h3><p className="mb-0 mt-2 text-sm muted">{count} 件物品 · {consumables} 件消耗品</p></motion.button>; })}<button onClick={onAdd} className="grid min-h-48 place-items-center rounded-3xl border-2 border-dashed p-5 muted transition hover:border-[var(--primary)] hover:text-[var(--primary)]" style={{ borderColor: "var(--border)" }}><span className="flex flex-col items-center gap-2 text-sm font-bold"><Plus size={24} />添加新空间</span></button></div></>;
}

function SettingsView({ theme, onTheme, onToast, onAbout }: { theme: ThemeMode; onTheme: (mode: ThemeMode) => void; onToast: (message: string) => void; onAbout: () => void }) {
  const [database, setDatabase] = useState<{ databaseLabel: string; storageMode: string } | null>(null);
  useEffect(() => { let active = true; request<{ databaseLabel: string; storageMode: string }>("/api/system/info").then((result) => { if (active) setDatabase(result); }).catch(() => undefined); return () => { active = false; }; }, []);
  return <><PageTitle title="设置" text="调整归物的显示、存储和部署偏好。" /><div className="max-w-3xl space-y-4">
    <section className="surface rounded-3xl p-5"><h3 className="m-0 text-base">显示</h3><div className="mt-4 flex flex-wrap gap-2">{([ ["light", "浅色", Sun], ["dark", "深色", Moon], ["system", "跟随系统", Monitor] ] as const).map(([mode, label, Icon]) => <button key={mode} onClick={() => onTheme(mode)} className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold transition" style={theme === mode ? { background: "var(--primary)", color: "white" } : { background: "var(--surface-soft)", color: "var(--muted)" }}><Icon size={17} />{label}</button>)}</div></section>
    <AiSettings onToast={onToast} />
    <OssSettings onToast={onToast} />
    <section className="surface rounded-3xl p-5"><h3 className="m-0 text-base">数据与部署</h3><SettingRow icon={Grid2X2} title={`当前数据库：${database?.databaseLabel || "检测中…"}`} text={database ? `${database.storageMode} · 可通过 DATABASE_PROVIDER 切换` : "正在读取运行环境"} action={<span className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>{database?.databaseLabel || "检测中"}</span>} /><SettingRow icon={Info} title="关于归物" text={`版本 ${APP_VERSION} · 更新说明与使用提示`} action={<button onClick={onAbout} className="btn-ghost text-xs">查看</button>} /></section>
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

type OssForm = { configured: boolean; managedByEnvironment: boolean; region: string; endpoint: string; bucket: string; accessKeyId: string; accessKeySecretConfigured: boolean; publicBaseUrl: string; accessKeySecret: string };
const emptyOssForm: OssForm = { configured: false, managedByEnvironment: false, region: "", endpoint: "", bucket: "", accessKeyId: "", accessKeySecretConfigured: false, publicBaseUrl: "", accessKeySecret: "" };

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
  return <section className="surface rounded-3xl p-5"><div className="flex items-center justify-between gap-3"><div><h3 className="m-0 flex items-center gap-2 text-base"><Cloud size={18} style={{ color: "var(--primary)" }} />OSS 图片存储</h3><p className="mb-0 mt-1 text-xs muted">支持阿里云 OSS，也可填写兼容 Endpoint。</p></div><span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: form.configured ? "#e0f7ef" : "var(--surface-soft)", color: form.configured ? "var(--success)" : "var(--muted)" }}>{loading ? "检测中" : form.configured ? "已配置" : "未配置"}</span></div>
    {!loading && <form onSubmit={save} className="mt-5 space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Field label="Region"><input required disabled={form.managedByEnvironment} className="input" value={form.region} onChange={(e) => set("region", e.target.value)} placeholder="oss-cn-hangzhou" /></Field><Field label="Bucket"><input required disabled={form.managedByEnvironment} className="input" value={form.bucket} onChange={(e) => set("bucket", e.target.value)} placeholder="home-inventory" /></Field></div><Field label="Endpoint（可选）"><input disabled={form.managedByEnvironment} className="input" value={form.endpoint} onChange={(e) => set("endpoint", e.target.value)} placeholder="https://oss-cn-hangzhou.aliyuncs.com" /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="AccessKey ID"><input required disabled={form.managedByEnvironment} className="input" value={form.accessKeyId} onChange={(e) => set("accessKeyId", e.target.value)} autoComplete="off" /></Field><Field label="AccessKey Secret"><input disabled={form.managedByEnvironment} className="input" type="password" value={form.accessKeySecret} onChange={(e) => set("accessKeySecret", e.target.value)} placeholder={form.accessKeySecretConfigured ? "已保存，留空则不修改" : "首次配置必填"} autoComplete="new-password" /></Field></div><Field label="公开访问域名（可选）"><input disabled={form.managedByEnvironment} className="input" value={form.publicBaseUrl} onChange={(e) => set("publicBaseUrl", e.target.value)} placeholder="https://img.example.com" /></Field><div className="flex items-center justify-between gap-3 pt-1"><p className="m-0 text-[11px] leading-5 muted">Secret 仅保存在服务端数据库，不会返回浏览器。生产环境优先使用 OSS_* 环境变量。</p>{form.managedByEnvironment ? <span className="whitespace-nowrap text-xs font-bold muted">环境变量托管</span> : <button disabled={saving} className="btn-primary whitespace-nowrap px-4 py-2 text-sm">{saving ? "保存中…" : "保存 OSS"}</button>}</div></form>}
  </section>;
}

function NotificationsModal({ lowStock, expiring, expired, fridge, onClose, onOpenItem, onShopping, onFridge }: { lowStock: Item[]; expiring: Item[]; expired: Item[]; fridge?: FridgeSummary; onClose: () => void; onOpenItem: (item: Item) => void; onShopping: () => void; onFridge: () => void }) {
  const alerts = [
    ...expired.map((item) => ({ item, label: `${["食品", "饮品"].includes(item.category) ? "食品" : "物品"}已过期 · ${new Date(item.expiryDate!).toLocaleDateString("zh-CN")}`, color: "var(--danger)" })),
    ...expiring.filter((item) => !expired.some((old) => old.id === item.id)).map((item) => ({ item, label: `${["食品", "饮品"].includes(item.category) ? "食品即将到期" : "即将到期"} · ${new Date(item.expiryDate!).toLocaleDateString("zh-CN")}`, color: "var(--warning)" })),
    ...lowStock.filter((item) => !expired.some((old) => old.id === item.id)).map((item) => ({ item, label: isLiquidConsumable(item) && item.remainingPercent <= 20 ? `剩余量仅 ${Math.round(item.remainingPercent)}%` : `库存仅剩 ${item.quantity} ${item.unit}`, color: "#e37d25" })),
  ];
  const fridgeAlert = fridge && (fridge.status === "TOO_WARM" || fridge.status === "TOO_COLD");
  return <Modal title="提醒中心" subtitle={`${alerts.length + (fridgeAlert ? 1 : 0)} 条待处理事项`} onClose={onClose}><div className="space-y-2">{fridgeAlert && <button onClick={onFridge} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left" style={{ background: "#fff1df" }}><Thermometer size={18} style={{ color: "var(--warning)" }} /><div className="min-w-0 flex-1"><div className="text-sm font-bold">冰箱温度{fridge.status === "TOO_WARM" ? "偏高" : "偏低"}</div><div className="mt-1 text-xs muted">当前 {fridge.latest?.temperature}℃，建议范围 {fridge.setting.targetMin}–{fridge.setting.targetMax}℃</div></div><ChevronRight size={16} /></button>}{alerts.map(({ item, label, color }) => <button key={`${item.id}-${label}`} onClick={() => onOpenItem(item)} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left" style={{ background: "var(--surface-soft)" }}><span className="size-2 rounded-full" style={{ background: color }} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{item.name}</div><div className="mt-1 text-xs muted">{label}</div></div><ChevronRight size={16} className="muted" /></button>)}{alerts.length === 0 && !fridgeAlert && <EmptyState icon={Check} title="暂无提醒" text="库存、保质期和冰箱温度都在安全范围内" />}</div>{lowStock.length > 0 && <button onClick={onShopping} className="btn-primary mt-4 w-full">查看采购清单</button>}</Modal>;
}

function FridgeModal({ fridge, onClose, onSaved }: { fridge: FridgeSummary; onClose: () => void; onSaved: () => void }) {
  const [temperature, setTemperature] = useState(fridge.latest?.temperature ?? 4);
  const [targetMin, setTargetMin] = useState(fridge.setting.targetMin);
  const [targetMax, setTargetMax] = useState(fridge.setting.targetMax);
  const [enabled, setEnabled] = useState(fridge.setting.enabled);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const state = temperature < targetMin ? "偏低，可能造成蔬果冻伤" : temperature > targetMax ? "偏高，食品变质风险上升" : "处于建议范围";
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { await Promise.all([request("/api/fridge", { method: "POST", body: JSON.stringify({ temperature, note }) }), request("/api/fridge", { method: "PATCH", body: JSON.stringify({ enabled, targetMin, targetMax }) })]); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setSaving(false); } };
  return <Modal title="冰箱温度" subtitle={`建议冷藏区保持 ${targetMin}–${targetMax}℃`} onClose={onClose}><form onSubmit={submit} className="space-y-4"><div className="grid place-items-center rounded-3xl p-5" style={{ background: temperature >= targetMin && temperature <= targetMax ? "#e0f7ef" : "#fff1df" }}><Snowflake size={26} style={{ color: temperature >= targetMin && temperature <= targetMax ? "var(--success)" : "var(--warning)" }} /><div className="mt-2 text-4xl font-black">{temperature}℃</div><div className="mt-1 text-xs muted">{state}</div></div><Field label="本次温度"><input type="number" step="0.1" min="-10" max="30" className="input" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} /></Field><div className="grid grid-cols-2 gap-3"><Field label="提醒下限"><input type="number" step="0.5" className="input" value={targetMin} onChange={(e) => setTargetMin(Number(e.target.value))} /></Field><Field label="提醒上限"><input type="number" step="0.5" className="input" value={targetMax} onChange={(e) => setTargetMax(Number(e.target.value))} /></Field></div><Field label="备注（可选）"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：调整到 3 档" /></Field><button type="button" onClick={() => setEnabled(!enabled)} className="flex w-full items-center justify-between rounded-2xl p-3 text-sm" style={{ background: "var(--surface-soft)" }}><span>温度异常提醒</span><span className="font-bold" style={{ color: enabled ? "var(--success)" : "var(--muted)" }}>{enabled ? "已开启" : "已关闭"}</span></button>{error && <p className="m-0 text-sm text-red-500">{error}</p>}<div className="flex gap-3"><button type="button" onClick={onClose} className="btn-ghost flex-1">取消</button><button disabled={saving} className="btn-primary flex-1">{saving ? "保存中…" : "记录温度"}</button></div></form></Modal>;
}

function AboutView({ onWelcome }: { onWelcome: () => void }) {
  return <><PageTitle title="关于归物" text="轻量、清楚、真正适合家庭日常使用。" /><div className="max-w-3xl space-y-4"><section className="surface rounded-3xl p-6"><div className="flex items-center gap-4"><div className="grid size-14 place-items-center rounded-3xl text-white" style={{ background: "linear-gradient(145deg, var(--primary), #a177ff)" }}><Archive size={26} /></div><div><h2 className="m-0 text-xl font-black">归物 HomeInventory</h2><p className="mb-0 mt-1 text-sm muted">版本 {APP_VERSION} · MVP 迭代起点</p></div></div><p className="mb-0 mt-5 text-sm leading-7 muted">归物帮助家庭记录物品、消耗品、保质期、采购与价格。功能设计遵循“少一步操作、少一个干扰”的原则，复杂能力放在需要时再展开。</p></section><section className="surface rounded-3xl p-6"><h3 className="m-0 text-base">{APP_VERSION} 更新内容</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><AboutFeature icon={Package} title="开箱示范" text="空库自动准备少量示范数据，已有家庭数据绝不覆盖。" /><AboutFeature icon={AlertTriangle} title="保质期预警" text="区分已过期和即将到期，食品提醒更明确。" /><AboutFeature icon={Snowflake} title="冰箱温度" text="记录温度并在超出范围时提醒。" /><AboutFeature icon={WalletCards} title="消费概览" text="保留购买价格流水与近 6 月均值。" /></div></section><button onClick={onWelcome} className="btn-ghost text-sm">重新查看欢迎页</button></div></>;
}

function AboutFeature({ icon: Icon, title, text }: { icon: typeof Info; title: string; text: string }) { return <div className="rounded-2xl p-4" style={{ background: "var(--surface-soft)" }}><Icon size={18} style={{ color: "var(--primary)" }} /><div className="mt-3 text-sm font-bold">{title}</div><p className="mb-0 mt-1 text-xs leading-5 muted">{text}</p></div>; }

function WelcomeModal({ hasDemoData, onClose }: { hasDemoData: boolean; onClose: () => void }) {
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] grid place-items-center bg-black/35 p-4 backdrop-blur-sm"><motion.div initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="w-full max-w-lg rounded-[30px] p-6 shadow-2xl sm:p-7" style={{ background: "var(--surface-solid)" }}><div className="flex items-start gap-4"><div className="grid size-12 shrink-0 place-items-center rounded-2xl text-white" style={{ background: "linear-gradient(145deg, var(--primary), #a177ff)" }}><Archive size={22} /></div><div><div className="text-xs font-bold" style={{ color: "var(--primary)" }}>欢迎使用 · v{APP_VERSION}</div><h2 className="mb-0 mt-1 text-2xl font-black">让家里的每件东西都有归处</h2></div></div><p className="mb-0 mt-4 text-sm leading-6 muted">{hasDemoData ? "已为你准备少量示范数据，可以直接体验库存、临期提醒、采购和消费概览，也可以随时编辑或删除。" : "先从常用物品开始录入。归物会在需要时提醒库存、保质期和冰箱温度，不会用复杂流程打断你。"}</p><div className="my-5 grid gap-2 sm:grid-cols-3"><WelcomePoint icon={Package} text="快速记录" /><WelcomePoint icon={Bell} text="适时提醒" /><WelcomePoint icon={WalletCards} text="消费有数" /></div><button onClick={onClose} className="btn-primary w-full">开始体验</button></motion.div></motion.div>;
}

function WelcomePoint({ icon: Icon, text }: { icon: typeof Package; text: string }) { return <div className="flex items-center gap-2 rounded-2xl p-3 text-xs font-bold" style={{ background: "var(--surface-soft)" }}><Icon size={16} style={{ color: "var(--primary)" }} />{text}</div>; }

function QrModal({ item, onClose, onPrint }: { item: Item; onClose: () => void; onPrint: () => void }) {
  const url = `${globalThis.location?.origin || ""}/items/${item.id}`;
  return <Modal title="物品二维码" subtitle="扫码即可快速查看物品信息" onClose={onClose}><div className="grid place-items-center"><div className="rounded-3xl bg-white p-5"><QRCodeSVG value={url} size={220} level="M" includeMargin /></div><div className="mt-4 text-center"><div className="text-lg font-black">{item.name}</div><div className="mt-1 font-mono text-xs muted">{item.itemCode || item.id}</div><div className="mt-2 text-xs muted">{item.category} · {item.location?.name || "未设置位置"} · {item.quantity}{item.unit}</div></div><div className="mt-5 flex gap-2"><a href={url} target="_blank" rel="noreferrer" className="btn-ghost text-sm">打开详情</a><button onClick={onPrint} className="btn-primary flex items-center gap-2 text-sm"><Printer size={16} />打印二维码</button></div></div></Modal>;
}

function ItemModal({ locations, item, onClose, onSaved }: { locations: Location[]; item: Item | null; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<ItemDraft>(() => item ? { name: item.name, category: item.category, type: item.type, quantity: item.quantity, minQuantity: item.minQuantity, remainingPercent: item.remainingPercent, unit: item.unit, price: item.price?.toString() ?? "", purchaseDate: item.purchaseDate?.slice(0, 10) ?? "", expiryDate: item.type === "CONSUMABLE" ? item.expiryDate?.slice(0, 10) ?? "" : "", locationId: item.locationId ?? "", notes: item.notes ?? "", imageUrl: item.imageUrl ?? "" } : emptyDraft);
  const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false); const [aiLoading, setAiLoading] = useState(false); const [moreOpen, setMoreOpen] = useState(false); const [error, setError] = useState("");
  const [recordPurchase, setRecordPurchase] = useState(!item);
  const [purchaseStore, setPurchaseStore] = useState("");
  const set = (key: keyof ItemDraft, value: string | number) => setDraft((old) => ({ ...old, [key]: value }));
  const uploadImage = async (file?: File) => { if (!file) return; setUploading(true); setError(""); try { const form = new FormData(); form.append("file", file); const response = await fetch("/api/upload", { method: "POST", body: form }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "上传失败"); set("imageUrl", result.url); } catch (e) { setError(e instanceof Error ? e.message : "上传失败"); } finally { setUploading(false); } };
  const applyAi = (analysis: AiAnalysis) => setDraft((old) => { const type = analysis.type || old.type; return { ...old, name: analysis.name || old.name, category: analysis.category || old.category, type, unit: analysis.unit || old.unit, expiryDate: type === "DURABLE" ? "" : analysis.suggestedExpiryDate || old.expiryDate, notes: analysis.suggestedNotes || analysis.storageAdvice ? [old.notes, analysis.suggestedNotes, analysis.storageAdvice && `存储建议：${analysis.storageAdvice}`].filter(Boolean).join("\n") : old.notes }; });
  const runAi = async (action: "identify" | "shelf_life") => { setAiLoading(true); setError(""); try { const result = await analyzeItem({ action, imageUrl: draft.imageUrl || null, hint: draft.name, item: { name: draft.name, category: draft.category, type: draft.type, quantity: draft.quantity, minQuantity: draft.minQuantity, unit: draft.unit, purchaseDate: draft.purchaseDate || null, expiryDate: draft.expiryDate || null, notes: draft.notes || null } }); applyAi(result.analysis); if (action === "shelf_life") setMoreOpen(true); } catch (e) { setError(e instanceof Error ? e.message : "AI 分析失败"); } finally { setAiLoading(false); } };
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { const payload = draft.type === "DURABLE" ? { ...draft, expiryDate: "" } : draft; await request(item ? `/api/items/${item.id}` : "/api/items", { method: item ? "PATCH" : "POST", body: JSON.stringify({ ...payload, recordPurchase, purchaseStore }) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setSaving(false); } };
  const dailyCostPreview = dailyUsageCost({ type: draft.type, price: draft.price === "" ? null : Number(draft.price), purchaseDate: draft.purchaseDate || null });
  return <Modal title={item ? "编辑物品" : "录入新物品"} subtitle={item?.itemCode || "只填名称和数量也可以，其他信息稍后补充"} onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <div className="flex gap-3"><label className="group grid size-20 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-2xl border border-dashed bg-cover bg-center transition hover:border-[var(--primary)]" style={draft.imageUrl ? { backgroundImage: `url(${draft.imageUrl})`, borderColor: "var(--primary)" } : { borderColor: "var(--border)", background: "var(--surface-soft)" }}>{!draft.imageUrl && (uploading ? <Sparkles className="animate-pulse" size={22} /> : <ImagePlus className="muted" size={24} />)}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={uploading} onChange={(e) => uploadImage(e.target.files?.[0])} /></label><div className="min-w-0 flex-1"><label className="mb-1.5 block text-xs font-bold muted">物品名称 *</label><input autoFocus required className="input" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="拍照让 AI 识别，或直接输入名称" /><div className="mt-2 flex gap-2"><button type="button" disabled={aiLoading || (!draft.name && !draft.imageUrl)} onClick={() => runAi("identify")} className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-40"><Sparkles size={14} />{aiLoading ? "分析中…" : "AI 补全"}</button>{draft.type === "CONSUMABLE" && <button type="button" disabled={aiLoading || (!draft.name && !draft.imageUrl)} onClick={() => runAi("shelf_life")} className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-40"><Bot size={14} />分析保质期</button>}</div></div></div>
    <div className="grid grid-cols-2 gap-3"><label className="cursor-pointer rounded-2xl border px-3 py-2.5 transition" style={draft.type === "DURABLE" ? { borderColor: "var(--primary)", background: "var(--primary-soft)" } : { borderColor: "var(--border)" }}><input type="radio" className="hidden" checked={draft.type === "DURABLE"} onChange={() => setDraft((old) => ({ ...old, type: "DURABLE", expiryDate: "" }))} /><div className="text-sm font-bold">📦 耐用品</div></label><label className="cursor-pointer rounded-2xl border px-3 py-2.5 transition" style={draft.type === "CONSUMABLE" ? { borderColor: "var(--primary)", background: "var(--primary-soft)" } : { borderColor: "var(--border)" }}><input type="radio" className="hidden" checked={draft.type === "CONSUMABLE"} onChange={() => set("type", "CONSUMABLE")} /><div className="text-sm font-bold">🧴 消耗品</div></label></div>
    <div className="grid grid-cols-2 gap-3"><Field label="分类"><select className="input" value={draft.category} onChange={(e) => set("category", e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select></Field><Field label="存放位置"><select className="input" value={draft.locationId} onChange={(e) => set("locationId", e.target.value)}><option value="">未设置</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field></div>
    <div className="grid grid-cols-2 gap-3"><Field label="数量"><input required type="number" min="0" step="0.1" className="input" value={draft.quantity} onChange={(e) => set("quantity", Number(e.target.value))} /></Field><Field label="单位"><select className="input" value={draft.unit} onChange={(e) => set("unit", e.target.value)}>{units.map((u) => <option key={u}>{u}</option>)}</select></Field></div>
    {draft.type === "CONSUMABLE" && <div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><div className="mb-2 flex items-center justify-between text-xs"><span className="font-bold">剩余量</span><span className="font-black" style={{ color: draft.remainingPercent <= 20 ? "var(--danger)" : "var(--primary)" }}>{draft.remainingPercent}%</span></div><input aria-label="剩余量" type="range" min="0" max="100" step="5" className="w-full accent-[var(--primary)]" value={draft.remainingPercent} onChange={(e) => set("remainingPercent", Number(e.target.value))} /></div>}
    <button type="button" onClick={() => setMoreOpen(!moreOpen)} className="flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-sm font-bold" style={{ background: "var(--surface-soft)" }}><span>更多信息 <span className="ml-1 text-xs font-normal muted">价格、日期、提醒、备注</span></span><ChevronDown size={17} className={`transition ${moreOpen ? "rotate-180" : ""}`} /></button>
    {moreOpen && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-3 overflow-hidden"><div className={`grid gap-3 ${draft.type === "CONSUMABLE" ? "grid-cols-2" : "grid-cols-1"}`}><Field label="购买单价"><input type="number" min="0" step="0.01" className="input" value={draft.price} onChange={(e) => set("price", e.target.value)} placeholder="¥" /></Field>{draft.type === "CONSUMABLE" && <Field label="低库存阈值"><input type="number" min="0" step="0.1" className="input" value={draft.minQuantity} onChange={(e) => set("minQuantity", Number(e.target.value))} /></Field>}</div>{dailyCostPreview && <div className="flex items-center justify-between rounded-2xl p-3 text-sm" style={{ background: "var(--primary-soft)" }}><span className="font-bold">当前日均成本</span><span><b>¥{dailyCostPreview.cost.toFixed(dailyCostPreview.cost >= 10 ? 0 : 2)}</b><span className="ml-1 text-xs muted">/ 天 · 已使用 {dailyCostPreview.days} 天</span></span></div>}{draft.price && <div className="rounded-2xl p-3" style={{ background: "var(--surface-soft)" }}><button type="button" onClick={() => setRecordPurchase(!recordPurchase)} className="flex w-full items-center justify-between text-sm"><span>记入本月消费记录</span><span className="font-bold" style={{ color: recordPurchase ? "var(--success)" : "var(--muted)" }}>{recordPurchase ? "是" : "否"}</span></button>{recordPurchase && <input className="input mt-3" value={purchaseStore} onChange={(e) => setPurchaseStore(e.target.value)} placeholder="购买商店（可选）" />}</div>}<div className={`grid gap-3 ${draft.type === "CONSUMABLE" ? "grid-cols-2" : "grid-cols-1"}`}><Field label="购入日期"><input type="date" className="input" value={draft.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} /></Field>{draft.type === "CONSUMABLE" && <Field label="到期日期"><input type="date" className="input" value={draft.expiryDate} onChange={(e) => set("expiryDate", e.target.value)} /></Field>}</div><Field label="备注"><textarea className="input min-h-20 resize-none" value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="规格、保修、使用提示…" /></Field></motion.div>}
    {error && <p className="m-0 rounded-xl p-2.5 text-sm text-red-500" style={{ background: "#ffe8eb" }}>{error}</p>}<div className="flex gap-3 pt-1"><button type="button" onClick={onClose} className="btn-ghost flex-1">取消</button><button disabled={saving || uploading || aiLoading} className="btn-primary flex-1 disabled:opacity-60">{saving ? "保存中…" : item ? "保存修改" : "快速保存"}</button></div>
  </form></Modal>;
}

function ShoppingModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) { const [name, setName] = useState(""); const [quantity, setQuantity] = useState(1); const [unit, setUnit] = useState("件"); const submit = async (e: FormEvent) => { e.preventDefault(); await request("/api/shopping", { method: "POST", body: JSON.stringify({ name, quantity, unit, priority: 1, source: "manual" }) }); onSaved(); }; return <Modal title="添加采购项" subtitle="想到什么就记下来，买齐后打勾。" onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label="需要采购什么？"><input autoFocus required className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：厨房纸" /></Field><div className="grid grid-cols-2 gap-3"><Field label="数量"><input type="number" min="0.1" step="0.1" className="input" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></Field><Field label="单位"><select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>{units.map((u) => <option key={u}>{u}</option>)}</select></Field></div><div className="flex gap-3 pt-2"><button type="button" onClick={onClose} className="btn-ghost flex-1">取消</button><button className="btn-primary flex-1">加入清单</button></div></form></Modal>; }

function LocationModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) { const [name, setName] = useState(""); const [color, setColor] = useState("#7c3aed"); const submit = async (e: FormEvent) => { e.preventDefault(); await request("/api/locations", { method: "POST", body: JSON.stringify({ name, color, icon: "Package" }) }); onSaved(); }; return <Modal title="添加家庭空间" subtitle="房间、柜子或任何方便查找的位置。" onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label="空间名称"><input autoFocus required className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：主卧衣柜" /></Field><Field label="标记颜色"><div className="flex items-center gap-3"><input type="color" className="h-11 w-16 cursor-pointer rounded-xl border-0 bg-transparent" value={color} onChange={(e) => setColor(e.target.value)} /><span className="text-sm muted">用于快速区分空间</span></div></Field><div className="flex gap-3 pt-2"><button type="button" onClick={onClose} className="btn-ghost flex-1">取消</button><button className="btn-primary flex-1">创建空间</button></div></form></Modal>; }

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) { return <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 backdrop-blur-sm sm:items-center sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}><motion.div initial={{ y: 35, opacity: 0, scale: .98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 25, opacity: 0 }} transition={{ type: "spring", damping: 28, stiffness: 340 }} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] p-5 shadow-2xl sm:rounded-[28px] sm:p-6" style={{ background: "var(--surface-solid)" }}><div className="mb-6 flex items-start gap-3"><div className="flex-1"><h2 className="m-0 text-xl font-black">{title}</h2><p className="mb-0 mt-1 text-xs muted">{subtitle}</p></div><button onClick={onClose} className="btn-ghost grid size-9 place-items-center p-0"><X size={17} /></button></div>{children}</motion.div></motion.div>; }

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold muted">{label}</span>{children}</label>; }
function SectionHead({ title, action, onClick }: { title: string; action: string; onClick: () => void }) { return <div className="flex items-center justify-between"><h2 className="m-0 text-base font-black sm:text-lg">{title}</h2><button onClick={onClick} className="flex items-center gap-1 text-xs font-bold" style={{ color: "var(--primary)" }}>{action}<ChevronRight size={14} /></button></div>; }
function EmptyState({ icon: Icon, title, text }: { icon: typeof Boxes; title: string; text: string }) { return <div className="col-span-full grid place-items-center py-10 text-center"><div className="mb-3 grid size-12 place-items-center rounded-2xl" style={{ background: "var(--surface-soft)", color: "var(--muted)" }}><Icon size={21} /></div><b className="text-sm">{title}</b><p className="mb-0 mt-1 text-xs muted">{text}</p></div>; }
function LoadingView() { return <div><div className="skeleton mb-3 h-9 w-64 rounded-xl" /><div className="skeleton mb-7 h-4 w-80 max-w-full rounded-lg" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1,2,3,4].map((i) => <div key={i} className="skeleton h-36 rounded-3xl" />)}</div><div className="mt-5 grid gap-4 md:grid-cols-2">{[1,2].map((i) => <div key={i} className="skeleton h-72 rounded-3xl" />)}</div></div>; }
