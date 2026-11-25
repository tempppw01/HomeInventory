import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { bulkItemPatchSchema } from "@/lib/validation";
import { z } from "zod";
import { planItemUpdate, recordConsumeFromUpdate, type ItemFieldPatch } from "@/lib/item-update";

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireWritableUser();
    const parsed = bulkItemPatchSchema.parse(await request.json());
    const { ids, restore, ...data } = parsed;
    // restore 供 toast 的「撤销」使用:清空 deletedAt 而不是改字段。
    if (restore) {
      const restored = await prisma.$transaction(async (tx) => {
        const rows = await tx.item.findMany({ where: { id: { in: ids }, deletedAt: { not: null } }, select: { id: true, name: true } });
        await tx.item.updateMany({ where: { id: { in: ids }, deletedAt: { not: null } }, data: { deletedAt: null } });
        if (rows.length) await tx.activityLog.createMany({ data: rows.map((item) => ({ action: "RESTORE", itemId: item.id, itemName: item.name, userId: user.id, detail: "批量从回收站恢复" })) });
        return rows.length;
      });
      return NextResponse.json({ count: restored });
    }
    if (data.locationId) {
      const location = await prisma.location.findUnique({ where: { id: data.locationId } });
      if (!location) return NextResponse.json({ error: "存放位置不存在" }, { status: 400 });
    }
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.item.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, name: true, type: true, unit: true, category: true, quantity: true, remainingPercent: true } });
      // 逐件走**和单条编辑同一份**语义(lib/item-update):数量按各自单位归一化、耐用品清到期日、
      // 重算存放建议与自动标签;余量下降时补一条消耗流水并重算日均消耗。
      // 此前这里直接写字段,于是同一件事两个入口结果不同(实测:改成耐用品后到期日还在、
      // 余量 80→20 一条流水都不记、改分类后标签停在旧值)。
      for (const item of updated) {
        const plan = planItemUpdate(item, data as ItemFieldPatch);
        const learnedRate = await recordConsumeFromUpdate(tx, { itemId: item.id, itemName: item.name, userId: user.id, plan });
        await tx.item.update({ where: { id: item.id }, data: learnedRate === null ? plan.data : { ...plan.data, consumeRate: learnedRate } });
      }
      if (updated.length) await tx.activityLog.createMany({ data: updated.map((item) => ({ action: "UPDATE", itemId: item.id, itemName: item.name, userId: user.id, detail: "批量更新物品" })) });
      return updated.length;
    });
    return NextResponse.json({ count: result });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireWritableUser();
    const body = await request.json().catch(() => ({}));
    const ids = z.array(z.string().trim().min(1).max(80)).min(1, "请选择物品").max(100, "单次最多删除 100 件物品").parse(body.ids);
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.item.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, name: true } });
      await tx.item.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } });
      if (updated.length) await tx.activityLog.createMany({ data: updated.map((item) => ({ action: "DELETE", itemId: item.id, itemName: item.name, userId: user.id, detail: "批量移入回收站" })) });
      return updated.length;
    });
    return NextResponse.json({ count: result });
  } catch (error) { return apiError(error); }
}
