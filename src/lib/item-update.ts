// 「把一份改动应用到一件物品」到底要连带做哪些事 —— 一处定义,两条写入路径共用。
//
// 由来(实测,修之前):单条编辑 PATCH /api/items/[id] 与批量编辑 PATCH /api/items/bulk
// 各写各的,于是同一件事在两个入口的结果不一样:
//
//   · 把类型改成「耐用品」:单条会清掉到期日,批量**留着** —— 于是那件东西还会出现在到期提醒里,
//     而界面上根本没有给耐用品填到期日的入口;
//   · 把余量从 80% 改到 20%:单条会补一条消耗流水并重算日均消耗,批量**什么都不记** ——
//     用户用「批量」的方式记录用掉一半,补货预测却完全不知道;
//   · 改分类/单位/类型:单条会重算存放建议与自动标签,批量**不重算** —— 标签停在旧值
//     (实测改类型后批量那件仍是「消耗品」,单条那件变成了「耐用品」)。
//
// 这里的 planItemUpdate 只做**纯计算**(归一化数量、耐用品清到期日、重算洞察、判断该不该记一次消耗),
// 落库与流水由调用方在同一事务里执行,避免把 tx 传进来之后又忍不住加业务分支。

import type { Prisma } from "@prisma/client";
import { normalizeItemQuantity } from "@/lib/item-metrics";
import { itemInsightFields } from "@/lib/item-insight";
import { learnConsumeRate } from "@/lib/item-forecast";

export type ItemFieldPatch = {
  name?: string;
  category?: string;
  type?: "DURABLE" | "CONSUMABLE";
  unit?: string;
  quantity?: number;
  minQuantity?: number;
  remainingPercent?: number;
  expiryDate?: Date | string | null;
  /** 其余字段(备注、价格、日期、位置、AI 结论……)原样透传 */
  [key: string]: unknown;
};

export type ItemFieldState = {
  name: string;
  category: string;
  type: "DURABLE" | "CONSUMABLE";
  unit: string;
  quantity: number;
  remainingPercent: number;
};

export type ItemUpdatePlan = {
  /** 要写进库的字段:数量已按单位归一化、耐用品已清到期日、洞察已重算 */
  data: Prisma.ItemUncheckedUpdateInput;
  /** 这次改动等价于用掉了多少(余量下降时才有),供调用方记流水与重算速度 */
  consume: { percentBefore: number; percentAfter: number; equivalent: number } | null;
};

/** 余量下降多少才算「用掉了一次」:少于 0.1 个单位的变化不值得记一条流水 */
const MIN_CONSUME_EQUIVALENT = 0.1;

export function planItemUpdate(existing: ItemFieldState, patch: ItemFieldPatch): ItemUpdatePlan {
  const nextType = patch.type ?? existing.type;
  const nextUnit = patch.unit ?? existing.unit;
  const data = { ...patch } as Prisma.ItemUncheckedUpdateInput;
  if (patch.quantity !== undefined) data.quantity = normalizeItemQuantity(patch.quantity, nextUnit);
  // 耐用品不该有保质期:界面上没有这个入口,单条编辑一直是这么清的,批量也要一致。
  if (nextType === "DURABLE") data.expiryDate = null;

  // 名称/分类/单位/类型任一变化都可能改变「该不该冷藏」与自动标签
  Object.assign(data, itemInsightFields({
    name: (patch.name ?? existing.name) as string,
    category: (patch.category ?? existing.category) as string,
    unit: nextUnit,
    type: nextType,
  }));

  const percentAfter = typeof patch.remainingPercent === "number" ? patch.remainingPercent : null;
  const consume = percentAfter !== null && percentAfter < existing.remainingPercent
    ? {
        percentBefore: existing.remainingPercent,
        percentAfter,
        // 历史每次下降幅度未知,用本次的等效用量作近似
        equivalent: ((existing.remainingPercent - percentAfter) / 100) * Math.max(existing.quantity, 0),
      }
    : null;

  return { data, consume: consume && consume.equivalent >= MIN_CONSUME_EQUIVALENT ? consume : null };
}

/** 事务客户端(与 prisma.$transaction 里的 tx 同型) */
type ConsumeTx = Prisma.TransactionClient;

/**
 * 把「这次改动等价于用掉一次」记下来,并重算最近 30 天的日均消耗。
 * 必须在物品更新**之后或同事务内**调用,并且流水要先落库才算得对(见 v0.1.57)。
 * @returns 要写进物品的 consumeRate;算不出来时返回 null(保持原值)
 */
export async function recordConsumeFromUpdate(
  tx: ConsumeTx,
  params: { itemId: string; itemName: string; userId: string | null; plan: ItemUpdatePlan },
): Promise<number | null> {
  const { plan, itemId, itemName, userId } = params;
  if (!plan.consume) return null;
  await tx.activityLog.create({
    data: {
      action: "CONSUME",
      itemId,
      itemName,
      userId,
      detail: `余量 ${Math.round(plan.consume.percentBefore)}% → ${Math.round(plan.consume.percentAfter)}%`,
      percentBefore: plan.consume.percentBefore,
      percentAfter: plan.consume.percentAfter,
    },
  });
  const recent = await tx.activityLog.findMany({
    where: { itemId, action: "CONSUME", undoneAt: null, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } },
    select: { createdAt: true },
  });
  const learned = learnConsumeRate(recent.map((row) => ({ at: row.createdAt.getTime(), units: plan.consume!.equivalent })));
  return learned ? Number(learned.toFixed(3)) : null;
}