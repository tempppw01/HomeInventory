import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Archive, CalendarDays, Droplets, Lightbulb, MapPin, Package, QrCode, Sparkles, Timer, WalletCards, Warehouse } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/account-auth";
import { dailyUsageCost, estimatedUseDays, isLiquidConsumable } from "@/lib/item-metrics";
import { itemAiHighlights } from "@/lib/item-ai";
import { Panel } from "@/components/ui-kit";

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // This page shows price, notes and AI notes, so it needs a session just like
  // the API does. Redirecting keeps QR links working for signed-in family
  // members without publishing the household inventory to anyone with the link.
  const user = await currentUser();
  if (!user) redirect("/");
  const item = await prisma.item.findFirst({
    where: { deletedAt: null, OR: [{ id }, { itemCode: id }] },
    include: { location: true },
  });
  if (!item) notFound();
  const dailyCost = dailyUsageCost(item);
  const useDays = estimatedUseDays(item);
  const showRemaining = isLiquidConsumable(item);
  const ai = itemAiHighlights(item);
  const code = item.itemCode || item.id;
  const typeLabel = item.type === "CONSUMABLE" ? "消耗品" : "耐用品";

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
        {item.imageUrl ? (
          <div className="h-64 bg-cover bg-center sm:h-80" style={{ backgroundImage: `url(${item.imageUrl})` }} />
        ) : (
          <div className="grid h-52 place-items-center" style={{ background: "var(--surface-soft)", color: "var(--primary)" }}><Package size={56} /></div>
        )}

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
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Stat icon={<Package size={14} />} label="当前数量" value={`${item.quantity} ${item.unit}`} />
              {showRemaining && <Stat icon={<Droplets size={14} />} label="当前剩余量" value={`${Math.round(item.remainingPercent)}%`} tone={item.remainingPercent <= 20 ? "var(--danger)" : undefined} />}
            </div>
          </Panel>

          <Panel title="日期与价格">
            <div className="grid gap-4 sm:grid-cols-2">
              {useDays && <Stat icon={<Timer size={14} />} label="预计还能用" value={`约 ${useDays} 天`} />}
              {dailyCost && <Stat icon={<WalletCards size={14} />} label="日均使用成本" value={`¥${dailyCost.cost.toFixed(dailyCost.cost >= 10 ? 0 : 2)} / 天`} hint={`已使用 ${dailyCost.days} 天`} />}
            </div>
          </Panel>

          {item.notes && (
            <Panel title="备注">
              <p className="mb-0 whitespace-pre-wrap text-sm leading-6 muted">{item.notes}</p>
            </Panel>
          )}

          <div className="rounded-2xl p-4" style={{ background: "var(--surface-soft)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold muted">物品编号</span>
              <a href={`/items/${item.id}`} className="btn-ghost inline-flex min-h-11 items-center gap-2 px-4 text-sm"><QrCode size={16} />复制</a>
            </div>
            <p className="mb-0 mt-2 break-all font-mono text-sm font-bold">{code}</p>
          </div>

          {ai.hasHighlights && (
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
function Stat({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs font-bold muted">{icon}<span className="truncate">{label}</span></div>
      <div className="mt-1 text-2xl font-black leading-none tabular-nums" style={{ color: tone ?? "var(--foreground)" }}>{value}</div>
      {hint && <div className="mt-1 truncate text-xs muted">{hint}</div>}
    </div>
  );
}
