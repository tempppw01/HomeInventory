import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireAdminUser } from "@/lib/api";
import { localDateString } from "@/lib/local-date";
import { buildBackupPayload } from "@/lib/backup-payload";

export const dynamic = "force-dynamic";

/** Export user data without credentials or AI/OSS secrets. */
export async function GET() {
  try {
    await requireAdminUser();
    // 与每日自动备份共用同一份负载(此前两条路径各写一套,已经漂开过)。
    const backup = await buildBackupPayload(prisma);
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename=home-inventory-backup-${localDateString()}.json`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
