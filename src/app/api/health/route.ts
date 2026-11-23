import { NextResponse } from "next/server";
import { SCHEMA_DRIFT_HINT, isSchemaDriftError } from "@/lib/schema-drift";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ status: "error", database: "disconnected" }, { status: 503 });
  }
  // 连得上不代表结构对:升级时忘记同步库结构的话,连得通但所有业务接口都是 500。
  // 取一行(不带 select,会读所有列)就能立刻暴露「缺列」这件事。
  try {
    await prisma.item.findFirst();
  } catch (error) {
    if (isSchemaDriftError(error)) {
      return NextResponse.json({ status: "degraded", database: "schema-outdated", hint: SCHEMA_DRIFT_HINT }, { status: 503 });
    }
    throw error;
  }
  return NextResponse.json({ status: "ok", database: "connected", schema: "current" });
}
