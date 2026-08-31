import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ACCOUNT_COOKIE, canAdmin, hashPassword, requireUser, sessionHash } from "@/lib/account-auth";

export async function GET() {
  try {
    const user = await requireUser();
    if (!canAdmin(user.role)) return NextResponse.json({ error: "只有管理员可以管理账号" }, { status: 403 });
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        active: true,
        createdAt: true,
        loginRecords: { where: { success: true }, orderBy: { createdAt: "desc" }, take: 1, select: { ipAddress: true, device: true, createdAt: true } },
        sessions: { where: { expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { id: true, device: true, ipAddress: true, createdAt: true, expiresAt: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const currentToken = (await cookies()).get(ACCOUNT_COOKIE)?.value;
    const currentSession = currentToken ? await prisma.authSession.findUnique({ where: { tokenHash: sessionHash(currentToken) }, select: { id: true } }) : null;
    return NextResponse.json(users.map(({ loginRecords, ...user }) => ({ ...user, lastLogin: loginRecords[0] || null, sessions: user.sessions.map((session) => ({ ...session, isCurrent: session.id === currentSession?.id })) })));
  } catch (error) { return NextResponse.json({ error: error instanceof Error && error.message === "UNAUTHORIZED" ? "请先登录" : "服务器暂时开小差了，请稍后重试" }, { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    if (!canAdmin(user.role)) return NextResponse.json({ error: "只有管理员可以管理账号" }, { status: 403 });
    const body = await request.json();
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role === "VIEWER" ? "VIEWER" : "MEMBER";
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) || !displayName || password.length < 8) return NextResponse.json({ error: "请填写有效用户名、显示名称和至少 8 位密码" }, { status: 400 });
    const created = await prisma.$transaction(async (tx) => {
      const next = await tx.user.create({ data: { username, displayName, passwordHash: hashPassword(password), role } });
      await tx.householdMember.create({ data: { name: displayName, userId: next.id } });
      await tx.activityLog.create({ data: { action: "ACCOUNT_CREATE", userId: user.id, detail: `创建账号：${username}` } });
      return next;
    });
    return NextResponse.json({ id: created.id, username, displayName, role, active: true }, { status: 201 });
  } catch { return NextResponse.json({ error: "用户名可能已存在，或服务器暂时开小差了" }, { status: 400 }); }
}
