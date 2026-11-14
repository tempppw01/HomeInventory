"use client";

import {
  AlertTriangle, Bot, Boxes, ChevronDown, ChevronRight, CircleAlert, LayoutGrid, List, QrCode, ShoppingBasket, Sparkles, WalletCards, Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { DashboardData, Item, ShoppingItem } from "@/types";
import { isLiquidConsumable } from "@/lib/item-metrics";
import { itemAiHighlights } from "@/lib/item-ai";
import { Badge } from "@/components/ui";
import { Empty, Hero, ListRow, Metric, Panel, Screen } from "@/components/ui-kit";
import { View, expiryDays, expiryDateLabel, expiryAdvice, expiryGroupLabel, SectionHead } from "../shared";
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
  // 首屏只回答一个问题:「现在最该做什么」。按 已过期 > 快到期 > 需要补货 的顺序,
  // 挑出唯一一件最紧急的事;数量与清单分别交给 Metric 一行和折叠面板,不再重复叙述。
  const focusTone = expired.length ? "danger" : expiring.length ? "warning" : lowStock.length ? "warning" : "success";
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
  const pendingNames = new Set(pending.map((item) => item.name.trim().toLocaleLowerCase()));
  const restockSuggestions = lowStock.filter((item) => !pendingNames.has(item.name.trim().toLocaleLowerCase())).slice(0, 3);
  const urgentExpiry = [...expired, ...expiring.filter((item) => expiryDays(item, now) <= 7)]
    .sort((a, b) => new Date(a.expiryDate!).getTime() - new Date(b.expiryDate!).getTime());
  const expiryGroups = urgentExpiry.reduce<Record<string, Item[]>>((groups, item) => {
    const key = item.expiryDate!.slice(0, 10);
    (groups[key] ||= []).push(item);
    return groups;
  }, {});

  return <Screen title="概览">
    {/* 概述区块:一句「现在最该做什么」+ 一行紧凑数字。类名 dashboard-overview 由验收套件依赖;
        外观交给 Hero 与 Metric,这里不画自己的卡片(旧渐变/阴影用工具类关掉)。 */}
    <section className="dashboard-overview bg-none shadow-none">
      <Hero
        eyebrow={attentionCount ? "最需要做的事" : "当前状态"}
        tone={focusTone}
        headline={focus.headline}
        detail={focus.detail}
        action={<button onClick={focus.run} className="btn-primary flex items-center gap-1.5">{focus.action}<ChevronRight size={15} /></button>}
      />
      <div className="mt-4 grid grid-cols-3 gap-3 sm:mt-5 sm:gap-4">
        <Metric icon={CircleAlert} label="低库存" value={<>{lowStock.length}<span className="ml-1 text-sm font-bold muted">项</span></>} tone={lowStock.length ? "warning" : "neutral"} />
        <Metric icon={ShoppingBasket} label="待采购" value={<>{pending.length}<span className="ml-1 text-sm font-bold muted">项</span></>} />
        <Metric icon={Zap} label="估算价值" value={totalValue >= 10000 ? `${(totalValue / 10000).toFixed(1)}万` : `¥${Math.round(totalValue)}`} />
      </div>
    </section>

    <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,.7fr)]">
      <Panel
        title="最近更新"
        actions={<>
          <div className="flex rounded-xl p-1" style={{ background: "var(--surface-soft)" }}>
            <button data-testid="recent-view-cards" onClick={() => changeRecentView("cards")} className="grid size-11 place-items-center rounded-lg sm:size-10" style={recentView === "cards" ? { background: "var(--surface-solid)", color: "var(--primary)", boxShadow: "0 1px 4px rgba(0,0,0,.08)" } : { color: "var(--muted)" }} aria-label="卡片显示" title="卡片显示"><LayoutGrid size={15} /></button>
            <button data-testid="recent-view-list" onClick={() => changeRecentView("list")} className="grid size-11 place-items-center rounded-lg sm:size-10" style={recentView === "list" ? { background: "var(--surface-solid)", color: "var(--primary)", boxShadow: "0 1px 4px rgba(0,0,0,.08)" } : { color: "var(--muted)" }} aria-label="列表显示" title="列表显示"><List size={16} /></button>
          </div>
          <button onClick={() => onNavigate("items")} className="flex min-h-11 items-center gap-1 px-1 text-xs font-bold sm:min-h-10" style={{ color: "var(--primary)" }}>查看全部<ChevronRight size={14} /></button>
        </>}
      >
        {recentView === "cards"
          ? <div data-testid="recent-cards" className="grid gap-3 sm:grid-cols-2">{data.items.slice(0, 6).map((item) => <ItemCard key={item.id} item={item} onEdit={() => onEdit(item)} onOpenDetail={() => onOpenDetail(item)} onImageUpload={(file) => onImageUpload(item, file)} onDuplicate={() => onDuplicate(item)} onConsume={() => onConsume(item)} onQr={() => onQr(item)} onAi={() => onAi(item)} compact />)}{data.items.length === 0 && <div className="sm:col-span-2"><Empty icon={Boxes} title="还没有物品" text="录入第一件物品后,这里会按更新时间列出最近变动的物品。" action={<button type="button" className="btn-ghost" onClick={onCreate}>录入第一件物品</button>} /></div>}</div>
          : <div data-testid="recent-list" className="min-w-0">{data.items.slice(0, 6).map((item) => <RecentItemRow key={item.id} item={item} onEdit={() => onEdit(item)} onQr={() => onQr(item)} onAi={() => onAi(item)} />)}{data.items.length === 0 && <Empty icon={Boxes} title="还没有物品" text="录入第一件物品后,这里会按更新时间列出最近变动的物品。" action={<button type="button" className="btn-ghost" onClick={onCreate}>录入第一件物品</button>} />}</div>}
      </Panel>

      <div className="grid min-w-0 gap-4 sm:gap-5">
        {/* 默认折叠:辅助信息(消费 / 补货 / 到期 / 采购清单)不占首屏。 */}
        <details className="surface group p-4 sm:p-5">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl [&::-webkit-details-marker]:hidden">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--surface-soft)", color: "var(--muted)" }}><WalletCards size={18} /></span>
            <span className="min-w-0 flex-1"><b className="block text-sm">家庭消费</b><span className="mt-0.5 block text-xs muted">本月支出、分类与消耗趋势</span></span>
            <span className="grid size-8 shrink-0 place-items-center rounded-full muted transition-transform group-open:rotate-180"><ChevronDown size={17} /></span>
          </summary>
          <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--hairline)" }}>
            <HomeInsightsCompact data={data} />
          </div>
        </details>

        <details className="surface group p-4 sm:p-5">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl [&::-webkit-details-marker]:hidden">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}><Sparkles size={18} /></span>
            <span className="min-w-0 flex-1"><b className="block text-sm">更多待处理事项</b><span className="mt-0.5 block text-xs muted">补货、到期与采购清单</span></span>
            <span className="grid size-8 shrink-0 place-items-center rounded-full muted transition-transform group-open:rotate-180"><ChevronDown size={17} /></span>
          </summary>
          <div className="mt-4 space-y-5 border-t pt-4" style={{ borderColor: "var(--hairline)" }}>
            {restockSuggestions.length > 0 && <section>
              <SectionHead title="补货建议" action="查看物品" onClick={() => onNavigate("items")} />
              <p className="mb-1 mt-1 text-xs muted">低库存物品可直接加入采购清单。</p>
              <div>{restockSuggestions.map((item) => <ListRow
                key={item.id}
                icon={CircleAlert}
                title={item.name}
                meta={isLiquidConsumable(item) ? `余量 ${Math.round(item.remainingPercent)}%` : `建议补 ${Math.max(item.minQuantity - item.quantity, 1)} ${item.unit}`}
                trailing={<button type="button" onClick={() => onAddRestock(item)} className="btn-ghost min-h-11 shrink-0 px-3 text-xs sm:min-h-10" style={{ color: "var(--primary)" }}>加入</button>}
              />)}</div>
            </section>}

            {urgentExpiry.length > 0 && <section>
              <SectionHead title="本周到期" action="查看提醒" onClick={onAlerts} />
              <div className="mt-2 space-y-3">{Object.entries(expiryGroups).map(([date, items]) => <div key={date}>
                <div className="mb-1 flex items-center gap-2 text-xs font-bold muted"><span className="size-1.5 rounded-full" style={{ background: date < new Date().toISOString().slice(0, 10) ? "var(--danger)" : "var(--warning)" }} />{expiryGroupLabel(date, now)}</div>
                <div>{items.map((item) => {
                  const isExpired = expired.some((entry) => entry.id === item.id);
                  return <ListRow
                    key={item.id}
                    icon={AlertTriangle}
                    title={item.name}
                    meta={`${expiryDateLabel(item, now)} · ${expiryAdvice(item)}`}
                    trailing={<button type="button" onClick={() => isExpired ? onDelete(item) : onEdit(item)} className="btn-ghost min-h-11 shrink-0 px-3 text-xs sm:min-h-10" style={{ color: isExpired ? "var(--danger)" : "var(--primary)" }}>{isExpired ? "处理" : "查看"}</button>}
                  />;
                })}</div>
              </div>)}</div>
            </section>}

            <section>
              <SectionHead title={`采购清单 · ${pending.length}`} action="打开清单" onClick={() => onNavigate("items")} />
              <div className="mt-1">{pending.slice(0, 3).map((item) => <ListRow
                key={item.id}
                icon={ShoppingBasket}
                title={item.name}
                meta={`${item.quantity} ${item.unit} · ${item.category || "未分类"}`}
                trailing={<span className="size-2 shrink-0 rounded-full" style={{ background: item.priority === 2 ? "var(--danger)" : "var(--warning)" }} />}
              />)}{pending.length === 0 && <p className="mb-0 py-2 text-sm muted">清单已完成，暂时没有需要采购的物品。</p>}</div>
            </section>
          </div>
        </details>
      </div>
    </div>
  </Screen>;
}

