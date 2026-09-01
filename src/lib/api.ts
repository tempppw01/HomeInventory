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

export function apiError(error: unknown) {
  console.error(error);
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
  return NextResponse.json({ error: "服务器暂时开小差了，请稍后重试" }, { status: 500 });
}
