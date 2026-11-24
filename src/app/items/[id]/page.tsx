import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { PackagePlus, Archive, CalendarDays, Droplets, Lightbulb, MapPin, Package, Sparkles, Timer, WalletCards, Warehouse } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/account-auth";
import { dailyUsageCost, estimatedUseDays, isLiquidConsumable } from "@/lib/item-metrics";
import { itemAiHighlights, aiHighlightsAddNewInfo } from "@/lib/item-ai";
import { STORAGE_LABEL } from "@/lib/item-insight";
import { Panel } from "@/components/ui-kit";
import { CopyCodeButton } from "@/components/copy-code-button";
import { ItemQuickActions } from "@/components/item-quick-actions";
import { ItemPhotoSlot } from "@/components/item-photo-slot";
import { AskAiAboutItem } from "@/components/ask-ai-about-item";
import { ReanalyzeAiButton } from "@/components/reanalyze-ai-button";
import { relativeTimeText } from "@/lib/relative-time";
import { expiryStatusFor } from "@/lib/expiry-status";

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // This page shows price, notes and AI notes, so it needs a session just like
  // the API does. Redirecting keeps QR links working for signed-in family
  // members without publishing the household inventory to anyone with the link.
  const user = await currentUser();
  if (!user) redirect("/");
  // 只读角色不显示操作入口:接口本身也会拦,但界面上不该出现点了会被拒的按钮。
  const canEdit = user.role !== "VIEWER" && user.active !== false;
  const item = await prisma.item.findFirst({
    where: { deletedAt: null, OR: [{ id }, { itemCode: id }] },
    include: { location: true },
  });
  if (!item) notFound();
  // 临期窗口与物品卡片保持同一口径(用户设置的「保质期提前 N 天」)
  const preferences = await prisma.householdPreference.findUnique({ where: { id: "default" } });
  const expiryWindowDays = preferences?.expiryReminderDays ?? 14;
  const dailyCost = dailyUsageCost(item);
  const useDays = estimatedUseDays(item);
  const showRemaining = isLiquidConsumable(item);
  const ai = itemAiHighlights(item);
  // 有效期剩几天:药品/食品最要紧的一项,之前详情页完全没有显示。
  // 天数与颜色都用全站唯一的判定口径(此前详情页自己算一遍,且「今天到期」判成警示色而不是危险色)
  const expiryStatus = expiryStatusFor(item.expiryDate, undefined, expiryWindowDays);
  const expiryDaysLeft = expiryStatus?.days ?? null;
  // 上次补货:入库(shopping 标记已购买)时由服务端记录,这里用相对时间显示。
  const restockedText = item.lastRestockedAt ? relativeTimeText(item.lastRestockedAt) : null;
  const expiryTone = expiryStatus?.tone === "danger" ? "var(--danger)" : expiryStatus?.tone === "warning" ? "var(--warning)" : undefined;
  // 这件物品的变更流水:谁在什么时候改过它。此前 ActivityLog 有 itemId 却没有任何界面用到。
  const history = await prisma.activityLog.findMany({
    where: { itemId: item.id },
    include: { user: { select: { displayName: true, username: true } } },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  // 变更记录只列最近 12 条,但总数要说清 —— 否则用户不知道「更早还有多少」。
  const historyTotal = await prisma.activityLog.count({ where: { itemId: item.id } });
  // 「AI 说」是什么时候算的:history 已经按时间倒序取过了,直接找最近一条 AI 分析。
  const aiAnalyzedAt = history.find((entry) => entry.action === "AI_ANALYZE")?.createdAt ?? null;
  const aiTimeText = relativeTimeText(aiAnalyzedAt);
  const code = item.itemCode || item.id;
  const typeLabel = item.type === "CONSUMABLE" ? "消耗品" : "耐用品";
  // 「AI 说」面板和页面底部那块「AI 识别信息」读的是同一批字段(aiSummary / aiStorageAdvice / …)。
  // AI 摘要存在时两边一字不差:390px 下同一个摘要要读两遍,页面还白长 520px(实测 3020 → 2498)。
  // 只有底部那块还能额外给出信息时(没有 AI 摘要,或建议只存在于旧笔记里)才渲染它。
  const aiBlockAddsNewInfo = aiHighlightsAddNewInfo(item);

  return (
    <main
      className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 sm:py-10"
      data-bottom-nav-space="none"
      style={{ "--bottom-nav-space": "0px" } as CSSProperties}
    >
      <Link href="/" className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-2xl px-3 text-sm font-bold sm:mb-6" style={{ background: "var(--surface-solid)", color: "var(--primary)" }}>
        <Archive size={18} /> 返回归物
      </Link>

      <article className="surface overflow-hidden rounded-[32px]">
        <ItemPhotoSlot itemId={item.id} itemName={item.name} imageUrl={item.imageUrl} readOnly={!canEdit} />

        <div className="space-y-4 p-5 sm:p-6">
          <div>
            <h1 className="m-0 text-[1.75rem] font-black leading-tight tracking-[-0.01em] sm:text-3xl">{item.name}</h1>
            <p className="mb-0 mt-1.5 text-sm muted">{item.category} · {typeLabel}</p>
          </div>

          <Panel title="基本信息">
            <div className="space-y-0">
              <KeyValue icon={<Package size={18} />} label="物品编号" value={code} mono />
              <KeyValue icon={<CalendarDays size={18} />} label="录入时间" value={item.createdAt.toLocaleDateString("zh-CN")} />
              <KeyValue icon={<Sparkles size={18} />} label="物品类型" value={typeLabel} />
            </div>
          </Panel>

          <Panel title="位置与数量">
            <div className="space-y-0">
              <KeyValue icon={<MapPin size={18} />} label="存放位置" value={item.location?.name || "未设置"} />
              {item.storage && <KeyValue icon={<Warehouse size={18} />} label="存放建议" value={`${STORAGE_LABEL[item.storage as keyof typeof STORAGE_LABEL] ?? item.storage}${item.storageReason ? ` · ${item.storageReason}` : ""}`} />}
              {/* 「上次补货」此前只写不显示:入库时记录了时间,界面从不展示,用户看不到它有什么用 */}
              {restockedText && <KeyValue icon={<PackagePlus size={18} />} label="上次补货" value={restockedText} />}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Stat icon={<Package size={14} />} label="当前数量" value={`${item.quantity} ${item.unit}`} />
              {canEdit && (
                <div className="sm:col-span-2">
                  <ItemQuickActions
                    itemId={item.id}
                    unit={item.unit}
                    type={item.type}
                    remainingPercent={item.remainingPercent}
                    isLiquid={showRemaining}
                  />
                </div>
              )}
              <div className="sm:col-span-2">
                <AskAiAboutItem itemName={item.name} />
                <ReanalyzeAiButton
                  item={{
                    id: item.id,
                    name: item.name,
                    category: item.category,
                    type: item.type,
                    unit: item.unit,
                    quantity: item.quantity,
                    notes: item.notes,
                    expiryDate: item.expiryDate ? new Date(item.expiryDate).toISOString() : null,
                  }}
                />
              </div>
              {showRemaining && <Stat icon={<Droplets size={14} />} label="当前剩余量" value={`${Math.round(item.remainingPercent)}%`} tone={item.remainingPercent <= 20 ? "var(--danger)" : undefined} />}
            </div>
          </Panel>

          {(useDays || dailyCost || Number(item.price) > 0 || item.purchaseDate || item.expiryDate) && (
          <Panel title="日期与价格">
            <div className="grid gap-4 sm:grid-cols-2">
              {item.expiryDate && <Stat icon={<CalendarDays size={14} />} label="有效期至" value={new Date(item.expiryDate).toLocaleDateString("zh-CN")} hint={expiryDaysLeft === null ? undefined : expiryDaysLeft < 0 ? `已过期 ${Math.abs(expiryDaysLeft)} 天` : expiryDaysLeft === 0 ? "今天到期" : `还剩 ${expiryDaysLeft} 天`} tone={expiryTone} />}
              {item.purchaseDate && <Stat icon={<Archive size={14} />} label="购入日期" value={new Date(item.purchaseDate).toLocaleDateString("zh-CN")} />}
              {useDays && <Stat icon={<Timer size={14} />} label="预计还能用" value={`约 ${useDays} 天`} />}
              {Number(item.price) > 0 && <Stat icon={<WalletCards size={14} />} label="单价" value={`¥${Number(item.price).toFixed(2)}`} />}
              {dailyCost && <Stat icon={<WalletCards size={14} />} label="日均使用成本" value={`¥${dailyCost.cost.toFixed(dailyCost.cost >= 10 ? 0 : 2)} / 天`} hint={`已使用 ${dailyCost.days} 天`} />}
            </div>
          </Panel>
          )}

          {/* 后台自动分析的结果:保存物品时在后台生成,用户不需要点任何按钮 */}
          {item.aiSummary && (
          <Panel title="AI 说" description={aiTimeText ? `AI ${aiTimeText}看过这件` : undefined}>
            <p className="mb-0 text-sm leading-6">{item.aiSummary}</p>
            <div className="mt-3 grid gap-2">
              {item.aiStorageAdvice && <AiRow label="怎么存放" text={item.aiStorageAdvice} />}
              {item.aiUsageAdvice && <AiRow label="怎么用" text={item.aiUsageAdvice} />}
              {item.aiReplenishmentAdvice && <AiRow label="什么时候补货" text={item.aiReplenishmentAdvice} />}
            </div>
          </Panel>
          )}

          {item.notes && (
            <Panel title="备注">
              <p className="mb-0 whitespace-pre-wrap text-sm leading-6 muted">{item.notes}</p>
            </Panel>
          )}

          {history.length > 0 && (
            <Panel title="变更记录" description={historyTotal > history.length ? `共 ${historyTotal} 条,以下是最近 ${history.length} 条` : `共 ${historyTotal} 条,倒序`}>
              <ul className="m-0 list-none space-y-2 p-0">
                {history.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 border-t pt-2 text-xs first:border-t-0 first:pt-0" style={{ borderColor: "var(--hairline)" }}>
                    <span className="w-32 shrink-0 tabular-nums muted">{entry.createdAt.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="min-w-0 flex-1"><b className="font-bold">{entry.detail || entry.action}</b>{entry.user ? <span className="muted"> · {entry.user.displayName || entry.user.username}</span> : null}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <div className="rounded-2xl p-4" style={{ background: "var(--surface-soft)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold muted">物品编号</span>
              <CopyCodeButton code={code} />
            </div>
            <p className="mb-0 mt-2 break-all font-mono text-sm font-bold">{code}</p>
          </div>

          {aiBlockAddsNewInfo && (
            <div className="rounded-2xl p-4" style={{ background: "color-mix(in srgb, var(--primary) 7%, var(--surface-soft))" }}>
              <div className="flex items-center gap-2 text-sm font-black" style={{ color: "var(--primary)" }}><Sparkles size={17} />AI 识别信息</div>
              {ai.summary && <p className="mb-0 mt-3 text-sm leading-6">{ai.summary}</p>}
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {ai.storage && <div className="flex gap-2 rounded-xl p-3 text-xs leading-5" style={{ background: "var(--surface-solid)" }}><Warehouse size={15} className="mt-0.5 shrink-0" style={{ color: "var(--primary)" }} /><span><b>存储建议:</b>{ai.storage}</span></div>}
                {(ai.usage || ai.replenishment) && <div className="flex gap-2 rounded-xl p-3 text-xs leading-5" style={{ background: "var(--surface-solid)" }}><Lightbulb size={15} className="mt-0.5 shrink-0" style={{ color: "var(--primary)" }} /><span><b>使用与补货:</b>{[ai.usage, ai.replenishment].filter(Boolean).join(";")}</span></div>}
              </div>
            </div>
          )}
        </div>
      </article>
    </main>
  );
}

/** 与 ui-kit 的 ListRow 同节奏的键值行(服务端组件里不跨客户端边界传组件)。 */
function KeyValue({ icon, label, value, mono = false }: { icon: ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-h-14 items-center gap-3 border-t py-3 first:border-t-0 first:pt-0" style={{ borderColor: "var(--hairline)" }}>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: "var(--surface-soft)", color: "var(--muted)" }}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs muted">{label}</span>
        <span className={`mt-0.5 block truncate text-sm font-bold ${mono ? "font-mono" : ""}`}>{value}</span>
      </span>
    </div>
  );
}

/** 与 ui-kit 的 Metric 同排版的数值块。 */
function AiRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-2xl px-3 py-2.5" style={{ background: "var(--surface-soft)" }}>
      <span className="block text-[11px] font-bold muted">{label}</span>
      <span className="mt-0.5 block text-xs leading-5">{text}</span>
    </div>
  );
}
function Stat({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs font-bold muted">{icon}<span className="truncate">{label}</span></div>
      <div className="mt-1 text-2xl font-black leading-none tabular-nums" style={{ color: tone ?? "var(--foreground)" }}>{value}</div>
      {hint && <div className="mt-1 truncate text-xs muted">{hint}</div>}
    </div>
  );
}
