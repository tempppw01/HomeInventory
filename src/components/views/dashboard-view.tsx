"use client";

import {
  AlertTriangle, Bot, Boxes, ChevronDown, ChevronRight, CircleAlert, LayoutGrid, List, QrCode, ShoppingBasket, Sparkles, WalletCards, Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { DashboardData, Item, ShoppingItem } from "@/types";
import { isLiquidConsumable } from "@/lib/item-metrics";
import { itemAiHighlights } from "@/lib/item-ai";
import { Badge, Card } from "@/components/ui";
import { View, expiryDays, expiryDateLabel, expiryAdvice, expiryGroupLabel, PageTitle, SectionHead, EmptyState } from "../shared";
import { ItemCard } from "./items-view";
export function DashboardView({ data, now, lowStock, expiring, expired, pending, totalValue, onNavigate, onEdit, onOpenDetail, onImageUpload, onDuplicate, onConsume, onDelete, onAddRestock, onQr, onAi, onAlerts, onCreate }: { data: DashboardData; now: number; lowStock: Item[]; expiring: Item[]; expired: Item[]; pending: ShoppingItem[]; totalValue: number; onNavigate: (v: View) => void; onEdit: (i: Item) => void; onOpenDetail: (i: Item) => void; onImageUpload: (i: Item, file?: File) => void; onDuplicate: (i: Item) => void; onConsume: (i: Item) => void; onDelete: (i: Item) => void; onAddRestock: (i: Item) => void; onQr: (i: Item) => void; onAi: (i: Item) => void; onAlerts: () => void; onCreate: () => void }) {
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
  // 首屏只回答一个问题:「现在最该做什么」。按 已过期 > 快到期 > 需要补货 的顺序,
  // 挑出唯一一件最紧急的事,其余降级为次级信息。
  const focusTone = expired.length ? "danger" : expiring.length ? "warning" : lowStock.length ? "warning" : "success";
  const focusToneColor = focusTone === "danger" ? "var(--danger)" : focusTone === "warning" ? "var(--warning)" : "var(--success)";
  const focusItem = expired[0] ?? expiring[0] ?? lowStock[0] ?? null;
  const focus = data.items.length === 0
    ? { headline: "先录入家里的第一件物品", detail: "记下名称、数量和存放位置,之后就能按房间查找、自动提醒补货。", action: "录入物品", run: onCreate }
    : expired[0]
      ? { headline: `「${expired[0].name}」已经过期`, detail: `${expiryDateLabel(expired[0], now)} —— 处理掉,或者更新保质期。`, action: "处理这件", run: () => onEdit(expired[0]) }
      : expiring[0]
        ? { headline: `「${expiring[0].name}」快到期了`, detail: `${expiryDateLabel(expiring[0], now)} · 还有 ${Math.max(expiryDays(expiring[0], now), 0)} 天,先用掉它。`, action: "现在处理", run: () => onEdit(expiring[0]) }
        : lowStock[0]
          ? { headline: `「${lowStock[0].name}」需要补货`, detail: isLiquidConsumable(lowStock[0]) ? `余量只剩 ${Math.round(lowStock[0].remainingPercent)}%,低于你设的提醒线。` : `还剩 ${lowStock[0].quantity} ${lowStock[0].unit},提醒线是 ${lowStock[0].minQuantity} ${lowStock[0].unit}。`, action: "加入采购清单", run: () => onAddRestock(lowStock[0]) }
          : { headline: "今天没有需要处理的事", detail: `${data.items.length} 件物品都在保质期内,库存也够用 —— 可以趁现在做一次盘点。`, action: "盘点一次", run: () => onNavigate("audit") };
  const attentionCount = lowStock.length + expiring.length + expired.length;
  const visibleStats = stats.slice(1);
  const pendingNames = new Set(pending.map((item) => item.name.trim().toLocaleLowerCase()));
  const restockSuggestions = lowStock.filter((item) => !pendingNames.has(item.name.trim().toLocaleLowerCase())).slice(0, 3);
  const urgentExpiry = [...expired, ...expiring.filter((item) => expiryDays(item, now) <= 7)]
    .sort((a, b) => new Date(a.expiryDate!).getTime() - new Date(b.expiryDate!).getTime());
  const expiryGroups = urgentExpiry.reduce<Record<string, Item[]>>((groups, item) => {
    const key = item.expiryDate!.slice(0, 10);
    (groups[key] ||= []).push(item);
    return groups;
  }, {});
  return <>
    <PageTitle title={attentionCount ? "先处理这一件" : "今天要做什么"} text={attentionCount ? `还有 ${attentionCount} 项需要留意,下面是最紧急的一件。` : "没有待处理的事项,家里一切正常。"} />
    <section className="dashboard-overview surface rounded-[28px] p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[.14em]" style={{ color: focusToneColor }}>
            <span className="size-1.5 rounded-full" style={{ background: focusToneColor }} />
            {attentionCount ? "最需要做的事" : "当前状态"}
          </span>
          <h2 className="mb-0 mt-2.5 text-xl font-black leading-snug sm:text-2xl">{focus.headline}</h2>
          <p className="mb-0 mt-2 max-w-xl text-sm leading-6 muted">{focus.detail}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button onClick={focus.run} className="btn-primary flex items-center gap-1.5">{focus.action}<ChevronRight size={15} /></button>
          {attentionCount > 1 && focusItem && <button onClick={onAlerts} className="btn-ghost flex items-center gap-1 text-xs">全部 {attentionCount} 项<ChevronRight size={14} /></button>}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-4 text-xs" style={{ borderColor: "var(--border)" }}>
        {visibleStats.map(({ label, value, suffix, icon: Icon, color }) => <span key={label} className="flex items-center gap-1.5"><Icon size={14} style={{ color }} /><span className="muted">{label}</span><b className="font-extrabold tabular-nums">{value}{suffix}</b></span>)}
      </div>
    </section>


    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,.7fr)]">
      <section className="surface min-w-0 p-3 sm:p-4"><div className="flex items-center justify-between gap-3"><h2 className="m-0 text-base font-black">最近更新</h2><div className="flex items-center gap-2"><div className="flex rounded-xl p-1" style={{ background: "var(--surface-soft)" }}><button data-testid="recent-view-cards" onClick={() => changeRecentView("cards")} className="grid size-8 place-items-center rounded-lg" style={recentView === "cards" ? { background: "var(--surface-solid)", color: "var(--primary)", boxShadow: "0 1px 4px rgba(0,0,0,.08)" } : { color: "var(--muted)" }} aria-label="卡片显示" title="卡片显示"><LayoutGrid size={15} /></button><button data-testid="recent-view-list" onClick={() => changeRecentView("list")} className="grid size-8 place-items-center rounded-lg" style={recentView === "list" ? { background: "var(--surface-solid)", color: "var(--primary)", boxShadow: "0 1px 4px rgba(0,0,0,.08)" } : { color: "var(--muted)" }} aria-label="列表显示" title="列表显示"><List size={16} /></button></div><button onClick={() => onNavigate("items")} className="flex items-center gap-1 text-xs font-bold" style={{ color: "var(--primary)" }}>查看全部<ChevronRight size={14} /></button></div></div>{recentView === "cards" ? <div data-testid="recent-cards" className="mt-3 grid gap-3 sm:grid-cols-2">{data.items.slice(0, 6).map((item) => <ItemCard key={item.id} item={item} onEdit={() => onEdit(item)} onOpenDetail={() => onOpenDetail(item)} onImageUpload={(file) => onImageUpload(item, file)} onDuplicate={() => onDuplicate(item)} onConsume={() => onConsume(item)} onQr={() => onQr(item)} onAi={() => onAi(item)} compact />)}{data.items.length === 0 && <EmptyState icon={Boxes} title="还没有物品" text="点击右上角，录入家里的第一件物品" />}</div> : <div data-testid="recent-list" className="mt-3 space-y-1.5">{data.items.slice(0, 6).map((item) => <RecentItemRow key={item.id} item={item} onEdit={() => onEdit(item)} onQr={() => onQr(item)} onAi={() => onAi(item)} />)}{data.items.length === 0 && <EmptyState icon={Boxes} title="还没有物品" text="点击右上角，录入家里的第一件物品" />}</div>}</section>
      <div className="space-y-4">
        <details className="surface group rounded-[24px] p-4 sm:p-5">
          <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
            <span className="grid size-10 place-items-center rounded-2xl" style={{ background: "var(--surface-soft)", color: "var(--muted)" }}><WalletCards size={18} /></span>
            <span className="min-w-0 flex-1"><b className="block text-sm">家庭消费</b><span className="mt-0.5 block text-xs muted">本月支出、分类与消耗趋势</span></span>
            <span className="grid size-8 place-items-center rounded-full muted transition-transform group-open:rotate-180"><ChevronDown size={17} /></span>
          </summary>
          <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <HomeInsightsCompact data={data} />
          </div>
        </details>
        <details className="surface group rounded-[24px] p-4 sm:p-5">
          <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
            <span className="grid size-10 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><Sparkles size={18} /></span>
            <span className="min-w-0 flex-1"><b className="block text-sm">更多待处理事项</b><span className="mt-0.5 block text-xs muted">补货、到期与采购清单</span></span>
            <span className="grid size-8 place-items-center rounded-full muted transition-transform group-open:rotate-180"><ChevronDown size={17} /></span>
          </summary>
          <div className="mt-4 space-y-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            {restockSuggestions.length > 0 && <section><SectionHead title="补货建议" action="查看物品" onClick={() => onNavigate("items")} /><p className="mb-3 mt-1 text-xs muted">低库存物品可直接加入采购清单。</p><div className="space-y-1.5">{restockSuggestions.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background: "var(--surface-soft)" }}><CircleAlert size={15} style={{ color: "var(--warning)" }} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{item.name}</div><div className="text-xs muted">{isLiquidConsumable(item) ? `余量 ${Math.round(item.remainingPercent)}%` : `建议补 ${Math.max(item.minQuantity - item.quantity, 1)} ${item.unit}`}</div></div><button type="button" onClick={() => onAddRestock(item)} className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs" style={{ color: "var(--primary)" }}>加入</button></div>)}</div></section>}
            {urgentExpiry.length > 0 && <section><SectionHead title="本周到期" action="查看提醒" onClick={onAlerts} /><div className="mt-3 space-y-3">{Object.entries(expiryGroups).map(([date, items]) => <div key={date}><div className="mb-1.5 flex items-center gap-2 text-xs font-bold muted"><span className="size-1.5 rounded-full" style={{ background: date < new Date().toISOString().slice(0, 10) ? "var(--danger)" : "var(--warning)" }} />{expiryGroupLabel(date, now)}</div><div className="space-y-1.5">{items.map((item) => { const isExpired = expired.some((entry) => entry.id === item.id); return <div key={item.id} className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background: "var(--surface-soft)" }}><AlertTriangle size={15} style={{ color: isExpired ? "var(--danger)" : "var(--warning)" }} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{item.name}</div><div className="text-xs muted">{expiryDateLabel(item, now)} · {expiryAdvice(item)}</div></div><button type="button" onClick={() => isExpired ? onDelete(item) : onEdit(item)} className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs" style={{ color: isExpired ? "var(--danger)" : "var(--primary)" }}>{isExpired ? "处理" : "查看"}</button></div>; })}</div></div>)}</div></section>}
            <section><SectionHead title={`采购清单 · ${pending.length}`} action="打开清单" onClick={() => onNavigate("items")} /><div className="mt-3 space-y-2">{pending.slice(0, 3).map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "var(--surface-soft)" }}><span className="size-2 rounded-full" style={{ background: item.priority === 2 ? "var(--danger)" : "var(--warning)" }} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{item.name}</div><div className="mt-0.5 text-xs muted">{item.quantity} {item.unit} · {item.category || "未分类"}</div></div></div>)}{pending.length === 0 && <p className="mb-0 text-sm muted">清单已完成，暂时没有需要采购的物品。</p>}</div></section>
          </div>
        </details>
      </div>
    </div>
  </>;
}

