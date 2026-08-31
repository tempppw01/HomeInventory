import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ACCOUNT_COOKIE, canAdmin, requireUser, sessionHash } from "@/lib/account-auth";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_: NextRequest, { params }: Context) {
  try {
    const actor = await requireUser();
    if (!canAdmin(actor.role)) return NextResponse.json({ error: "只有管理员可以管理设备" }, { status: 403 });
    const { id } = await params;
    const currentToken = (await cookies()).get(ACCOUNT_COOKIE)?.value;
    const currentHash = currentToken ? sessionHash(currentToken) : "";
    const session = await prisma.authSession.findUnique({ where: { id } });
    if (!session) return NextResponse.json({ error: "设备会话不存在或已退出" }, { status: 404 });
    if (session.tokenHash === currentHash) return NextResponse.json({ error: "不能踢出当前设备，请使用退出登录" }, { status: 400 });
    await prisma.$transaction(async (tx) => {
      await tx.authSession.delete({ where: { id } });
      await tx.activityLog.create({ data: { action: "SESSION_REVOKE", userId: actor.id, detail: `踢出设备：${session.device}${session.ipAddress ? ` · ${session.ipAddress}` : ""}` } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === "UNAUTHORIZED" ? "请先登录" : "踢出设备失败" }, { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