export function RecentItemRow({ item, onEdit, onQr, onAi }: { item: Item; onEdit: () => void; onQr: () => void; onAi: () => void }) {
  const ai = itemAiHighlights(item);
  const emoji = ({ 食品: "🍚", 饮品: "🥛", 清洁: "🧴", 家电: "📺", 数码: "💻", 衣物: "👕", 医药: "💊", 户外: "⛺" } as Record<string, string>)[item.category] || "📦";
  return <ListRow
    onClick={onEdit}
    title={<span className="flex min-w-0 items-center gap-1.5">{item.imageUrl
      ? <span className="size-5 shrink-0 rounded-md bg-cover bg-center" style={{ backgroundImage: `url(${item.imageUrl})` }} />
      : <span className="shrink-0 text-base leading-none">{emoji}</span>}<span className="truncate">{item.name}</span>{ai.hasHighlights && <Sparkles size={12} className="shrink-0" style={{ color: "var(--primary)" }} />}</span>}
    meta={`${item.location?.name || "未设置位置"} · ${item.category}${ai.summary ? ` · ${ai.summary}` : ai.storage ? ` · ${ai.storage}` : ""}`}
    trailing={<span className="flex shrink-0 items-center gap-1.5">
      <span className="text-right text-sm font-black">{item.quantity}<span className="ml-1 text-xs font-normal muted">{item.unit}</span></span>
      <span className="flex gap-0.5 opacity-60 transition-opacity hover:opacity-100">
        <span onClick={(event) => { event.stopPropagation(); onAi(); }} className="grid size-6 place-items-center rounded-md hover:bg-[var(--surface-solid)]" aria-label="AI 物品助手"><Bot size={12} /></span>
        <span onClick={(event) => { event.stopPropagation(); onQr(); }} className="grid size-6 place-items-center rounded-md hover:bg-[var(--surface-solid)]" aria-label="显示二维码"><QrCode size={12} /></span>
      </span>
    </span>}
  />;
}

