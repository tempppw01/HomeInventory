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

// 盘点数量的合理上界。实测(修之前):`total: 1000000000` 会被原样写进盘点历史 ——
// 一条这样的记录会让「最近几次盘了多少」彻底失真,而且它永久留在历史里(只留 20 条,也会顶掉真实记录)。
// 家庭库存不可能到百万级;超过就明确拒绝,不要把它当成"用户的数据"存下来。
const MAX_AUDIT_COUNT = 1_000_000;

export async function POST(request: NextRequest) {
  try {
    const user = await requireWritableUser();
    const body = await request.json().catch(() => ({}));
    const total = Number(body.total);
    const confirmed = Number(body.confirmed);
    if (!Number.isFinite(total) || !Number.isFinite(confirmed) || total < 0 || confirmed < 0) {
      return NextResponse.json({ error: "盘点数据不正确" }, { status: 400 });
    }
    if (total > MAX_AUDIT_COUNT || confirmed > MAX_AUDIT_COUNT) {
      return NextResponse.json({ error: `盘点数量超出合理范围(单次最多 ${MAX_AUDIT_COUNT.toLocaleString("zh-CN")} 件),请核对后重试` }, { status: 400 });
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