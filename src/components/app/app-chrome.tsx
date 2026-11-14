"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Bell, Bot, Info, Monitor, Moon, PanelLeftClose, Plus, Settings, Sun, Trash2 } from "lucide-react";
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Item } from "@/types";

import { PageShell } from "@/components/ui";
import { Brand, LoadingView, assistantPositionStorageKey, mobileNavItems, navItems, type AssistantPosition } from "@/components/shared";
import { useApp } from "@/components/app/app-provider";
import { pathForView } from "@/components/app/routes";
import { APP_VERSION } from "@/lib/version";

import { RecycleBinModal } from "@/components/recycle-bin-modal";
import { AiChat } from "@/components/ai-chat";
import { AiAssistantModal } from "@/components/ai-assistant-modal";
import { PrintStudio } from "@/components/print-studio";
import { SearchBox } from "@/components/search-box";
import { BatchAiImport } from "@/components/batch-ai-import";
import { useModalFocusManagement } from "@/lib/dialog-focus";
import { NotificationsModal, WelcomeModal, QrModal, ShoppingModal, LocationModal } from "@/components/views/modals";
import { DashboardView } from "@/components/views/dashboard-view";
import { ItemsView } from "@/components/views/items-view";
import { LocationsView } from "@/components/views/locations-view";
import { TasksView, TaskModal } from "@/components/views/tasks-view";
import { AuditView } from "@/components/views/audit-view";
import { SettingsView } from "@/components/views/settings-view";
import { AboutView } from "@/components/views/about-view";
import { ItemModal } from "@/components/views/item-modal";

/**
 * 应用外壳:桌面侧栏 / 顶栏 / 移动底部导航 / toast / 助手悬浮球 + 全部全局弹窗。
 *
 * 这里不含任何状态,所有数据与动作都来自 useApp();一级导航是 <Link>,
 * 当前项由 usePathname() 推导,因此 data-active / aria-current 仍然准确。
 */
