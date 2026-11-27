import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { getAiConfig } from "@/lib/ai";
import { monthlyBuckets } from "@/lib/chart";
import { compressedJson } from "@/lib/next-json";
import { CATEGORY_SHARE_ROWS, topWithOtherRows } from "@/lib/category-share";
import { rankConsumption } from "@/lib/consumption-ranking";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const [items, locations, shopping, priceRecords, consumptionLogs, preferences, tasks] = await Promise.all([
      // 物品只带位置的 id 与名字:界面读 item.location 的地方**全都是读 .name**
      // (物品卡片、搜索结果、盘点清单、AI 队列),而 `include: { location: true }` 会把
      // icon/color/thumbnailUrl/parentId/createdAt/updatedAt 一起塞进**每一行** ——
      // 1200 件物品时那 197 字节/行里,真正被用到的只有名字。整份 location 实体在下面的
      // `locations` 里本来就有(7 条 1.6 KB),需要完整字段的界面从那里取。
      prisma.item.findMany({ where: { deletedAt: null }, include: { location: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" } }),
      // _count 也只数还在的(与空间卡的件数同口径;界面上目前没人读它,别给以后留坑)。
      prisma.location.findMany({ include: { parent: { select: { id: true, name: true } }, _count: { select: { items: { where: { quantity: { gt: 0 } } } } } }, orderBy: { createdAt: "asc" } }),
      prisma.shoppingItem.findMany({ orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }] }),
      prisma.priceRecord.findMany({ where: { purchasedAt: { gte: sixMonthStart } }, orderBy: { purchasedAt: "desc" } }),
      prisma.activityLog.findMany({ where: { action: "CONSUME", undoneAt: null }, select: { itemId: true, itemName: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 500 }),
      prisma.householdPreference.upsert({ where: { id: "default" }, create: {}, update: {} }),
      prisma.householdTask.findMany({ where: { status: "OPEN" }, orderBy: { dueAt: "asc" }, take: 8 }),
    ]);

    // 每件物品最近一次 AI 分析的时间:物品列表据此提示「结论已过时」。
    const aiAnalyzedAtMap = new Map<string, Date>(
      (await prisma.activityLog.groupBy({ by: ["itemId"], where: { action: "AI_ANALYZE", itemId: { not: null } }, _max: { createdAt: true } }))
        .flatMap((row) => (row.itemId && row._max.createdAt ? [[row.itemId, row._max.createdAt] as [string, Date]] : [])),
    );
    const itemsWithAiTime = items.map((item) => ({ ...item, aiAnalyzedAt: aiAnalyzedAtMap.get(item.id)?.toISOString() ?? null }));

    const sixMonthTotal = priceRecords.reduce((sum, record) => sum + record.totalPrice, 0);
    const currentMonthTotal = priceRecords.filter((record) => record.purchasedAt >= currentMonthStart).reduce((sum, record) => sum + record.totalPrice, 0);
    // 近 6 个月支出序列:前端直接画柱状图,不在浏览器里再聚合一遍。
    const monthly = monthlyBuckets(priceRecords, now, 6).map((row) => ({ label: row.label, value: row.total }));

    const categoryTotals = new Map<string, number>();
    priceRecords.filter((record) => record.purchasedAt >= currentMonthStart).forEach((record) => categoryTotals.set(record.category, (categoryTotals.get(record.category) || 0) + record.totalPrice));
    // 分类金额:前 CATEGORY_SHARE_ROWS 类 + 尾部合并成「其他」。
    // 这里原先直接把数组砍到前 4 条,尾部类别就这么没了 —— 而面板的百分比是按传进去的行算的,
    // 于是「本月 ¥10370」和四行之和(¥10332)对不上,百分比却还是 100%(见 lib/category-share.ts)。
    const byCategory = topWithOtherRows(categoryTotals, CATEGORY_SHARE_ROWS).map((row) => ({ category: row.label, total: row.value }));
    // 榜单按 itemId 归并(流水的 itemName 只是记录那一刻的名字快照,见 lib/consumption-ranking):
    // 同一件物品改名前后按名字聚合会在榜上算成两件,把真正用得多的挤下去。
    const consumption = rankConsumption(consumptionLogs, {
      nameById: new Map(items.map((item) => [item.id, item.name])),
    });
    // 这份响应带着整份库存(1200 件时约 1 MB),必须压:Next 的 compress **不覆盖**
    // route handler,实测 standalone(Docker 路径)与 next start 都是原样发出去的。
    return compressedJson({
      items: itemsWithAiTime,
      locations,
      shopping,
      finance: { currentMonthTotal, averageMonthly: sixMonthTotal / 6, recordCount: priceRecords.length, monthly, recent: priceRecords.slice(0, 5), byCategory },
      consumption,
      // AI 未配置时前端把按钮换成「去设置」引导,而不是让用户点了才看到报错。
      aiAvailable: Boolean(await getAiConfig()),
      preferences: { expiryReminderDays: preferences.expiryReminderDays, lowStockReminder: preferences.lowStockReminder, weeklyReviewEnabled: preferences.weeklyReviewEnabled, weeklyReviewDay: preferences.weeklyReviewDay },
      tasks,
    }, request);
  } catch (error) {
    return apiError(error);
  }
}
