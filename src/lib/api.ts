import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function apiError(error: unknown) {
  console.error(error);
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message ?? "提交的数据不正确" },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: "服务器暂时开小差了，请稍后重试" }, { status: 500 });
}
