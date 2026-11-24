import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ACCOUNT_COOKIE, createSession, hashPassword } from "@/lib/account-auth";
import { apiError } from "@/lib/api";

function requestIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}

export async function POST(request: NextRequest) {
  // 这个接口此前**没有 try/catch**:它是全新部署上第一个被调用的写接口,
  // 而 Prisma 的异常直接冒到 Next,回的是一句**空白 500** ——
  // 库结构比应用旧时(全新容器忘了同步结构就是这种情况)用户只看到「服务器错误」,
  // 而应用其实有一句现成的话要说:「数据库结构比当前版本旧…」(503 SCHEMA_OUTDATED)。
  // Docker 冒烟测试就是这么发现它的:建管理员 → 500 → 空响应体。
  try {
    const body = await request.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const remember = body.remember !== false;
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) return NextResponse.json({ error: "用户名需为 3-32 位字母、数字或 ._-" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "密码至少需要 8 位" }, { status: 400 });
    if (!displayName || displayName.length > 30) return NextResponse.json({ error: "请输入 1-30 位显示名称" }, { status: 400 });
    if (await prisma.user.count() > 0) return NextResponse.json({ error: "管理员已初始化" }, { status: 409 });
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { username, displayName, passwordHash: hashPassword(password), role: "ADMIN" } });
      await tx.householdMember.create({ data: { name: displayName, userId: created.id } });
      await tx.activityLog.create({ data: { action: "ACCOUNT_SETUP", userId: created.id, detail: "初始化管理员账号" } });
      return created;
    });
    const token = await createSession(user.id, { userAgent: request.headers.get("user-agent"), ipAddress: requestIp(request) }, { days: remember ? undefined : 1 });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ACCOUNT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}), path: "/" });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
