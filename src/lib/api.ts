import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { canAdmin, canWrite, requireUser } from "@/lib/account-auth";

export async function requireWritableUser() {
  const user = await requireUser();
  if (!canWrite(user.role)) throw new Error("FORBIDDEN");
  return user;
}

export async function requireAdminUser() {
  const user = await requireUser();
  if (!canAdmin(user.role)) throw new Error("FORBIDDEN");
  return user;
}

// Prisma 的错误码在这里统一翻译成 HTTP 语义。此前只映射了 401/403/400,
// 于是「更新不存在的记录」「唯一约束冲突」「请求体不是合法 JSON」都落到 500,
// 前端只能显示「服务器开小差了」,问题也被掩盖。
function prismaCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^P\d{4}$/.test(code)) return code;
  }
  return null;
}

export function apiError(error: unknown) {
  // 先判定再决定是否记录:预期内的客户端错误不该刷日志(否则真实故障会被淹没)。
  const knownStatus = (() => {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return 401;
    if (error instanceof Error && error.message === "FORBIDDEN") return 403;
    if (error instanceof ZodError || error instanceof SyntaxError) return 400;
    const code = prismaCode(error);
    if (code === "P2025") return 404;
    if (code === "P2002" || code === "P2003" || code === "P2014") return 409;
    return null;
  })();
  if (knownStatus === null) console.error(error);
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return NextResponse.json({ error: "没有执行此操作的权限" }, { status: 403 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message ?? "提交的数据不正确" },
      { status: 400 },
    );
  }
  // 请求体不是合法 JSON(客户端直接 fetch 半截字符串时会发生)。
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "请求内容不是合法的 JSON" }, { status: 400 });
  }
  const code = prismaCode(error);
  if (code === "P2025") {
    return NextResponse.json({ error: "找不到这条记录,可能已被删除" }, { status: 404 });
  }
  if (code === "P2002") {
    return NextResponse.json({ error: "已存在同名或重复的记录" }, { status: 409 });
  }
  if (code === "P2003" || code === "P2014") {
    return NextResponse.json({ error: "这条记录还在被其它数据引用,请先解除关联" }, { status: 409 });
  }
  return NextResponse.json({ error: "服务器暂时开小差了,请稍后重试" }, { status: 500 });
}
