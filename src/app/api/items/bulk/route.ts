import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { bulkItemPatchSchema } from "@/lib/validation";
import { z } from "zod";

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
      const updated = await tx.item.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, name: true } });
      await tx.item.updateMany({ where: { id: { in: ids }, deletedAt: null }, data });
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
