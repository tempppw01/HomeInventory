import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { planMerge } from "@/lib/item-merge";
import { itemInsight } from "@/lib/item-insight";

const mergeSchema = z.object({
  keepId: z.string().min(1),
  mergeIds: z.array(z.string().min(1)).min(1).max(20),
});

/**
 * 合并重复物品:把 mergeIds 合并进 keepId,其余条目软删除到回收站(可恢复)。
 * 合并不可逆的关键数据(合计数量、最早保质期、备注)由 planMerge 统一计算,
 * 单位不一致直接 409 —— 绝不硬加出一笔错账。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireWritableUser();
    const { keepId, mergeIds } = mergeSchema.parse(await request.json());
    const ids = [keepId, ...mergeIds.filter((id) => id !== keepId)];

    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.item.findMany({ where: { id: { in: ids }, deletedAt: null } });
      if (rows.length < 2) return { error: "要合并的物品不足两条,或已被删除", status: 400 as const };
      const keep = rows.find((row) => row.id === keepId);
      if (!keep) return { error: "找不到要保留的物品", status: 400 as const };
      const others = rows.filter((row) => row.id !== keepId);

      const plan = planMerge(
        { id: keep.id, name: keep.name, unit: keep.unit, quantity: keep.quantity, remainingPercent: keep.remainingPercent, price: keep.price, purchaseDate: keep.purchaseDate?.toISOString() ?? null, expiryDate: keep.expiryDate?.toISOString() ?? null, notes: keep.notes, locationId: keep.locationId },
        others.map((row) => ({ id: row.id, name: row.name, unit: row.unit, quantity: row.quantity, remainingPercent: row.remainingPercent, price: row.price, purchaseDate: row.purchaseDate?.toISOString() ?? null, expiryDate: row.expiryDate?.toISOString() ?? null, notes: row.notes, locationId: row.locationId })),
      );
      if ("error" in plan) return { error: plan.error, status: 409 as const };

      // 后台自动重算存放建议与标签(数量/单位变了,标签可能跟着变)。
      const insight = itemInsight({ name: keep.name, category: keep.category, unit: keep.unit, type: keep.type });
      const updated = await tx.item.update({
        where: { id: keep.id },
        data: {
          ...plan.merged,
          purchaseDate: plan.merged.purchaseDate ? new Date(plan.merged.purchaseDate) : null,
          expiryDate: plan.merged.expiryDate ? new Date(plan.merged.expiryDate) : null,
          storage: insight.storage,
          storageReason: insight.storageReason,
          autoTags: insight.tags.join(","),
        },
        include: { location: true },
      });

      // 被合并条目的流水挂到保留项下,历史不丢。
      await tx.activityLog.updateMany({ where: { itemId: { in: plan.removedIds } }, data: { itemId: keep.id } });
      // 软删除:进回收站,合并错了还能恢复。
      await tx.item.updateMany({ where: { id: { in: plan.removedIds } }, data: { deletedAt: new Date() } });
      await tx.activityLog.create({
        data: { action: "MERGE", itemId: keep.id, itemName: keep.name, userId: user.id, detail: `${plan.summary}(${others.map((row) => row.name).join("、")} 已移入回收站)` },
      });

      return { item: updated, merged: plan.summary, removedIds: plan.removedIds };
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}