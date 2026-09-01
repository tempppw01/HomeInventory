import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;
    const item = await prisma.item.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!item) return NextResponse.json({ error: "物品不在回收站中" }, { status: 409 });
    const restored = await prisma.item.update({ where: { id }, data: { deletedAt: null }, include: { location: true } });
    await prisma.activityLog.create({ data: { action: "RESTORE", itemId: restored.id, itemName: restored.name, userId: user.id, detail: "从回收站恢复" } });
    return NextResponse.json(restored);
  } catch (error) {
    return apiError(error);
  }
}
