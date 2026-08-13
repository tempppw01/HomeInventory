import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth-token";

export async function POST(request: NextRequest) {
  const configured = process.env.APP_PASSWORD?.trim();
  if (!configured) return NextResponse.json({ enabled: false });
  const body = await request.json().catch(() => ({}));
  if (typeof body.password !== "string" || body.password !== configured) return NextResponse.json({ error: "密码不正确" }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, await authToken(configured), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return response;
}
