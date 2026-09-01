import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";
import { bulkItemPatchSchema } from "@/lib/validation";
import { z } from "zod";

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireWritableUser();
    const parsed = bulkItemPatchSchema.parse(await request.json());
    const { ids, ...data } = parsed;
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
