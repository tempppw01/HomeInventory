import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ACCOUNT_COOKIE, canAdmin, hashPassword, requireUser, sessionHash } from "@/lib/account-auth";
import { generateRecoveryCode } from "@/lib/recovery-code";
import { hashRecoveryCode } from "@/lib/recovery-hash";
import { userCreateSchema } from "@/lib/validation";

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
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    if (!canAdmin(user.role)) return NextResponse.json({ error: "只有管理员可以管理账号" }, { status: 403 });
    const body = userCreateSchema.parse(await request.json());
    const { username, displayName, password } = body;
    const role = body.role === "VIEWER" ? "VIEWER" : "MEMBER";
    // 初始密码与恢复码在同一次事务里生成并入库,明文只在这一次响应里出现。
    const { user: created, recoveryCode } = await prisma.$transaction(async (tx) => {
      const code = generateRecoveryCode();
      const next = await tx.user.create({ data: { username, displayName, passwordHash: hashPassword(password), role, recoveryCodeHash: hashRecoveryCode(code), recoveryGeneratedAt: new Date() } });
      await tx.householdMember.create({ data: { name: displayName, userId: next.id } });
      await tx.activityLog.create({ data: { action: "ACCOUNT_CREATE", userId: user.id, detail: `创建账号：${username}` } });
      return { user: next, recoveryCode: code };
    });
    return NextResponse.json({ id: created.id, username, displayName, role, active: true, recoveryCode }, { status: 201 });
  } catch (error) {
    // 用统一的 apiError:zod 校验失败时会把具体原因返回给调用方
    // (例如「新建账号只能是成员或只读;管理员可在创建后再授予」)。
    // 之前这里一律吞成「用户名可能已存在」,调用方看不出真正的问题。
    return apiError(error);
  }
}
