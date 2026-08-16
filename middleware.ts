import { NextRequest, NextResponse } from "next/server";
import { ACCOUNT_COOKIE } from "@/lib/account-auth";
import { userFromToken } from "@/lib/account-auth";

export async function middleware(request: NextRequest) {
  const publicPath = ["/api/auth/login", "/api/auth/setup", "/api/auth/session", "/api/auth/logout", "/api/health", "/api/public/consume"];
  if (publicPath.includes(request.nextUrl.pathname)) return NextResponse.next();
  const token = request.cookies.get(ACCOUNT_COOKIE)?.value;
  const user = token ? await userFromToken(token) : null;
  if (user) {
    const writeRequest = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (writeRequest && user.role === "VIEWER") return NextResponse.json({ error: "只读账号没有修改权限" }, { status: 403 });
    if (writeRequest && (request.nextUrl.pathname.startsWith("/api/settings/") || request.nextUrl.pathname === "/api/auth/users") && user.role !== "ADMIN") return NextResponse.json({ error: "只有管理员可以修改系统设置" }, { status: 403 });
    return NextResponse.next();
  }
  return NextResponse.json({ error: "请先登录" }, { status: 401 });
}

export const config = { matcher: ["/api/:path*"] };
