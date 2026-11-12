import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, verifyPassword } from "@/lib/account-auth";
import { hashRecoveryCode } from "@/lib/recovery-hash";
import { generateRecoveryCode } from "@/lib/recovery-code";
import { rateLimit } from "@/lib/rate-limit";
import { recoveryMintSchema } from "@/lib/validation";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

// 这里刻意不判断 canWrite():恢复码只作用于「自己的账号」,生成它既不能提权也
// 改不到别人的数据,而只读账号同样需要能找回自己的密码。这是角色矩阵里的一条
// 显式例外,不是漏判。

/** 当前账号是否已经设置恢复码(不返回码本身,码只在生成当次返回)。 */
export async function GET() {
  try {
    const user = await requireUser();
    const record = await prisma.user.findUnique({ where: { id: user.id }, select: { recoveryCodeHash: true, recoveryGeneratedAt: true } });
    return NextResponse.json({ hasCode: Boolean(record?.recoveryCodeHash), generatedAt: record?.recoveryGeneratedAt ?? null });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "请先登录" }, { status: 401 });
    return apiError(error);
  }
}

/**
 * 生成(或重新生成)自己的恢复码。需要先用当前密码确认身份,避免只拿到一个
 * 已登录会话的人静默地给自己留后门。旧的恢复码在生成成功的一刻作废。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const guard = rateLimit(`recovery-mint:${user.id}`, 5, 60_000);
    if (!guard.ok) return NextResponse.json({ error: `操作过于频繁,请 ${guard.retryAfter} 秒后再试` }, { status: 429, headers: { "Retry-After": String(guard.retryAfter) } });

    const { password } = recoveryMintSchema.parse(await request.json().catch(() => ({})));
    if (!verifyPassword(password, user.passwordHash)) return NextResponse.json({ error: "当前密码不正确" }, { status: 400 });

    const code = generateRecoveryCode();
    const generatedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { recoveryCodeHash: hashRecoveryCode(code), recoveryGeneratedAt: generatedAt } });
      await tx.activityLog.create({ data: { action: "RECOVERY_CODE_CREATE", userId: user.id, detail: `生成新的恢复码:${user.username}` } });
    });
    return NextResponse.json({ code, generatedAt });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return NextResponse.json({ error: "请先登录" }, { status: 401 });
    return apiError(error);
  }
}
