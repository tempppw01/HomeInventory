"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";

import { Bell, Bot, Info, Monitor, Moon, Plus, Settings, Sun, Trash2, PanelLeftClose } from "lucide-react";
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardData, HouseholdTask, Item, Location, ShoppingItem } from "@/types";

import { RecycleBinModal } from "@/components/recycle-bin-modal";



import { AiChat } from "@/components/ai-chat";
import { AiAssistantModal } from "@/components/ai-assistant-modal";
import { PrintStudio } from "@/components/print-studio";
import { SearchBox } from "@/components/search-box";

import { BatchAiImport } from "@/components/batch-ai-import";
import { isCountUnit, isLiquidConsumable } from "@/lib/item-metrics";

import { APP_VERSION } from "@/lib/version";

import { isMedicineCategory } from "@/lib/categories";
import { PageShell } from "@/components/ui";

import { useModalFocusManagement } from "@/lib/dialog-focus";
import { ConfirmProvider, useConfirm } from "@/components/confirm-dialog";




import { ReadOnlyContext, View, ThemeMode, ItemQuickFilter, AssistantPosition, compressImage, navItems, mobileNavItems, returnStateKey, readReturnState, welcomeStorageKey, legacyWelcomeStorageKeys, assistantPositionStorageKey, normalizedItemName, expiryDays, request, Brand, LoadingView } from "@/components/shared";
import { NotificationsModal, WelcomeModal, QrModal, ShoppingModal, LocationModal } from "@/components/views/modals";
import { DashboardView } from "@/components/views/dashboard-view";
import { ItemsView } from "@/components/views/items-view";
import { LocationsView } from "@/components/views/locations-view";
import { TasksView, TaskModal } from "@/components/views/tasks-view";
import { AuditView } from "@/components/views/audit-view";
import { SettingsView } from "@/components/views/settings-view";
import { AboutView } from "@/components/views/about-view";
import { ItemModal } from "@/components/views/item-modal";
// A read-only account is rejected by the server with 403, so offering write
// buttons only produces a failed round trip. Views read this flag instead.
function InventoryAppShell() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemQuickFilter>("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [modal, setModal] = useState<"item" | "shopping" | "location" | "task" | "notifications" | "recycle" | "batch-ai" | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [qrItem, setQrItem] = useState<Item | null>(null);
  const [printItems, setPrintItems] = useState<Item[] | null>(null);
  const [aiItem, setAiItem] = useState<Item | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastAction, setToastAction] = useState<{ label: string; onClick: () => void } | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [showWelcome, setShowWelcome] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // 默认折叠:首屏把注意力留给内容;用户手动切换过之后会记住自己的选择。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [density, setDensity] = useState<"comfortable" | "compact">(() => typeof window !== "undefined" && localStorage.getItem("home-inventory-density") === "compact" ? "compact" : "comfortable");
  const [motionMode, setMotionMode] = useState<"standard" | "reduced">(() => typeof window !== "undefined" && localStorage.getItem("home-inventory-motion") === "reduced" ? "reduced" : "standard");
  const [now, setNow] = useState(() => Date.now());
  const [role, setRole] = useState<"ADMIN" | "MEMBER" | "VIEWER" | null>(null);
  const readOnly = role === "VIEWER";

  useEffect(() => {
    let active = true;
    request<{ user?: { role?: "ADMIN" | "MEMBER" | "VIEWER" } | null }>("/api/auth/session")
      .then((result) => { if (active) setRole(result?.user?.role ?? null); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  // Keeps keyboard focus inside whichever modal is open, returns it to the
  // trigger on close, and stops the page behind from scrolling.
  useModalFocusManagement();
  const askConfirm = useConfirm();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  // A snapshot younger than this is reused when the user only navigates. Every
  // mutation still refetches explicitly through refresh().
  const snapshotMaxAgeMs = 15_000;
  const lastLoadedAt = useRef(0);
  const pendingLoad = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await request<DashboardData>("/api/dashboard");
      lastLoadedAt.current = Date.now();
      setData(result);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "载入失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // Navigation, filtering and the focus/visibility wake-up used to each fire a
  // full dashboard refetch. Home servers answer slowly, so switching tabs felt
  // like a reload every time. Reuse a recent snapshot and collapse simultaneous
  // callers into a single request.
  const ensureFresh = useCallback(() => {
    if (pendingLoad.current) return pendingLoad.current;
    if (Date.now() - lastLoadedAt.current < snapshotMaxAgeMs) return Promise.resolve();
    const promise = refresh().finally(() => { if (pendingLoad.current === promise) pendingLoad.current = null; });
    pendingLoad.current = promise;
    return promise;
  }, [refresh]);

  useEffect(() => {
    let active = true;
    request<DashboardData>("/api/dashboard")
      .then((result) => { if (active) { lastLoadedAt.current = Date.now(); setData(result); } })
      .catch((error) => { if (active) setToast(error instanceof Error ? error.message : "载入失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const key = "home-inventory-auto-backup-check";
    if (role !== "ADMIN") return;
    if (localStorage.getItem(key) === new Date().toISOString().slice(0, 10)) return;
    fetch("/api/backup/auto", { method: "POST" }).then(() => localStorage.setItem(key, new Date().toISOString().slice(0, 10))).catch(() => undefined);
  }, [role]);
  const openView = useCallback((nextView: View) => {
    window.dispatchEvent(new CustomEvent("home-inventory:progress", { detail: "start" }));
    setView(nextView);
    void ensureFresh();
    window.requestAnimationFrame(() => window.setTimeout(() => window.dispatchEvent(new CustomEvent("home-inventory:progress", { detail: "done" })), 200));
  }, [ensureFresh]);
  const changeTypeFilter = useCallback((nextFilter: ItemQuickFilter) => {
    setTypeFilter(nextFilter);
    // 类型切换后重置分类，避免从“医药”切回“全部”时仍被旧分类条件卡住。
    setCategoryFilter(nextFilter === "MEDICINE" ? "MEDICINE" : "ALL");
  }, []);
  const changeCategoryFilter = useCallback((nextFilter: string) => {
    setCategoryFilter(nextFilter);
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem("home-inventory-sidebar-collapsed");
    if (saved === null) return;
    const frame = requestAnimationFrame(() => setSidebarCollapsed(saved === "true"));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void ensureFresh();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [ensureFresh]);
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
    document.documentElement.dataset.density = density;
    document.documentElement.dataset.motion = motionMode;
  }, [density, motionMode]);
  useEffect(() => { request<{ id: string }[]>("/api/members").then((members) => setMemberId(members[0]?.id ?? null)).catch(() => undefined); }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => { setToast(null); setToastAction(null); }, toastAction ? 5200 : 2600);
    return () => clearTimeout(timer);
  }, [toast, toastAction]);

  useEffect(() => {
    const saved = readReturnState();
    if (!saved.view && !saved.search) return;
    const frame = requestAnimationFrame(() => {
      if (saved.view) setView(saved.view);
      if (typeof saved.search === "string") setSearch(saved.search);
      if (saved.typeFilter) setTypeFilter(saved.typeFilter);
      if (typeof saved.categoryFilter === "string") setCategoryFilter(saved.categoryFilter);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

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
      item.quantity > 0 &&
      (typeFilter === "ALL" || (typeFilter === "MEDICINE" ? isMedicineCategory(item.category) : item.type === typeFilter)) &&
      (categoryFilter === "ALL" || (categoryFilter === "MEDICINE" ? isMedicineCategory(item.category) : item.category === categoryFilter)) &&
      (!term || [item.name, item.itemCode, item.category, item.location?.name].some((value) => value?.toLowerCase().includes(term))),
    );
  }, [categoryFilter, data, search, typeFilter]);

  const lowStock = data?.preferences?.lowStockReminder === false ? [] : (data?.items ?? []).filter((item) => item.quantity > 0 && item.type === "CONSUMABLE" && (!item.restockPausedUntil || new Date(item.restockPausedUntil).getTime() <= now) && ((item.minQuantity > 0 && item.quantity <= item.minQuantity) || (isLiquidConsumable(item) && item.remainingPercent <= 20)));
  const pendingShopping = (data?.shopping ?? []).filter((item) => item.status === "PENDING");
  const tasks = data?.tasks ?? [];
  const expiryReminderDays = data?.preferences?.expiryReminderDays ?? 14;
  const expiring = (data?.items ?? []).filter((item) => item.quantity > 0 && item.type === "CONSUMABLE" && item.expiryDate && expiryDays(item, now) > 0 && expiryDays(item, now) <= expiryReminderDays);
  const expired = (data?.items ?? []).filter((item) => item.quantity > 0 && item.type === "CONSUMABLE" && item.expiryDate && expiryDays(item, now) <= 0);

  // 辅助信息平时不打扰:只有「已经有东西过期」这种关键时刻才自动弹出提醒,
  // 而且每天最多一次,避免每次打开都被拦住。
  useEffect(() => {
    if (loading || expired.length === 0 || modal !== null || showWelcome) return;
    const key = `home-inventory-expiry-notice-${new Date().toISOString().slice(0, 10)}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "seen");
    // 通过 rAF 触发,避免在 effect 里同步 setState 造成级联渲染。
    const frame = requestAnimationFrame(() => setModal("notifications"));
    return () => cancelAnimationFrame(frame);
  }, [loading, expired.length, modal, showWelcome]);
  const totalValue = (data?.items ?? []).reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0);
  const toggleTask = async (task: HouseholdTask) => { try { setToastAction(null); const previousDueAt = task.dueAt; await request("/api/tasks", { method: "PATCH", body: JSON.stringify({ id: task.id, action: "toggle" }) }); setToast(task.recurrence === "NONE" ? "任务已完成" : "已完成，本次任务已顺延"); setToastAction({ label: "撤销", onClick: async () => { try { await request("/api/tasks", { method: "PATCH", body: JSON.stringify({ id: task.id, action: "undo", previousDueAt }) }); setToastAction(null); setToast("任务已恢复为待办"); await refresh(); } catch (error) { setToast(error instanceof Error ? error.message : "撤销失败"); } } }); await refresh(); } catch (error) { setToast(error instanceof Error ? error.message : "更新任务失败"); } };
  const deleteTask = async (task: HouseholdTask) => { if (!(await askConfirm(`确定删除任务「${task.title}」吗?删除后无法恢复。`, { title: "删除任务", confirmLabel: "删除任务", tone: "danger" }))) return; try { await request("/api/tasks", { method: "PATCH", body: JSON.stringify({ id: task.id, action: "delete" }) }); setToast("任务已删除"); await refresh(); } catch (error) { setToast(error instanceof Error ? error.message : "删除任务失败"); } };

  const openEdit = (item: Item) => { setEditing(item); setModal("item"); };
  const openDetail = (item: Item) => { try { window.sessionStorage.setItem(returnStateKey, JSON.stringify({ view, search, typeFilter, categoryFilter })); } catch { /* Private mode: returning will simply reset the list. */ } window.location.assign(`/items/${encodeURIComponent(item.id)}`); };
  const uploadItemImage = async (item: Item, file?: File) => {
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      const form = new FormData(); form.append("file", compressed);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "上传失败");
      await request(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ imageUrl: result.url }) });
      setToast(`${item.name} 的图片已更新`); await refresh();
    } catch (error) { setToast(error instanceof Error ? error.message : "图片上传失败"); }
  };
  const duplicateItem = async (item: Item) => {
    try {
      await request<Item>("/api/items", { method: "POST", body: JSON.stringify({
        name: `${item.name}（副本）`, category: item.category, type: item.type,
        quantity: isCountUnit(item.unit) ? 1 : item.quantity, minQuantity: item.minQuantity,
        remainingPercent: item.remainingPercent, unit: item.unit, price: item.price,
        purchaseDate: item.purchaseDate, expiryDate: item.expiryDate, imageUrl: item.imageUrl,
        locationId: item.locationId, notes: item.notes, aiSummary: item.aiSummary,
        aiStorageAdvice: item.aiStorageAdvice, aiUsageAdvice: item.aiUsageAdvice,
        aiReplenishmentAdvice: item.aiReplenishmentAdvice,
      }) });
      setToast(`${item.name} 已复制为新物品`);
      await refresh();
    } catch (error) { setToast(error instanceof Error ? error.message : "复制物品失败"); }
  };
  const copyText = async (value: string, message: string) => { try { await navigator.clipboard.writeText(value); setToast(message); } catch { setToast("复制失败，请手动复制"); } };
  const removeShopping = async (id: string) => {
    const entry = (data?.shopping ?? []).find((item) => item.id === id);
    if (!(await askConfirm(`确定删除采购项「${entry?.name ?? "这一项"}」吗?`, { title: "删除采购项", confirmLabel: "删除", tone: "danger" }))) return;
    try {
      await request(`/api/shopping/${id}`, { method: "DELETE" });
      setToast(`${entry?.name ?? "采购项"} 已从采购清单移除`);
      await refresh();
    } catch (error) { setToast(error instanceof Error ? error.message : "删除采购项失败"); }
  };

  const closeModal = () => { setModal(null); setEditing(null); setEditingLocation(null); };

  const consume = async (item: Item) => {
    if (isLiquidConsumable(item)) {
      setToast(`${item.name} 请通过右侧余量刻度记录使用进度`);
      return;
    }
    if (item.quantity <= 0) return;
    try {
      const result = await request<{ item: Item; activityId: string }>(`/api/items/${item.id}/consume`, { method: "POST" });
      setData((current) => current ? { ...current, items: current.items.map((entry) => entry.id === item.id ? result.item : entry) } : current);
      setToast(`${item.name} 已使用 1 ${item.unit}${result.item.quantity === 0 ? "，已从物品列表隐藏" : ""}`);
      setToastAction({ label: "撤销消耗", onClick: async () => { try { await request(`/api/activity/${result.activityId}/undo`, { method: "POST" }); setToastAction(null); setToast(`${item.name} 已恢复`); await refresh(); } catch (error) { setToast(error instanceof Error ? error.message : "撤销失败"); } } });
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
    if (!(await askConfirm(`确定将“${item.name}”移入回收站吗？`, { title: "移入回收站", confirmLabel: "移入回收站" }))) return;
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
    const status = item.status === "PENDING" ? "PURCHASED" : "PENDING";
    let replenishItemId: string | undefined;
    if (status === "PURCHASED" && item.source === "restock-suggestion") {
      const matches = (data?.items ?? []).filter((entry) => normalizedItemName(entry.name) === normalizedItemName(item.name));
      if (matches.length === 1 && await askConfirm(`“${item.name}”已买到。要同时补货到原物品吗？`, { title: "同时补货", confirmLabel: "补货到原物品" })) replenishItemId = matches[0].id;
    }
    await request(`/api/shopping/${item.id}`, { method: "PATCH", body: JSON.stringify({ status, replenishItemId }) });
    setToast(replenishItemId ? "采购已完成，并已补货到物品" : status === "PURCHASED" ? "采购项已完成" : "已恢复为待采购");
    await refresh();
  };
  const toggleFavoriteShopping = async (item: ShoppingItem) => {
    await request(`/api/shopping/${item.id}`, { method: "PATCH", body: JSON.stringify({ isFavorite: !item.isFavorite }) });
    setToast(item.isFavorite ? "已取消常买标记" : "已加入常买清单");
    await refresh();
  };

  return (
    <ReadOnlyContext.Provider value={readOnly}>
    <div className={`min-h-screen md:grid ${sidebarCollapsed ? "md:grid-cols-[76px_minmax(0,1fr)]" : "md:grid-cols-[232px_minmax(0,1fr)]"}`}>
      <aside className={`desktop-only sticky top-0 h-screen border-r px-3 py-5 transition-[width] duration-200 ${sidebarCollapsed ? "items-center" : ""}`} style={{ borderColor: "var(--border)", background: "var(--surface)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}>
        <button onClick={toggleSidebar} className={`flex w-full items-center rounded-xl p-1 text-left transition hover:bg-[var(--surface-soft)] ${sidebarCollapsed ? "justify-center" : "justify-between gap-2"}`} aria-label={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"} title={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}>
          <Brand compact={sidebarCollapsed} />
          {!sidebarCollapsed && <span className="grid size-8 shrink-0 place-items-center rounded-lg muted"><span className="sr-only">折叠侧栏</span><PanelLeftClose size={17} /></span>}
        </button>
        <nav className="mt-9 space-y-1.5">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => openView(id)} className={`ds-nav-item flex w-full items-center rounded-xl py-3 text-sm font-semibold ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3"}`}
              aria-label={label} aria-current={view === id ? "page" : undefined} title={sidebarCollapsed ? label : undefined}
              data-active={view === id} data-compact={sidebarCollapsed}>
              <Icon size={19} strokeWidth={2.2} /> {!sidebarCollapsed && label}
            </button>
          ))}
        </nav>
        <div className={`absolute bottom-5 ${sidebarCollapsed ? "left-3 right-3" : "left-4 right-4"}`}>
          <button onClick={() => openView("settings")} className={`ds-nav-item flex w-full items-center rounded-xl min-h-10 py-2.5 text-sm font-semibold ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3"}`} data-active={view === "settings"} data-compact={sidebarCollapsed} aria-label="设置" title={sidebarCollapsed ? "设置" : undefined}>
            <Settings size={19} /> {!sidebarCollapsed && "设置"}
          </button>
          <button onClick={() => setModal("recycle")} className={`flex w-full items-center rounded-xl min-h-10 py-2.5 text-sm font-semibold muted hover:bg-[var(--surface-soft)] ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3"}`} aria-label="回收站" title={sidebarCollapsed ? "回收站" : undefined}><Trash2 size={19} />{!sidebarCollapsed && "回收站"}</button>
          <button onClick={() => openView("about")} className={`ds-nav-item flex w-full items-center rounded-xl min-h-10 py-2.5 text-sm font-semibold ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3"}`} data-active={view === "about"} data-compact={sidebarCollapsed} aria-label="关于" title={sidebarCollapsed ? `关于 v${APP_VERSION}` : undefined}><Info size={19} />{!sidebarCollapsed && <>关于 <span className="ml-auto text-xs">v{APP_VERSION}</span></>}</button>
        </div>
      </aside>

      <PageShell className="min-w-0">
        <header className="mobile-topbar mb-5 flex items-center gap-2.5 border-b pb-4 md:gap-2 md:pb-3">
          <div className="mobile-only"><Brand compact /></div>
          <div className="desktop-only max-w-md flex-1">
            <SearchBox items={data?.items ?? []} value={search} onChange={setSearch} onSelect={(item) => { setSearch(item.name); openView("items"); }} onFocus={() => openView("items")} placeholder="搜索名称、编号、分类或位置…" />
          </div>
          <button onClick={cycleTheme} className="btn-ghost grid size-10 min-h-10 place-items-center p-0 md:size-9 md:min-h-9" aria-label={`当前主题：${theme === "system" ? "跟随系统" : theme === "light" ? "浅色" : "深色"}`} title="切换主题">{theme === "system" ? <Monitor size={18} /> : theme === "light" ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button onClick={() => setModal("notifications")} className="btn-ghost relative grid size-10 min-h-10 place-items-center p-0 md:size-9 md:min-h-9" aria-label="查看提醒"><Bell size={18} />{lowStock.length + expiring.length + expired.length > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full" style={{ background: "var(--danger)" }} />}</button>
          <button onClick={() => setChatOpen(true)} className="btn-ghost flex size-10 min-h-10 items-center justify-center gap-2 whitespace-nowrap p-0 md:h-9 md:w-auto md:px-3 md:min-h-9" aria-label="打开归物助手" title="归物助手"><Bot size={18} /><span className="hidden min-[1100px]:inline">AI 助手</span></button>{!readOnly && <button onClick={() => setModal("item")} aria-label="录入物品" title="录入物品" className="btn-primary flex h-10 min-h-10 items-center gap-1.5 whitespace-nowrap py-0 px-3 md:h-9 md:px-3 md:min-h-9"><Plus size={18} /><span className="hidden min-[1100px]:inline">录入物品</span></button>}
        </header>

        <AnimatePresence mode="wait">
          <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .22 }}>
            {readOnly && <div className="mb-4 rounded-2xl px-3 py-2 text-xs font-bold" style={{ background: "var(--surface-soft)", color: "var(--muted)" }}>只读账号:可以查看和搜索,不能新增或修改数据。</div>}
            {loading ? <LoadingView /> : view === "dashboard" ? (
              <DashboardView data={{ ...data!, items: data!.items.filter((item) => item.quantity > 0) }} now={now} lowStock={lowStock} expiring={expiring} expired={expired} pending={pendingShopping} totalValue={totalValue} onNavigate={openView} onEdit={openEdit} onOpenDetail={openDetail} onImageUpload={uploadItemImage} onDuplicate={duplicateItem} onConsume={consume} onDelete={removeItem} onAddRestock={addRestockSuggestion} onQr={setQrItem} onAi={setAiItem} onAlerts={() => setModal("notifications")} onCreate={() => setModal("item")} />
            ) : view === "items" ? (
              <ItemsView allItems={data!.items.filter((item) => item.quantity > 0)} locations={data!.locations} items={filteredItems} shopping={data!.shopping} search={search} setSearch={setSearch} filter={typeFilter} setFilter={changeTypeFilter} categoryFilter={categoryFilter} setCategoryFilter={changeCategoryFilter} onEdit={openEdit} onOpenDetail={openDetail} onImageUpload={uploadItemImage} onDuplicate={duplicateItem} onConsume={consume} onRemainingChange={updateRemaining} onDelete={removeItem} onQr={setQrItem} onAi={setAiItem} onPrint={setPrintItems} onToast={setToast} onCopy={(item) => copyText(item.itemCode || item.id, "物品编号已复制")} onToggleShopping={toggleShopping} onFavoriteShopping={toggleFavoriteShopping} onAddShopping={() => setModal("shopping")} onBatchAi={() => setModal("batch-ai")} onDeleteShopping={removeShopping} />
            ) : view === "locations" ? (
              <LocationsView locations={data!.locations} items={data!.items} onAdd={() => { setEditingLocation(null); setModal("location"); }} onOpen={(name) => { setSearch(name); openView("items"); }} onEdit={(location) => { setEditingLocation(location); setModal("location"); }} onToast={setToast} onRefresh={refresh} />
            ) : view === "audit" ? (
              <AuditView items={data!.items.filter((item) => item.quantity > 0)} locations={data!.locations} onRefresh={refresh} onToast={setToast} />
            ) : view === "tasks" ? (
              <TasksView tasks={tasks} onAdd={() => setModal("task")} onToggle={toggleTask} onDelete={deleteTask} />
            ) : view === "settings" ? <SettingsView onToast={setToast} onAbout={() => openView("about")} onAudit={() => openView("audit")} onRecycle={() => setModal("recycle")} theme={theme} onThemeChange={setThemeMode} density={density} motionMode={motionMode} onDensityChange={(next) => { setDensity(next); localStorage.setItem("home-inventory-density", next); }} onMotionChange={(next) => { setMotionMode(next); localStorage.setItem("home-inventory-motion", next); }} /> : <AboutView />}
          </motion.div>
        </AnimatePresence>
      </PageShell>

      <nav aria-label="移动端主导航" className="mobile-only mobile-bottom-nav fixed bottom-0 left-0 right-0 z-30 grid grid-cols-5 gap-1 border-t px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl" style={{ background: "color-mix(in srgb, var(--surface) 94%, transparent)", borderColor: "var(--border)" }}>
        {mobileNavItems.map(({ id, label, icon: Icon }) => {
          const active = view === id;
          return <button key={id} onClick={() => openView(id)} aria-current={active ? "page" : undefined} data-active={active} className="ds-mobile-nav-item relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-xs font-semibold transition"><span className="ds-mobile-nav-icon"><Icon size={19} strokeWidth={active ? 2.4 : 2} /></span><span>{label}</span></button>;
        })}
        
      </nav>

      <AnimatePresence>
        {modal === "item" && <ItemModal locations={data?.locations ?? []} allItems={data?.items ?? []} item={editing} onClose={closeModal} onSaved={async () => { closeModal(); setToast(editing ? "物品已更新" : "物品已录入"); await refresh(); }} />}
        {modal === "shopping" && <ShoppingModal onClose={closeModal} onSaved={async () => { closeModal(); setToast("已加入采购清单"); await refresh(); }} />}
        {modal === "task" && <TaskModal onClose={closeModal} onSaved={async () => { closeModal(); setToast("任务已安排"); await refresh(); }} />}
        {modal === "location" && <LocationModal location={editingLocation} locations={data?.locations ?? []} onClose={closeModal} onSaved={async () => { const wasEditing = Boolean(editingLocation); closeModal(); setToast(wasEditing ? "空间已更新" : "新空间已创建"); await refresh(); }} />}
        {modal === "notifications" && <NotificationsModal lowStock={lowStock} expiring={expiring} expired={expired} onClose={closeModal} onOpenItem={(item) => { closeModal(); openEdit(item); }} onDispose={removeItem} onShopping={() => { closeModal(); openView("items"); }} />}
        {modal === "recycle" && <RecycleBinModal onClose={closeModal} onRestored={async () => { setToast("物品已恢复"); await refresh(); }} onToast={setToast} />}
        {modal === "batch-ai" && <BatchAiImport locations={data?.locations ?? []} onClose={closeModal} onSaved={async () => { await refresh(); }} onToast={setToast} />}
        {qrItem && <QrModal item={qrItem} onClose={() => setQrItem(null)} onPrint={() => { setQrItem(null); setPrintItems([qrItem]); }} />}
        {aiItem && <AiAssistantModal item={aiItem} onClose={() => setAiItem(null)} onApplied={async (message) => { setToast(message); await refresh(); }} />}
      </AnimatePresence>
      {!chatOpen && <AssistantLauncher onOpen={() => setChatOpen(true)} />}
      {chatOpen && <AiChat onClose={() => setChatOpen(false)} />}
      {printItems && <PrintStudio items={printItems} onClose={() => setPrintItems(null)} />}
      {showWelcome && <WelcomeModal hasDemoData={data?.items.some((item) => item.itemCode?.startsWith("INV-DEMO-")) ?? false} onClose={() => { localStorage.setItem(welcomeStorageKey, "seen"); setShowWelcome(false); }} onAction={(action) => { localStorage.setItem(welcomeStorageKey, "seen"); setShowWelcome(false); if (action === "item") setModal("item"); else if (action === "location") setModal("location"); else setModal("shopping"); }} />}
      <AnimatePresence>{toast && <motion.div initial={{ opacity: 0, y: 20, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 12, x: "-50%" }} role="status" aria-live="polite" className="fixed bottom-24 left-1/2 z-[70] flex max-w-[calc(100vw-32px)] items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-2xl md:bottom-8" style={{ background: "#24242d" }}><span className="min-w-0">{toast}</span>{toastAction && <button type="button" onClick={() => void toastAction.onClick()} className="shrink-0 rounded-lg px-2 py-1 text-xs font-black" style={{ background: "rgba(255,255,255,.16)" }}>{toastAction.label}</button>}</motion.div>}</AnimatePresence>
    </div>
    </ReadOnlyContext.Provider>
  );
}

export function InventoryApp() {
  // Confirmation prompts are rendered inside the app shell so they can follow
  // the theme, the keyboard and the dialog focus rules.
  // reducedMotion="user":跟随系统的「减少动效」,Motion 只做透明度过渡,不再位移/缩放。
  return (
    <MotionConfig reducedMotion="user">
      <ConfirmProvider>
        <InventoryAppShell />
      </ConfirmProvider>
    </MotionConfig>
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
  // A launcher pinned over a long list always ends up covering one row's action
  // buttons. Slide it away while the user scrolls down and bring it back as soon
  // as they scroll up, so taps land on the list instead of on the ball.
  const [dodging, setDodging] = useState(false);

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
      setDodging(false);
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

  useEffect(() => {
    if (!mobile) return;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - lastY) < 8) return;
      setDodging(y > lastY);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mobile]);

  const mobileStyle = mobile && position ? { left: position.x, top: position.y, right: "auto", bottom: "auto", background: "var(--primary)" } : { background: "var(--primary)" };
  return <button onClick={() => { if (suppressClickRef.current) { suppressClickRef.current = false; return; } onOpen(); }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} className={`fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-[90] grid size-12 touch-none select-none place-items-center rounded-full text-[var(--on-primary)] shadow-xl transition-transform duration-200 hover:scale-105 md:bottom-5 md:right-5 md:size-14 ${dodging ? "pointer-events-none translate-x-[130%] opacity-0" : "translate-x-0 opacity-100"}`} style={mobileStyle} aria-label="打开归物助手" title="归物助手：可在手机上沿屏幕边缘拖动"><Bot size={21} /></button>;
}

