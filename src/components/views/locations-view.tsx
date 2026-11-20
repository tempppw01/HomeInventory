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
import { ReadOnlyContext, iconMap, locationPath } from "../shared";
import { spaceSummary, spaceSummaryText, spaceAlert } from "@/lib/space-summary";

export function LocationsView({ locations, items, onAdd, onOpen, onEdit, onToast, onRefresh }: { locations: Location[]; items: Item[]; onAdd: () => void; onOpen: (name: string, id: string) => void; onEdit: (location: Location) => void; onToast: (message: string) => void; onRefresh: () => Promise<void> }) {
  const [selectedLocationId, setSelectedLocationId] = useState("ALL");
  const visibleLocations = selectedLocationId === "ALL" ? locations : locations.filter((location) => location.id === selectedLocationId);
  const readOnly = useContext(ReadOnlyContext);
  const countIn = (locationId: string) => items.filter((item) => item.locationId === locationId).length;
  return (
    <Screen
      title="家庭空间"
      description="按房间和收纳位置快速找到物品。"
      actions={!readOnly ? <button onClick={onAdd} className="btn-primary flex min-h-11 items-center gap-2"><Plus size={18} /><span className="desktop-only">添加空间</span></button> : null}
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
  // 状态角标的数据属性,便于测试与读屏以外的视觉提示
  const parent = location.parentId ? locations.find((entry) => entry.id === location.parentId) : null;
  // 这个空间的状态:件数、需冷藏、临期、价值、该补货 —— 一眼看出要不要去整理。
  const summary = spaceSummary(items.map((item) => ({
    locationId: item.locationId, type: item.type, quantity: item.quantity, price: item.price,
    expiryDate: item.expiryDate, storage: item.storage ?? null, minQuantity: item.minQuantity,
    name: item.name, category: item.category, unit: item.unit,
    remainingPercent: item.remainingPercent, restockPausedUntil: item.restockPausedUntil ?? null,
  })), location.id);
  const summaryText = spaceSummaryText(summary);
  const alert = spaceAlert(summary);
  const context = useContextMenu();
  const remove = async () => { if (!(await askConfirm(`确定删除空间“${location.name}”?`, { title: "删除空间", confirmLabel: "确认删除", tone: "danger" }))) return; try { const response = await fetch(`/api/locations/${location.id}`, { method: "DELETE" }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "删除失败"); onToast("空间已删除"); onRefresh(); } catch (error) { onToast(error instanceof Error ? error.message : "删除失败"); } };
  const contextItems: ContextMenuItem[] = [{ label: "打开空间", icon: ExternalLink, onClick: () => onOpen(location.name, location.id) }, { label: "编辑空间", icon: Pencil, onClick: () => onEdit(location) }, { label: "复制空间名称", icon: Copy, onClick: async () => { try { await navigator.clipboard.writeText(location.name); onToast("空间名称已复制"); } catch { onToast("复制失败"); } } }, { label: "删除空间", icon: Trash2, danger: true, separatorBefore: true, onClick: remove }];
  return <><motion.button onContextMenu={context.onContextMenu} initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * .05 }} onClick={() => onOpen(location.name, location.id)} className="surface group relative min-w-0 overflow-hidden p-4 text-left transition hover:border-[color-mix(in_srgb,var(--primary)_38%,var(--border))]"><div className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20" style={location.thumbnailUrl ? { backgroundImage: `url(${location.thumbnailUrl})` } : undefined} /><div className="relative"><div className="mb-4 flex items-start justify-between gap-3"><div className="grid size-12 shrink-0 place-items-center rounded-2xl" style={{ color: location.color, background: `color-mix(in srgb, ${location.color} 12%, var(--surface-solid))` }}><Icon size={23} /></div><ChevronRight className="mt-1 shrink-0 muted transition group-hover:translate-x-0.5" size={18} /></div><span className="block m-0 truncate text-lg font-black">{location.name}</span><span className="block mb-0 mt-1 truncate text-xs muted">{parent ? locationPath(location, locations) : "顶层空间"}</span><span className="mb-0 mt-1.5 flex items-center gap-1.5 text-sm muted">
  {alert && <span className="size-1.5 shrink-0 rounded-full" aria-hidden data-space-alert={alert} style={{ background: alert === "danger" ? "var(--danger)" : "var(--warning)" }} />}
  <span className="min-w-0 truncate">{summaryText}</span>
</span></div></motion.button><ContextMenu menu={context.menu} items={contextItems} onClose={context.close} /></>;
}
