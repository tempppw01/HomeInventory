import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown): id is string => typeof id === "string") : [];
    if (!ids.length) return NextResponse.json({ error: "请选择物品" }, { status: 400 });
    const data: { category?: string; locationId?: string | null; restockPausedUntil?: Date | null } = {};
    if (typeof body.category === "string") data.category = body.category.trim().slice(0, 40);
    if (typeof body.locationId === "string" || body.locationId === null) data.locationId = body.locationId;
    if (body.restockPausedUntil === null) data.restockPausedUntil = null;
    if (typeof body.restockPausedUntil === "string") data.restockPausedUntil = new Date(body.restockPausedUntil);
    if (!Object.keys(data).length) return NextResponse.json({ error: "没有可更新的内容" }, { status: 400 });
    const result = await prisma.item.updateMany({ where: { id: { in: ids }, deletedAt: null }, data });
    return NextResponse.json({ count: result.count });
  } catch (error) { return apiError(error); }
}
