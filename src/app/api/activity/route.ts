import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";

export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const scanOnly = request.nextUrl.searchParams.get("scan") === "1";
    // 详情页要「这件物品的变更记录」,此前只能一次拉 100 条全局记录再前端过滤。
    const itemId = request.nextUrl.searchParams.get("itemId");
    const where = itemId
      ? { itemId }
      : scanOnly
        ? { action: { in: ["CONSUME", "CONSUME_UNDO"] } }
        : undefined;
    const rows = await prisma.activityLog.findMany({
      where,
      include: { member: true, user: { select: { displayName: true, username: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    // 一次最多给 100 条,但调用方需要知道「一共多少条」才不会把截断当成全部。
    // 用响应头带总数:body 仍是数组,不破坏任何现有调用方。
    const total = await prisma.activityLog.count({ where });
    return NextResponse.json(rows, { headers: { "X-Total-Count": String(total) } });
  } catch (error) {
    return apiError(error);
  }
}
