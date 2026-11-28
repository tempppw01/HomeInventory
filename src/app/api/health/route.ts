import { NextResponse } from "next/server";
import { SCHEMA_DRIFT_HINT, isSchemaDriftError } from "@/lib/schema-drift";
import { prisma } from "@/lib/prisma";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

// 健康检查顺带自报"我是哪个版本"。
//
// 起因:版本号在构建期被写进前端包,服务端任何接口都不说自己是哪一版 ——
// 于是发布出去的镜像无法自证版本,只能靠"我记得我刚才是从哪个提交构建的"。
// 2026-11-28 实测:本地 3001 跑着一个构建,界面显示 0.1.125 而 package.json 已是 0.1.126
// (先构建、后改版本号),界面上看不出任何异常,只有打开「关于」页才发现。
// 现在镜像冒烟可以直接问健康检查,比对"打标签的版本"与"镜像里的版本"。
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ status: "error", database: "disconnected", version: APP_VERSION }, { status: 503 });
  }
  // 连得上不代表结构对:升级时忘记同步库结构的话,连得通但所有业务接口都是 500。
  // 取一行(不带 select,会读所有列)就能立刻暴露「缺列」这件事。
  try {
    await prisma.item.findFirst();
  } catch (error) {
    if (isSchemaDriftError(error)) {
      return NextResponse.json({ status: "degraded", database: "schema-outdated", hint: SCHEMA_DRIFT_HINT, version: APP_VERSION }, { status: 503 });
    }
    throw error;
  }
  return NextResponse.json({ status: "ok", database: "connected", schema: "current", version: APP_VERSION });
}
