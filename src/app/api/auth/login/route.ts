import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ACCOUNT_COOKIE, createSession, verifyPassword } from "@/lib/account-auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
  const token = await createSession(user.id);
  const response = NextResponse.json({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
  response.cookies.set(ACCOUNT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return response;
}