export function AppChrome({ children }: { children?: React.ReactNode }) {
  const app = useApp();
  const {
    data, loading, refresh, view, openView, beginNavigation, search, setSearch,
    typeFilter, categoryFilter, changeTypeFilter, changeCategoryFilter, filteredItems,
    readOnly, lowStock, pendingShopping, tasks, expiring, expired, totalValue, now,
    theme, cycleTheme, setThemeMode, density, motionMode, setDensity, setMotionMode,
    sidebarCollapsed, toggleSidebar, modal, setModal, editing, editingLocation, setEditingLocation, closeModal,
    qrItem, setQrItem, aiItem, setAiItem, printItems, setPrintItems, chatOpen, setChatOpen,
    showWelcome, dismissWelcome, toast, toastAction, setToast,
    openEdit, openDetail, uploadItemImage, duplicateItem, copyText, removeShopping, consume,
    updateRemaining, removeItem, addRestockSuggestion, toggleShopping, toggleFavoriteShopping,
    toggleTask, deleteTask,
  } = app;

  // Keeps keyboard focus inside whichever modal is open, returns it to the
  // trigger on close, and stops the page behind from scrolling.
  useModalFocusManagement();

  return (
    <div className={`min-h-screen md:grid ${sidebarCollapsed ? "md:grid-cols-[76px_minmax(0,1fr)]" : "md:grid-cols-[232px_minmax(0,1fr)]"}`}>
      <aside className={`desktop-only sticky top-0 h-screen border-r px-3 py-5 transition-[width] duration-200 ${sidebarCollapsed ? "items-center" : ""}`} style={{ borderColor: "var(--border)", background: "var(--surface)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}>
        <button onClick={toggleSidebar} className={`flex w-full items-center rounded-xl p-1 text-left transition hover:bg-[var(--surface-soft)] ${sidebarCollapsed ? "justify-center" : "justify-between gap-2"}`} aria-label={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"} title={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}>
          <Brand compact={sidebarCollapsed} />
          {!sidebarCollapsed && <span className="grid size-8 shrink-0 place-items-center rounded-lg muted"><span className="sr-only">折叠侧栏</span><PanelLeftClose size={17} /></span>}
        </button>
        <nav className="mt-9 space-y-1.5">
          {navItems.map(({ id, label, icon: Icon }) => (
            <Link key={id} href={pathForView(id)} onClick={beginNavigation} className={`ds-nav-item flex w-full items-center rounded-xl py-3 text-sm font-semibold ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3"}`}
              aria-label={label} aria-current={view === id ? "page" : undefined} title={sidebarCollapsed ? label : undefined}
              data-active={view === id} data-compact={sidebarCollapsed}>
              <Icon size={19} strokeWidth={2.2} /> {!sidebarCollapsed && label}
            </Link>
          ))}
        </nav>
        <div className={`absolute bottom-5 ${sidebarCollapsed ? "left-3 right-3" : "left-4 right-4"}`}>
          <Link href={pathForView("settings")} onClick={beginNavigation} className={`ds-nav-item flex w-full items-center rounded-xl min-h-10 py-2.5 text-sm font-semibold ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3"}`} data-active={view === "settings"} data-compact={sidebarCollapsed} aria-label="设置" title={sidebarCollapsed ? "设置" : undefined}>
            <Settings size={19} /> {!sidebarCollapsed && "设置"}
          </Link>
          <button onClick={() => setModal("recycle")} className={`flex w-full items-center rounded-xl min-h-10 py-2.5 text-sm font-semibold muted hover:bg-[var(--surface-soft)] ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3"}`} aria-label="回收站" title={sidebarCollapsed ? "回收站" : undefined}><Trash2 size={19} />{!sidebarCollapsed && "回收站"}</button>
          <Link href={pathForView("about")} onClick={beginNavigation} className={`ds-nav-item flex w-full items-center rounded-xl min-h-10 py-2.5 text-sm font-semibold ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3"}`} data-active={view === "about"} data-compact={sidebarCollapsed} aria-label="关于" title={sidebarCollapsed ? `关于 v${APP_VERSION}` : undefined}><Info size={19} />{!sidebarCollapsed && <>关于 <span className="ml-auto text-xs">v{APP_VERSION}</span></>}</Link>
        </div>
      </aside>

      <PageShell className="min-w-0">
        <header className="mobile-topbar mb-5 flex items-center gap-2.5 border-b pb-4 md:gap-2 md:pb-3">
          <div className="mobile-only"><Brand compact /></div>
          <div className="desktop-only max-w-md flex-1">
            <SearchBox items={data?.items ?? []} value={search} onChange={setSearch} onSelect={(item: Item) => { setSearch(item.name); openView("items"); }} onFocus={() => openView("items")} placeholder="搜索名称、编号、分类或位置..." />
          </div>
          <button onClick={cycleTheme} className="btn-ghost grid size-10 min-h-10 place-items-center p-0 md:size-9 md:min-h-9" aria-label={`当前主题:${theme === "system" ? "跟随系统" : theme === "light" ? "浅色" : "深色"}`} title="切换主题">{theme === "system" ? <Monitor size={18} /> : theme === "light" ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button onClick={() => setModal("notifications")} className="btn-ghost relative grid size-10 min-h-10 place-items-center p-0 md:size-9 md:min-h-9" aria-label="查看提醒"><Bell size={18} />{lowStock.length + expiring.length + expired.length > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full" style={{ background: "var(--danger)" }} />}</button>
          <button onClick={() => setChatOpen(true)} className="btn-ghost flex size-10 min-h-10 items-center justify-center gap-2 whitespace-nowrap p-0 md:h-9 md:w-auto md:px-3 md:min-h-9" aria-label="打开归物助手" title="归物助手"><Bot size={18} /><span className="hidden min-[1100px]:inline">AI 助手</span></button>{!readOnly && <button onClick={() => setModal("item")} aria-label="录入物品" title="录入物品" className="btn-primary flex h-10 min-h-10 items-center gap-1.5 whitespace-nowrap py-0 px-3 md:h-9 md:px-3 md:min-h-9"><Plus size={18} /><span className="hidden min-[1100px]:inline">录入物品</span></button>}
        </header>

        <AnimatePresence mode="wait">
          <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .22 }}>
            {children}
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
          // 这里刻意保留 <button> + openView():验收套件用
          // `nav[aria-label="移动端主导航"] button:has-text("设置")` 定位底栏,
          // 换成 <a> 会让 CSS 类型选择器失配;openView 内部走 router.push,
          // URL 与浏览器前进/后退同样是真路由。
          return <button key={id} type="button" onClick={() => openView(id)} aria-current={active ? "page" : undefined} data-active={active} className="ds-mobile-nav-item relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-xs font-semibold transition"><span className="ds-mobile-nav-icon"><Icon size={19} strokeWidth={active ? 2.4 : 2} /></span><span>{label}</span></button>;
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
      {showWelcome && <WelcomeModal hasDemoData={data?.items.some((item) => item.itemCode?.startsWith("INV-DEMO-")) ?? false} onClose={() => dismissWelcome()} onAction={(action) => dismissWelcome(action)} />}
      <AnimatePresence>{toast && <motion.div initial={{ opacity: 0, y: 20, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 12, x: "-50%" }} role="status" aria-live="polite" className="fixed bottom-24 left-1/2 z-[70] flex max-w-[calc(100vw-32px)] items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-2xl md:bottom-8" style={{ background: "#24242d" }}><span className="min-w-0">{toast}</span>{toastAction && <button type="button" onClick={() => void toastAction.onClick()} className="shrink-0 rounded-lg px-2 py-1 text-xs font-black" style={{ background: "rgba(255,255,255,.16)" }}>{toastAction.label}</button>}</motion.div>}</AnimatePresence>
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
  return <button onClick={() => { if (suppressClickRef.current) { suppressClickRef.current = false; return; } onOpen(); }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} className={`fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-[90] grid size-12 touch-none select-none place-items-center rounded-full text-[var(--on-primary)] shadow-xl transition-transform duration-200 hover:scale-105 md:bottom-5 md:right-5 md:size-14 ${dodging ? "pointer-events-none translate-x-[130%] opacity-0" : "translate-x-0 opacity-100"}`} style={mobileStyle} aria-label="打开归物助手" title="归物助手:可在手机上沿屏幕边缘拖动"><Bot size={21} /></button>;
}
