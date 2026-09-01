import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { locationSchema } from "@/lib/validation";
import { apiError, requireWritableUser } from "@/lib/api";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;
    const data = locationSchema.partial().parse(await request.json());
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
