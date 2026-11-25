import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { locationSchema } from "@/lib/validation";
import { apiError, requireWritableUser } from "@/lib/api";
import { wouldFormLocationCycle } from "@/lib/location-tree";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;
    const data = locationSchema.partial().parse(await request.json());
    if (data.parentId === id) return NextResponse.json({ error: "空间不能设为自己的上级" }, { status: 400 });
    if (data.parentId) {
      // 只查「父的父是不是自己」这一层不够:厨房 → 橱柜 → 抽屉 之后,把厨房的上级设成抽屉
      // 同样会成环,而界面的下拉框把除自己以外的所有空间都列出来 —— 一次编辑就能造成。
      // 实测(修之前)三段 PATCH 就把环造出来了,空间卡片上的路径开始重复。
      const nodes = await prisma.location.findMany({ select: { id: true, parentId: true } });
      if (!nodes.some((node) => node.id === data.parentId)) return NextResponse.json({ error: "上级空间不存在" }, { status: 400 });
      if (wouldFormLocationCycle(nodes, id, data.parentId)) return NextResponse.json({ error: "不能形成循环的空间层级" }, { status: 400 });
    }
    const location = await prisma.$transaction(async (tx) => {
      const updated = await tx.location.update({ where: { id }, data });
      await tx.activityLog.create({ data: { action: "LOCATION_UPDATE", userId: user.id, detail: `更新位置：${updated.name}` } });
      return updated;
    });
    return NextResponse.json(location);
  } catch (error) { return apiError(error); }
}

export async function DELETE(_: NextRequest, { params }: Context) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;
    const count = await prisma.item.count({ where: { locationId: id, deletedAt: null } });
    if (count > 0) return NextResponse.json({ error: `该位置还有 ${count} 件物品，请先移动后再删除` }, { status: 409 });
    const location = await prisma.location.findUnique({ where: { id } });
    if (!location) return NextResponse.json({ error: "位置不存在" }, { status: 404 });
    await prisma.$transaction(async (tx) => {
      await tx.location.delete({ where: { id } });
      await tx.activityLog.create({ data: { action: "LOCATION_DELETE", userId: user.id, detail: `删除位置：${location.name}` } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
