import { NextResponse } from "next/server";
import { canAdmin, requireUser } from "@/lib/account-auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const actor = await requireUser();
    if (!canAdmin(actor.role)) return NextResponse.json({ error: "只有管理员可以查看登录记录" }, { status: 403 });
    const records = await prisma.loginRecord.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { displayName: true } } },
    });
    return NextResponse.json(records.map((record) => ({
      id: record.id,
      username: record.username,
      displayName: record.user?.displayName || record.username,
      ipAddress: record.ipAddress,
      device: record.device,
      success: record.success,
      failureReason: record.failureReason,
      createdAt: record.createdAt,
    })));
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
    return NextResponse.json({ error: unauthorized ? "请先登录" : "登录记录暂时不可用" }, { status: unauthorized ? 401 : 500 });
  }
}
