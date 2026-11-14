"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardData, HouseholdTask, Item, Location, ShoppingItem } from "@/types";

import { useConfirm } from "@/components/confirm-dialog";
import { ReadOnlyContext, View, ThemeMode, ItemQuickFilter, compressImage, returnStateKey, readReturnState, welcomeStorageKey, legacyWelcomeStorageKeys, normalizedItemName, expiryDays, request } from "@/components/shared";
import { pathForTarget, pathForView, viewForPath } from "@/components/app/routes";
import { isCountUnit, isLiquidConsumable } from "@/lib/item-metrics";
import { isMedicineCategory } from "@/lib/categories";

export type ModalKind = "item" | "shopping" | "location" | "task" | "notifications" | "recycle" | "batch-ai" | null;
export type Role = "ADMIN" | "MEMBER" | "VIEWER" | null;
export type Density = "comfortable" | "compact";
export type MotionMode = "standard" | "reduced";
export type ToastAction = { label: string; onClick: () => void } | null;

/**
 * 应用状态与动作的唯一来源。
 *
 * 这里原来整块长在 InventoryAppShell 里(549 行的文件里,状态、网络、外壳、
 * 弹窗全混在一起)。拆出来之后:
 * - provider 负责数据、过滤、主题、弹窗开关与所有 mutation;
 * - chrome 只负责渲染外壳与弹窗;
 * - 视图的切换交给 URL(usePathname),不再有 "view" state 这个第二事实来源。
 */
