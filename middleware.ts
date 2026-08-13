import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth-token";

export async function middleware(request: NextRequest) {
  const password = process.env.APP_PASSWORD?.trim();
  if (!password || request.nextUrl.pathname === "/api/auth/login" || request.nextUrl.pathname === "/api/auth/session" || request.nextUrl.pathname === "/api/health") return NextResponse.next();
  if (request.cookies.get(AUTH_COOKIE)?.value === await authToken(password)) return NextResponse.next();
  return NextResponse.json({ error: "请先登录" }, { status: 401 });
}

export const config = { matcher: ["/api/:path*"] };
