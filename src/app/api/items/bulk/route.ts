import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { bulkItemPatchSchema } from "@/lib/validation";

export async function PATCH(request: NextRequest) {
  try {
    const parsed = bulkItemPatchSchema.parse(await request.json());
    const { ids, ...data } = parsed;
    if (data.locationId) {
      const location = await prisma.location.findUnique({ where: { id: data.locationId } });
      if (!location) return NextResponse.json({ error: "存放位置不存在" }, { status: 400 });
    }
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.item.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, name: true } });
      await tx.item.updateMany({ where: { id: { in: ids }, deletedAt: null }, data });
      if (updated.length) await tx.activityLog.createMany({ data: updated.map((item) => ({ action: "UPDATE", itemId: item.id, itemName: item.name, detail: "批量更新物品" })) });
      return updated.length;
    });
    return NextResponse.json({ count: result });
  } catch (error) { return apiError(error); }
}
