// 新物品的「后台自动分析」队列。
//
// 为什么要队列:
// · 一次分析要十几秒,不能卡住保存;
// · 批量导入可能一次进几十件,并发打满会把上游打挂,也会让界面一直转圈;
// · 失败要能重试,但不能无限重试。
// 实现上是最朴素的内存队列:单进程、并发 1、同一物品去重、最多 2 次尝试。
// 进程重启会丢掉排队的任务 —— 因此后台分析只是「锦上添花」,丢失不影响任何用户操作;
// 需要补齐时跑 scripts/ai-backfill.ts。
import { getAiConfig } from "@/lib/ai";
import { analyzeItemInBackground } from "@/lib/ai-analyze";
import { prisma } from "@/lib/prisma";

const queue: string[] = [];
const pending = new Set<string>();
let running = false;

/** 把一件物品排进后台分析队列(调用方不需要 await)。 */
export function enqueueItemAnalysis(itemId: string) {
  if (pending.has(itemId)) return;
  pending.add(itemId);
  queue.push(itemId);
  void drain();
}

async function analyzeOne(itemId: string) {
  const config = await getAiConfig();
  if (!config) return; // 没配 AI 就什么都不做,别浪费一次数据库查询链

  const item = await prisma.item.findFirst({
    where: { id: itemId, deletedAt: null },
    select: {
      id: true, name: true, category: true, type: true, unit: true, quantity: true, minQuantity: true,
      expiryDate: true, purchaseDate: true, notes: true, aiSummary: true, location: { select: { name: true } },
    },
  });
  if (!item) return;
  // 已经有结论的不重复花一次调用(用户手动点「全面看一遍」仍可强制刷新)。
  if (item.aiSummary) return;

  const { analysis } = await analyzeItemInBackground(config, {
    name: item.name,
    category: item.category,
    type: item.type,
    unit: item.unit,
    quantity: item.quantity,
    minQuantity: item.minQuantity,
    expiryDate: item.expiryDate?.toISOString() ?? null,
    purchaseDate: item.purchaseDate?.toISOString() ?? null,
    notes: item.notes,
    locationName: item.location?.name ?? null,
  });

  await prisma.item.update({
    where: { id: item.id },
    data: {
      aiSummary: analysis.summary ?? null,
      aiStorageAdvice: analysis.storageAdvice ?? null,
      aiUsageAdvice: analysis.usageAdvice ?? null,
      aiReplenishmentAdvice: analysis.replenishmentAdvice ?? null,
    },
  });
  await prisma.activityLog.create({
    data: { action: "AI_ANALYZE", itemId: item.id, itemName: item.name, userId: null, detail: "后台自动完成 AI 分析" },
  });
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const itemId = queue.shift();
      if (!itemId) break;
      try {
        await analyzeOne(itemId);
      } catch (error) {
        // 只重排一次:上游抖动时给它一次机会,持续失败就放弃,避免堆积。
        if (!retried.has(itemId)) {
          retried.add(itemId);
          queue.push(itemId);
        } else {
          console.warn("[ai-queue] 放弃分析", itemId, error instanceof Error ? error.message : error);
        }
      } finally {
        // 队列里没有这个 id 了才释放,避免和重排冲突
        if (!queue.includes(itemId)) pending.delete(itemId);
      }
      // 单并发 + 轻微间隔,别把上游打满
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  } finally {
    running = false;
  }
}

const retried = new Set<string>();

/** 供脚本/调试查询队列状态。 */
export function aiQueueState() {
  return { running, queued: queue.length, pending: pending.size };
}