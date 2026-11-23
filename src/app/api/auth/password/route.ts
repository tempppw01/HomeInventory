import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ACCOUNT_COOKIE, hashPassword, requireUser, sessionHash, verifyPassword } from "@/lib/account-auth";
import { passwordChangeSchema } from "@/lib/validation";

/**
 * 用户自助修改自己的密码。
 *
 * 此前只有两条路:管理员在设置里替你重置,或者用恢复码走一次「忘记密码」。
 * 前者要麻烦别人,后者会顺带轮换恢复码 —— 「我只是想换个密码」没有对应的入口。
 *
 * 安全上有两点是刻意的:
 *   · 必须提供当前密码(不能只凭会话就改),这样拿到别人已登录浏览器的人无法直接改密码;
 *   · 改完**吊销其它设备上的会话**,只保留当前这台 —— 密码换了,旧设备就不该继续有效。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const parsed = passwordChangeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "填写不完整" }, { status: 400 });
    }
    const { currentPassword, newPassword } = parsed.data;
    const record = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
    if (!record) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
    if (!verifyPassword(currentPassword, record.passwordHash)) {
      return NextResponse.json({ error: "当前密码不正确" }, { status: 400 });
    }
    if (currentPassword === newPassword) {
      return NextResponse.json({ error: "新密码不能与当前密码相同" }, { status: 400 });
    }
    const token = (await cookies()).get(ACCOUNT_COOKIE)?.value ?? "";
    const keep = sessionHash(token);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword) } }),
      // 只保留当前会话;其它设备上的登录态作废。
      prisma.authSession.deleteMany({ where: { userId: user.id, tokenHash: { not: keep } } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}