export function RecentItemRow({ item, onEdit, onQr, onAi }: { item: Item; onEdit: () => void; onQr: () => void; onAi: () => void }) {
  const ai = itemAiHighlights(item);
  const emoji = ({ 食品: "🍚", 饮品: "🥛", 清洁: "🧴", 家电: "📺", 数码: "💻", 衣物: "👕", 医药: "💊", 户外: "⛺" } as Record<string, string>)[item.category] || "📦";
  return <button onClick={onEdit} className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--surface-soft)]" style={{ background: "var(--surface-soft)" }}><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-cover bg-center text-base" style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : { background: "var(--surface-solid)" }}>{!item.imageUrl && emoji}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="truncate text-sm font-extrabold">{item.name}</span>{ai.hasHighlights && <Sparkles size={12} style={{ color: "var(--primary)" }} />}</div><div className="mt-0.5 truncate text-xs muted">{item.location?.name || "未设置位置"} · {item.category}{ai.summary ? ` · ${ai.summary}` : ai.storage ? ` · ${ai.storage}` : ""}</div></div><div className="flex shrink-0 items-center gap-1.5"><div className="text-right text-sm font-black">{item.quantity}<span className="ml-1 text-xs font-normal muted">{item.unit}</span></div><div className="flex gap-0.5 opacity-60 transition group-hover:opacity-100"><span onClick={(event) => { event.stopPropagation(); onAi(); }} className="grid size-6 place-items-center rounded-md hover:bg-[var(--surface-solid)]" aria-label="AI 物品助手"><Bot size={12} /></span><span onClick={(event) => { event.stopPropagation(); onQr(); }} className="grid size-6 place-items-center rounded-md hover:bg-[var(--surface-solid)]" aria-label="显示二维码"><QrCode size={12} /></span></div></div></button>;
}

