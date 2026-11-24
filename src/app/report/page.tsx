import { redirect } from "next/navigation";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Archive, CalendarDays, Snowflake, ShoppingBasket, Wallet, Sparkles } from "lucide-react";
import { inDaysPhrase } from "@/lib/expiry-status";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/account-auth";
import { restockForecast } from "@/lib/item-forecast";
import { fridgePlan } from "@/lib/fridge";
import { buildHouseholdReport, reportHeadline } from "@/lib/household-report";
import { MonthlyBars, ShareBar } from "@/components/charts";
import { monthlyBuckets } from "@/lib/chart";
import { ReportPrintButton } from "@/components/report-print-button";

export const dynamic = "force-dynamic";

/**
 * 家庭月报:一页纸看清家里的状况,可直接打印或存成 PDF。
 *
 * 数据都是现成的(物品、有效期、消耗速度),这里只做汇总;预测类计算复用
 * item-forecast 与 fridge,保证和概览页的口径完全一致 —— 同一份数据在两个地方
 * 得出不同结论是最伤信任的事。
 */
export default async function ReportPage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const [items, locations, priceRecords] = await Promise.all([
    prisma.item.findMany({
      // 与概览页同一个口径:非删除即算(此前这里多了 `quantity: { gt: 0 }`,于是
      // 用完但还留着等补货的物品在月报里"消失"了 —— 实测同一份数据概览说 4 件、月报说 3 件。
      // 「同一份数据在两个地方得出不同结论是最伤信任的事」(这个文件自己的注释就写着这句)。
      where: { deletedAt: null },
      select: {
        id: true, name: true, category: true, type: true, unit: true, quantity: true,
        remainingPercent: true, consumeRate: true, price: true, minQuantity: true, expiryDate: true,
        restockPausedUntil: true, storage: true,
        location: { select: { name: true } },
      },
    }),
    prisma.location.findMany({ select: { id: true, name: true } }),
    // 账单类数据:近 6 个月用于趋势图,本月用于分类占比。
    prisma.priceRecord.findMany({
      where: { purchasedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1) } },
      select: { category: true, totalPrice: true, purchasedAt: true },
    }),
  ]);

  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const expiring = items.flatMap((item) => {
    if (!item.expiryDate) return [];
    const date = new Date(item.expiryDate);
    if (Number.isNaN(date.getTime())) return [];
    const target = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return [{ name: item.name, days: Math.round((target - todayUtc) / 86400000) }];
  });

  const runningOut = restockForecast(
    items.map((item) => ({
      id: item.id, name: item.name, category: item.category, type: item.type, unit: item.unit,
      quantity: item.quantity, remainingPercent: item.remainingPercent,
      consumeRate: item.consumeRate ?? null, expiryDate: item.expiryDate?.toISOString() ?? null,
      restockPausedUntil: item.restockPausedUntil?.toISOString() ?? null,
    })),
    7,
    now.getTime(),
  ).map((row) => ({ name: row.name, days: row.daysLeft, unit: row.unit }));

  const fridge = fridgePlan(items.map((item) => ({
    id: item.id, name: item.name, unit: item.unit, quantity: item.quantity,
    storage: item.storage ?? null, locationName: item.location?.name ?? null,
  })));

  const monthly = monthlyBuckets(priceRecords, now, 6).map((row) => ({ label: row.label, value: row.total }));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const categoryTotals = new Map<string, number>();
  for (const record of priceRecords) {
    if (new Date(record.purchasedAt) < monthStart) continue;
    categoryTotals.set(record.category, (categoryTotals.get(record.category) ?? 0) + record.totalPrice);
  }
  const byCategory = [...categoryTotals.entries()].map(([category, total]) => ({ label: category, value: Number(total.toFixed(2)) })).sort((left, right) => right.value - left.value).slice(0, 4);

  const report = buildHouseholdReport({
    now,
    items: items.map((item) => ({
      name: item.name, type: item.type, quantity: item.quantity, unit: item.unit,
      price: item.price, consumeRate: item.consumeRate ?? null, minQuantity: item.minQuantity,
      category: item.category, remainingPercent: item.remainingPercent, restockPausedUntil: item.restockPausedUntil ?? null,
    })),
    locationCount: locations.length,
    expiring,
    runningOut,
    fridgeMissing: fridge.unplaced.map((row) => row.name),
  });

  const headline = reportHeadline(report);
  const generated = new Date(report.generatedAt).toLocaleString("zh-CN");

  const section = (icon: React.ReactNode, title: string, children: React.ReactNode) => (
    <section className="report-section">
      <h2 className="m-0 flex items-center gap-2 text-sm font-black">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>{icon}</span>
        {title}
      </h2>
      <div className="mt-2.5">{children}</div>
    </section>
  );

  return (
    // 这是全站唯一用 div 当根元素的页面 —— 其它页面都由 (app) 的 PageShell 提供 <main>。
    // 缺了 main 地标,读屏的「跳到主内容」里就没有这个页面;
    // 也让一批「按 main 取范围」的检查在这里空跑(什么都测不到却全绿)。
    <main className="mx-auto max-w-[820px] px-4 py-8 print:p-0" data-bottom-nav-space="none" style={{ "--bottom-nav-space": "0px" } as CSSProperties}>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/" className="btn-ghost inline-flex min-h-11 items-center gap-2 px-3 text-sm"><Archive size={16} />归物</Link>
        <ReportPrintButton />
        <span className="text-xs muted">打印时会自动隐藏按钮,只留内容</span>
      </div>

      <article className="surface rounded-[28px] p-6 sm:p-8 print:rounded-none print:border-0 print:shadow-none">
        <header>
          <p className="m-0 text-[11px] font-bold tracking-[0.2em] muted">家庭月报</p>
          <h1 className="m-0 mt-1.5 text-2xl font-black">{report.monthLabel}</h1>
          <p className="mb-0 mt-2 text-sm font-bold" style={{ color: "var(--primary)" }}>{headline}</p>
          <p className="mb-0 mt-1 text-xs muted">生成时间 {generated}</p>
        </header>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ["物品", `${report.counts.total} 件`],
            ["空间", `${report.counts.locations} 个`],
            ["估算价值", `¥${Math.round(report.value)}`],
            ["每月预计", `¥${Math.round(report.monthlySpend)}`],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-[11px] font-bold muted">{label}</div>
              <div className="mt-0.5 text-lg font-black tabular-nums">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-5">
          {monthly.some((row) => row.value > 0) && section(<Wallet size={14} />, "近 6 个月支出", (
            <div>
              <MonthlyBars points={monthly} ariaLabel="近 6 个月支出趋势" format="money" />
              {byCategory.length > 0 && <div className="mt-3"><ShareBar rows={byCategory} ariaLabel="本月消费分类占比" format="money" /></div>}
            </div>
          ))}

          {section(<CalendarDays size={14} />, report.expiringTotals.all > report.expiring.length
            // 列表只放最急的几条;标题里说清总数,免得「列出 8 条」被读成「一共 8 件」
            ? `要到期了(共 ${report.expiringTotals.all} 件,先列最急的 ${report.expiring.length} 件)`
            : "要到期了", report.expiring.length
            ? <ul className="m-0 list-none space-y-1 p-0 text-sm">{report.expiring.map((row) => <li key={row.name}>{row.name} · {inDaysPhrase(row.days, "到期")}</li>)}</ul>
            : <p className="m-0 text-sm muted">30 天内没有到期的东西</p>)}

          {section(<ShoppingBasket size={14} />, "快用完了", report.runningOut.length
            ? <ul className="m-0 list-none space-y-1 p-0 text-sm">{report.runningOut.map((row) => <li key={row.name}>{row.name} · {inDaysPhrase(row.days, "用完", true)}</li>)}</ul>
            : <p className="m-0 text-sm muted">按当前用量,暂时没有快用完的</p>)}

          {section(<Snowflake size={14} />, "该放冰箱的", report.fridgeMissing.length
            ? <ul className="m-0 list-none space-y-1 p-0 text-sm">{report.fridgeMissing.map((name) => <li key={name}>{name} · 还没放好</li>)}</ul>
            : <p className="m-0 text-sm muted">该冷藏的都放好了</p>)}

          {section(<Wallet size={14} />, "该补货的", report.lowStock.length
            ? <ul className="m-0 list-none space-y-1 p-0 text-sm">{report.lowStock.map((name) => <li key={name}>{name}</li>)}</ul>
            : <p className="m-0 text-sm muted">没有低于最低库存的物品</p>)}
        </div>

        <footer className="mt-6 flex items-center gap-2 border-t pt-3 text-[11px] muted" style={{ borderColor: "var(--hairline)" }}>
          <Sparkles size={12} />数据来自归物 HomeInventory,按当前库存实时汇总
        </footer>
      </article>
    </main>
  );
}