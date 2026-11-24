import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { canAdmin, canWrite, requireUser } from "@/lib/account-auth";
import { SCHEMA_DRIFT_HINT, isSchemaDriftError } from "@/lib/schema-drift";

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
  // 图片处理失败属于「客户端给的图有问题」,不是服务器故障:
  // 这类错误带着明确的中文原因(格式不支持 / 太大 / 无法处理),要原样返回 400,
  // 否则用户只会看到「服务器暂时开小差了」,不知道换一张图就好。
  if (error instanceof Error && error.name === "AiImageError") {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  // 先判定再决定是否记录:预期内的客户端错误不该刷日志(否则真实故障会被淹没)。
  const knownStatus = (() => {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return 401;
    if (error instanceof Error && error.message === "FORBIDDEN") return 403;
    if (error instanceof ZodError || error instanceof SyntaxError) return 400;
    const code = prismaCode(error);
    if (code === "P2025") return 404;
    if (code === "P2002" || code === "P2003" || code === "P2014") return 409;
    // P2034 = 死锁 / 写冲突。写事务里已经带重试(src/lib/write-retry),走到这里说明重试也没躲开,
    // 那不是「服务器坏了」,而是「刚才撞得太狠」—— 明确回 409 让用户再点一次,别丢一个 500。
    if (code === "P2034") return 409;
    return null;
  })();
  // 库结构比应用旧(升级时忘了同步):不是临时故障,必须说清怎么解决,别让用户反复刷新。
  if (isSchemaDriftError(error)) {
    console.error("[schema] 数据库结构与应用不一致:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: SCHEMA_DRIFT_HINT, code: "SCHEMA_OUTDATED" }, { status: 503 });
  }
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
  if (code === "P2034" || /deadlock|lock wait timeout|database is locked/i.test(error instanceof Error ? error.message : "")) {
    // 并发写同一行撞车:重试已经试过了,还是撞上就如实说「刚才撞得太狠,请再试一次」。
    return NextResponse.json({ error: "这一下刚好有别的操作在改同一件东西,请再点一次", code: "WRITE_CONFLICT" }, { status: 409 });
  }
  return NextResponse.json({ error: "服务器暂时开小差了,请稍后重试" }, { status: 500 });
}