export function HomeInsightsCompact({ data }: { data: DashboardData }) {
  if (data.finance.currentMonthTotal <= 0 && data.finance.averageMonthly <= 0 && !data.finance.recent[0] && data.finance.byCategory.length === 0 && data.consumption.length === 0) return null;
  return <Card padding="default">
    <div className="flex items-center gap-2 text-sm font-bold"><WalletCards size={16} style={{ color: "var(--primary)" }} />家庭消费</div>
    <div className="mt-4 grid grid-cols-2 gap-4">
      <div><div className="text-xs muted">本月</div><div className="mt-1 text-2xl font-black tracking-tight">¥{data.finance.currentMonthTotal.toFixed(0)}</div></div>
      <div><div className="text-xs muted">近 6 月均值</div><div className="mt-1 text-2xl font-black tracking-tight">¥{data.finance.averageMonthly.toFixed(0)}</div></div>
    </div>
    {(data.finance.byCategory.length > 0 || data.consumption.length > 0 || data.finance.recent[0]) && <details className="group mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold muted [&::-webkit-details-marker]:hidden">查看消费详情<ChevronDown size={15} className="transition-transform group-open:rotate-180" /></summary>
      {data.finance.byCategory.length > 0 && <div className="mt-3"><div className="mb-2 text-xs font-bold muted">本月消费分类</div><div className="flex flex-wrap gap-2">{data.finance.byCategory.map((entry) => <Badge key={entry.category} tone="primary">{entry.category} ¥{entry.total.toFixed(0)}</Badge>)}</div></div>}
      {data.consumption.length > 0 && <div className="mt-3"><div className="mb-2 text-xs font-bold muted">最近消耗较多</div><div className="space-y-1.5">{data.consumption.slice(0, 3).map((entry) => <div key={entry.itemName} className="flex items-center justify-between gap-2 text-xs"><span className="min-w-0 truncate">{entry.itemName}</span><span className="shrink-0 font-bold muted">{entry.count} 次</span></div>)}</div></div>}
      {data.finance.recent[0] && <div className="mt-3 truncate text-xs muted">最近记录：{data.finance.recent[0].itemName} · ¥{data.finance.recent[0].totalPrice.toFixed(2)}</div>}
    </details>}
  </Card>;
}

