import { NextResponse } from "next/server";
import { requireUser } from "@/lib/account-auth";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser();
    const databaseUrl = process.env.DATABASE_URL || "";
    const provider = process.env.DATABASE_PROVIDER || (databaseUrl.startsWith("mysql:") ? "mysql" : "sqlite");
    return NextResponse.json({
      databaseProvider: provider,
      databaseLabel: provider === "mysql" ? "MySQL" : "SQLite",
      storageMode: provider === "mysql" ? "独立数据库服务" : "本地持久化文件",
    });
  } catch (error) {
    return apiError(error);
  }
}