function useAppState() {
  const router = useRouter();
  const pathname = usePathname();
  const view = viewForPath(pathname);
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  const [data, setData] = useState<DashboardData | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemQuickFilter>("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [modal, setModal] = useState<ModalKind>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [qrItem, setQrItem] = useState<Item | null>(null);
  const [printItems, setPrintItems] = useState<Item[] | null>(null);
  const [aiItem, setAiItem] = useState<Item | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastAction, setToastAction] = useState<ToastAction>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [showWelcome, setShowWelcome] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // 默认折叠:首屏把注意力留给内容;用户手动切换过之后会记住自己的选择。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [density, setDensity] = useState<Density>(() => typeof window !== "undefined" && localStorage.getItem("home-inventory-density") === "compact" ? "compact" : "comfortable");
  const [motionMode, setMotionMode] = useState<MotionMode>(() => typeof window !== "undefined" && localStorage.getItem("home-inventory-motion") === "reduced" ? "reduced" : "standard");
  const [now, setNow] = useState(() => Date.now());
  const [role, setRole] = useState<Role>(null);
  const readOnly = role === "VIEWER";

  useEffect(() => {
    let active = true;
    request<{ user?: { role?: "ADMIN" | "MEMBER" | "VIEWER" } | null }>("/api/auth/session")
      .then((result) => { if (active) setRole(result?.user?.role ?? null); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

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

  // Real navigation now happens through the URL. The shell still fires the same
  // progress events and reuses the recent snapshot, so switching tabs feels the
  // way it did when it was a state write.
  const beginNavigation = useCallback(() => {
    window.dispatchEvent(new CustomEvent("home-inventory:progress", { detail: "start" }));
    void ensureFresh();
    window.requestAnimationFrame(() => window.setTimeout(() => window.dispatchEvent(new CustomEvent("home-inventory:progress", { detail: "done" })), 200));
  }, [ensureFresh]);
  const openView = useCallback((target: View | string) => {
    beginNavigation();
    router.push(pathForTarget(target));
  }, [beginNavigation, router]);

  const changeTypeFilter = useCallback((nextFilter: ItemQuickFilter) => {
    setTypeFilter(nextFilter);
    // 类型切换后重置分类,避免从“医药”切回“全部”时仍被旧分类条件卡住。
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

  // 从 /items/[id] 返回时恢复离开前的视图、搜索与筛选:视图现在靠 URL 还原,
  // 其余条件仍走同一份 sessionStorage 快照。
  useEffect(() => {
    const saved = readReturnState();
    if (!saved.view && !saved.search) return;
    const frame = requestAnimationFrame(() => {
      if (saved.view) {
        const href = pathForView(saved.view);
        if (href !== pathnameRef.current) router.replace(href);
      }
      if (typeof saved.search === "string") setSearch(saved.search);
      if (saved.typeFilter) setTypeFilter(saved.typeFilter);
      if (typeof saved.categoryFilter === "string") setCategoryFilter(saved.categoryFilter);
    });
    return () => cancelAnimationFrame(frame);
  }, [router]);

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

  const toggleTask = async (task: HouseholdTask) => { try { setToastAction(null); const previousDueAt = task.dueAt; await request("/api/tasks", { method: "PATCH", body: JSON.stringify({ id: task.id, action: "toggle" }) }); setToast(task.recurrence === "NONE" ? "任务已完成" : "已完成,本次任务已顺延"); setToastAction({ label: "撤销", onClick: async () => { try { await request("/api/tasks", { method: "PATCH", body: JSON.stringify({ id: task.id, action: "undo", previousDueAt }) }); setToastAction(null); setToast("任务已恢复为待办"); await refresh(); } catch (error) { setToast(error instanceof Error ? error.message : "撤销失败"); } } }); await refresh(); } catch (error) { setToast(error instanceof Error ? error.message : "更新任务失败"); } };
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
        name: `${item.name}(副本)`, category: item.category, type: item.type,
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
  const copyText = async (value: string, message: string) => { try { await navigator.clipboard.writeText(value); setToast(message); } catch { setToast("复制失败,请手动复制"); } };
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
      setToast(`${item.name} 已使用 1 ${item.unit}${result.item.quantity === 0 ? ",已从物品列表隐藏" : ""}`);
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
    if (!(await askConfirm(`确定将“${item.name}”移入回收站吗?`, { title: "移入回收站", confirmLabel: "移入回收站" }))) return;
    await request(`/api/items/${item.id}`, { method: "DELETE", body: JSON.stringify({ memberId }) }); setToast("物品已移入回收站,可在回收站恢复"); await refresh();
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
      if (matches.length === 1 && await askConfirm(`“${item.name}”已买到。要同时补货到原物品吗?`, { title: "同时补货", confirmLabel: "补货到原物品" })) replenishItemId = matches[0].id;
    }
    await request(`/api/shopping/${item.id}`, { method: "PATCH", body: JSON.stringify({ status, replenishItemId }) });
    setToast(replenishItemId ? "采购已完成,并已补货到物品" : status === "PURCHASED" ? "采购项已完成" : "已恢复为待采购");
    await refresh();
  };
  const toggleFavoriteShopping = async (item: ShoppingItem) => {
    await request(`/api/shopping/${item.id}`, { method: "PATCH", body: JSON.stringify({ isFavorite: !item.isFavorite }) });
    setToast(item.isFavorite ? "已取消常买标记" : "已加入常买清单");
    await refresh();
  };

  const dismissWelcome = useCallback((action?: "item" | "location" | "shopping") => {
    localStorage.setItem(welcomeStorageKey, "seen");
    setShowWelcome(false);
    if (action === "item") setModal("item");
    else if (action === "location") setModal("location");
    else if (action === "shopping") setModal("shopping");
  }, []);

  return {
    data, loading, refresh, ensureFresh,
    view, pathname, openView, beginNavigation,
    search, setSearch, typeFilter, categoryFilter, changeTypeFilter, changeCategoryFilter, filteredItems,
    readOnly, role, lowStock, pendingShopping, tasks, expiring, expired, totalValue, now,
    theme, setThemeMode, cycleTheme, density, setDensity, motionMode, setMotionMode,
    sidebarCollapsed, toggleSidebar,
    modal, setModal, editing, setEditing, editingLocation, setEditingLocation, closeModal,
    qrItem, setQrItem, aiItem, setAiItem, printItems, setPrintItems,
    chatOpen, setChatOpen, showWelcome, dismissWelcome,
    toast, toastAction, setToast,
    openEdit, openDetail, uploadItemImage, duplicateItem, copyText, removeShopping, consume,
    updateRemaining, removeItem, addRestockSuggestion, toggleShopping, toggleFavoriteShopping,
    toggleTask, deleteTask,
  };
}

export type AppContextValue = ReturnType<typeof useAppState>;

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const value = useAppState();
  return (
    <AppContext.Provider value={value}>
      <ReadOnlyContext.Provider value={value.readOnly}>{children}</ReadOnlyContext.Provider>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp 必须在 AppProvider 内部使用");
  return value;
}
