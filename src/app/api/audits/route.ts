import { NextRequest, NextResponse } from "next/server";
import { apiError, requireWritableUser } from "@/lib/api";
import { requireUser } from "@/lib/account-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// 盘点历史:此前只存在浏览器 localStorage,换设备或清缓存就丢了。
// 这里改为服务端留存,页面加载时优先读它。

export async function GET() {
  try {
    await requireUser();
    const rows = await prisma.auditRecord.findMany({ orderBy: { finishedAt: "desc" }, take: 20 });
    return NextResponse.json({
      audits: rows.map((row) => ({
        id: row.id,
        at: row.finishedAt.toISOString(),
        total: row.total,
        confirmed: row.confirmed,
        locationName: row.locationName,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireWritableUser();
    const body = await request.json().catch(() => ({}));
    const total = Number(body.total);
    const confirmed = Number(body.confirmed);
    if (!Number.isFinite(total) || !Number.isFinite(confirmed) || total < 0 || confirmed < 0) {
      return NextResponse.json({ error: "盘点数据不正确" }, { status: 400 });
    }
    const row = await prisma.auditRecord.create({
      data: {
        userId: user.id,
        total: Math.round(total),
        confirmed: Math.min(Math.round(confirmed), Math.round(total)),
        locationName: typeof body.locationName === "string" && body.locationName.trim() ? body.locationName.trim().slice(0, 60) : "全部空间",
      },
    });
    // 只保留最近 20 条,避免无限增长
    const extra = await prisma.auditRecord.findMany({ orderBy: { finishedAt: "desc" }, skip: 20, select: { id: true } });
    if (extra.length) await prisma.auditRecord.deleteMany({ where: { id: { in: extra.map((entry) => entry.id) } } });

    return NextResponse.json({ id: row.id, at: row.finishedAt.toISOString(), total: row.total, confirmed: row.confirmed, locationName: row.locationName }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}