import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { apiError, requireAdminUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user = await requireAdminUser();
    const preference = await prisma.householdPreference.upsert({ where: { id: "default" }, create: {}, update: {} });
    const today = new Date().toISOString().slice(0, 10);
    if (preference.lastAutoBackupAt?.toISOString().slice(0, 10) === today) return NextResponse.json({ skipped: true });
    const [items, locations, shopping, priceRecords, members, activities] = await Promise.all([
      prisma.item.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.location.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.shoppingItem.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.priceRecord.findMany({ orderBy: { purchasedAt: "asc" } }),
      prisma.householdMember.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.activityLog.findMany({ orderBy: { createdAt: "asc" } }),
    ]);
    const backupDir = process.env.BACKUP_DIR || path.join(process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), "data"), "backups");
    await mkdir(backupDir, { recursive: true });
    const target = path.join(backupDir, `home-inventory-${today}.json`);
    await writeFile(target, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items, locations, shopping, priceRecords, members, activities }, null, 2), "utf8");
    await prisma.householdPreference.update({ where: { id: "default" }, data: { lastAutoBackupAt: new Date() } });
    await prisma.activityLog.create({ data: { action: "BACKUP_AUTO", userId: user.id, detail: `自动备份已保存：${path.basename(target)}` } });
    return NextResponse.json({ saved: true, file: path.basename(target) });
  } catch (error) { return apiError(error); }
}