export function HomeInsightsCompact({ data }: { data: DashboardData }) {
  if (data.finance.currentMonthTotal <= 0 && data.finance.averageMonthly <= 0 && !data.finance.recent[0] && data.finance.byCategory.length === 0 && data.consumption.length === 0) return null;
  return <>
    <div className="grid grid-cols-2 gap-4 sm:gap-6">
      <Metric label="本月" value={`¥${data.finance.currentMonthTotal.toFixed(0)}`} />
      <Metric label="近 6 月均值" value={`¥${data.finance.averageMonthly.toFixed(0)}`} />
    </div>
    {(data.finance.byCategory.length > 0 || data.consumption.length > 0 || data.finance.recent[0]) && <details className="group mt-3 border-t pt-2" style={{ borderColor: "var(--hairline)" }}>
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-xs font-semibold muted [&::-webkit-details-marker]:hidden">查看消费详情<ChevronDown size={15} className="transition-transform group-open:rotate-180" /></summary>
      {data.finance.byCategory.length > 0 && <div className="mt-3"><div className="mb-2 text-xs font-bold muted">本月消费分类</div><div className="flex flex-wrap gap-2">{data.finance.byCategory.map((entry) => <Badge key={entry.category} tone="primary">{entry.category} ¥{entry.total.toFixed(0)}</Badge>)}</div></div>}
      {data.consumption.length > 0 && <div className="mt-3"><div className="mb-2 text-xs font-bold muted">最近消耗较多</div><div className="space-y-1.5">{data.consumption.slice(0, 3).map((entry) => <div key={entry.itemName} className="flex items-center justify-between gap-2 text-xs"><span className="min-w-0 truncate">{entry.itemName}</span><span className="shrink-0 font-bold muted">{entry.count} 次</span></div>)}</div></div>}
      {data.finance.recent[0] && <div className="mt-3 truncate text-xs muted">最近记录:{data.finance.recent[0].itemName} · ¥{data.finance.recent[0].totalPrice.toFixed(2)}</div>}
    </details>}
  </>;
}
