import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ACCOUNT_COOKIE, createSession, verifyPassword } from "@/lib/account-auth";
import { recordLoginAttempt } from "@/lib/login-record";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    await recordLoginAttempt(request, { username, success: false, failureReason: "用户名不存在" });
    return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
  }
  if (!user.active) {
    await recordLoginAttempt(request, { userId: user.id, username, success: false, failureReason: "账号已停用" });
    return NextResponse.json({ error: "账号已停用" }, { status: 401 });
  }
  if (!verifyPassword(password, user.passwordHash)) {
    await recordLoginAttempt(request, { userId: user.id, username, success: false, failureReason: "密码错误" });
    return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
  }
  const token = await createSession(user.id);
  await recordLoginAttempt(request, { userId: user.id, username, success: true });
  const response = NextResponse.json({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
  response.cookies.set(ACCOUNT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return response;
}
