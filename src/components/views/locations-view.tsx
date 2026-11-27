"use client";

import { motion } from "motion/react";
import {
  ChevronRight, MapPin, Package, Plus, Copy, Pencil, ExternalLink, Trash2,
} from "lucide-react";
import { useContext, useState } from "react";
import type { Item, Location } from "@/types";
import { ContextMenu, useContextMenu, ContextMenuItem } from "@/components/context-menu";
import { useConfirm } from "@/components/confirm-dialog";
import { Empty, Panel, Screen, Toolbar } from "@/components/ui-kit";
import { ReadOnlyContext, ExpiryWindowContext, iconMap, locationPath } from "../shared";
import { spaceSummary, spaceSummaryText, spaceAlert, spaceDeletePrompt } from "@/lib/space-summary";
import { locationSubtreeIds } from "@/lib/location-tree";

export function LocationsView({ locations, items, onAdd, onOpen, onEdit, onToast, onRefresh }: { locations: Location[]; items: Item[]; onAdd: () => void; onOpen: (name: string, id: string) => void; onEdit: (location: Location) => void; onToast: (message: string) => void; onRefresh: () => Promise<void> }) {
  const [selectedLocationId, setSelectedLocationId] = useState("ALL");
  const visibleLocations = selectedLocationId === "ALL" ? locations : locations.filter((location) => location.id === selectedLocationId);
  const readOnly = useContext(ReadOnlyContext);
  // 导轨上的数与卡片上的数必须是同一个数,而且**要等于点进去看到的件数**:
  // 点卡片会用「含下级空间」的范围筛物品页,所以这里也含下级空间。
  // 实测(2026-11-27):此前只数直接放在这一层的,于是「厨房 1」点进去是 2 件。
  const countIn = (locationId: string) => {
    const scope = locationSubtreeIds(locations, locationId);
    return items.filter((item) => item.locationId !== null && scope.has(item.locationId)).length;
  };
  return (
    <Screen
      title="家庭空间"
      description="按房间和收纳位置快速找到物品。"
      actions={!readOnly ? <button onClick={onAdd} className="btn-primary flex min-h-11 items-center gap-2" aria-label="添加空间"><Plus size={18} /><span className="desktop-only">添加空间</span></button> : null}
    >
      <div className="browse-layout">
        <nav className="browse-rail" aria-label="空间索引">
          <button type="button" className="browse-rail-item min-h-10 max-md:min-h-11" data-active={selectedLocationId === "ALL"} onClick={() => setSelectedLocationId("ALL")}>
            <span>全部空间</span>
            <span className="browse-rail-count">{locations.length}</span>
          </button>
          {locations.map((location) => (
            <button key={location.id} type="button" className="browse-rail-item min-h-10 max-md:min-h-11" data-active={selectedLocationId === location.id} onClick={() => setSelectedLocationId(location.id)}>
              <span className="truncate">{locationPath(location, locations)}</span>
              <span className="browse-rail-count">{countIn(location.id)}</span>
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          <Toolbar className="mb-4 justify-between">
            <span className="block m-0 min-w-0 text-xs leading-5 muted">{selectedLocationId === "ALL" ? "选择一个空间,快速浏览其中的物品。" : "点击空间卡片可直接查看其中的物品。"}</span>
            <span className="shrink-0 text-xs font-bold muted">共 {visibleLocations.length} 个空间</span>
          </Toolbar>
          {visibleLocations.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleLocations.map((location, index) => (
                <LocationCard key={location.id} location={location} locations={locations} items={items} index={index} onOpen={onOpen} onEdit={onEdit} onToast={onToast} onRefresh={onRefresh} />
              ))}
            </div>
          ) : (
            <Panel padded={false}>
              <Empty
                icon={MapPin}
                title="还没有空间"
                text="先添加一个房间或收纳位置吧"
                action={!readOnly ? <button onClick={onAdd} className="btn-primary min-h-11 px-4">添加第一个空间</button> : undefined}
              />
            </Panel>
          )}
        </div>
      </div>
    </Screen>
  );
}

export function LocationCard({ location, locations, items, index, onOpen, onEdit, onToast, onRefresh }: { location: Location; locations: Location[]; items: Item[]; index: number; onOpen: (name: string, id: string) => void; onEdit: (location: Location) => void; onToast: (message: string) => void; onRefresh: () => Promise<void> }) {
  const askConfirm = useConfirm();
  const Icon = iconMap[location.icon as keyof typeof iconMap] || Package;
  // 临期窗口跟用户设置走(与概览/提醒中心/物品卡同一个数):此前空间卡写死 7 天,
  // 用户把「保质期提前」设成 30 天,卡片上的「N 件临期」也不变。
  const expiryWindowDays = useContext(ExpiryWindowContext);
  // 状态角标的数据属性,便于测试与读屏以外的视觉提示
  const parent = location.parentId ? locations.find((entry) => entry.id === location.parentId) : null;
  // 这个空间的状态:件数、需冷藏、临期、价值、该补货 —— 一眼看出要不要去整理。
  // 「N 件」= 这个空间**和它下面所有空间**里的物品 —— 与点卡片进物品页看到的件数一致。
  // 卡片自己写着「点击空间卡片可直接查看其中的物品」,那就不能让卡片和它引导你去的地方各说一个数。
  const subtree = [...locationSubtreeIds(locations, location.id)];
  const childSpaces = locations.filter((entry) => entry.parentId === location.id).length;
  const summary = spaceSummary(items.map((item) => ({
    locationId: item.locationId, type: item.type, quantity: item.quantity, price: item.price,
    expiryDate: item.expiryDate, storage: item.storage ?? null, minQuantity: item.minQuantity,
    name: item.name, category: item.category, unit: item.unit,
    remainingPercent: item.remainingPercent, restockPausedUntil: item.restockPausedUntil ?? null,
  })), subtree, undefined, expiryWindowDays);
  const summaryText = spaceSummaryText(summary, childSpaces);
  const alert = spaceAlert(summary);
  const context = useContextMenu();
  const remove = async () => {
    // 文案逻辑抽到 space-summary.ts 里(纯函数、可单测):
    // 里面有物品时**不再问「确定吗」**,直接说明「还有 N 件,先移走」,并且不发删除请求;
    // 可以删时,把「下级空间会变成顶级」这条后果也说清楚。
    // 挡住删除的是**直接放在这一层**的物品(服务端就是按 locationId = 本空间 数的),
    // 而卡片上的件数现在含下级空间 —— spaceDeletePrompt 会把这句差别说出来。
    const itemCount = items.filter((item) => item.locationId === location.id).length;
    const prompt = spaceDeletePrompt(location.name, itemCount, childSpaces);
    if (prompt) {
      const agreed = await askConfirm(prompt.message, { title: prompt.title, confirmLabel: prompt.confirmLabel, cancelLabel: prompt.cancelLabel, tone: prompt.blocked ? "primary" : "danger" });
      if (prompt.blocked || !agreed) return;
    } try { const response = await fetch(`/api/locations/${location.id}`, { method: "DELETE" }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "删除失败"); onToast("空间已删除"); onRefresh(); } catch (error) { onToast(error instanceof Error ? error.message : "删除失败"); } };
  const contextItems: ContextMenuItem[] = [{ label: "打开空间", icon: ExternalLink, onClick: () => onOpen(location.name, location.id) }, { label: "编辑空间", icon: Pencil, onClick: () => onEdit(location) }, { label: "复制空间名称", icon: Copy, onClick: async () => { try { await navigator.clipboard.writeText(location.name); onToast("空间名称已复制"); } catch { onToast("复制失败"); } } }, { label: "删除空间", icon: Trash2, danger: true, separatorBefore: true, onClick: remove }];
  return <><motion.button onContextMenu={context.onContextMenu} initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * .05 }} onClick={() => onOpen(location.name, location.id)} className="surface group relative min-w-0 overflow-hidden p-4 text-left transition hover:border-[color-mix(in_srgb,var(--primary)_38%,var(--border))]"><div className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20" style={location.thumbnailUrl ? { backgroundImage: `url(${location.thumbnailUrl})` } : undefined} /><div className="relative"><div className="mb-4 flex items-start justify-between gap-3"><div className="grid size-12 shrink-0 place-items-center rounded-2xl" style={{ color: location.color, background: `color-mix(in srgb, ${location.color} 12%, var(--surface-solid))` }}><Icon size={23} /></div><ChevronRight className="mt-1 shrink-0 muted transition group-hover:translate-x-0.5" size={18} /></div><span className="block m-0 truncate text-lg font-black">{location.name}</span><span className="block mb-0 mt-1 truncate text-xs muted">{parent ? locationPath(location, locations) : "顶层空间"}</span><span className="mb-0 mt-1.5 flex items-center gap-1.5 text-sm muted">
  {alert && <span className="size-1.5 shrink-0 rounded-full" aria-hidden data-space-alert={alert} style={{ background: alert === "danger" ? "var(--danger)" : "var(--warning)" }} />}
  <span className="min-w-0 truncate">{summaryText}</span>
</span></div></motion.button><ContextMenu menu={context.menu} items={contextItems} onClose={context.close} /></>;
}
