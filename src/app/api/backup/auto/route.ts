import { NextResponse } from "next/server";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { apiError, requireAdminUser } from "@/lib/api";
import { localDateString } from "@/lib/local-date";
import { BACKUP_KEEP, buildBackupPayload } from "@/lib/backup-payload";

export const dynamic = "force-dynamic";

/** 自动备份的状态:界面上要能看出「它到底有没有在跑」。 */
export async function GET() {
  try {
    await requireAdminUser();
    const preference = await prisma.householdPreference.findUnique({ where: { id: "default" } });
    const backupDir = process.env.BACKUP_DIR || path.join(process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), "data"), "backups");
    let files: string[] = [];
    try {
      files = (await readdir(backupDir)).filter((name) => /^home-inventory-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
    } catch { files = []; }
    return NextResponse.json({
      lastAutoBackupAt: preference?.lastAutoBackupAt ?? null,
      keep: BACKUP_KEEP,
      files: files.length,
      latestFile: files.at(-1) ?? null,
    });
  } catch (error) { return apiError(error); }
}

export async function POST() {
  try {
    const user = await requireAdminUser();
    const preference = await prisma.householdPreference.upsert({ where: { id: "default" }, create: {}, update: {} });
    const today = localDateString();
    if (preference.lastAutoBackupAt && localDateString(preference.lastAutoBackupAt) === today) return NextResponse.json({ skipped: true });
    // 与手动导出共用同一份负载 —— 否则「每日自动备份」会比手动导出少东西(实测差在任务/盘点/偏好)。
    const payload = await buildBackupPayload(prisma);
    const backupDir = process.env.BACKUP_DIR || path.join(process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), "data"), "backups");
    await mkdir(backupDir, { recursive: true });
    const target = path.join(backupDir, `home-inventory-${today}.json`);
    await writeFile(target, JSON.stringify(payload, null, 2), "utf8");
    // 保留策略:只留最近 BACKUP_KEEP 份,否则备份目录会无上限增长(实测 10 天已 27 MB)。
    const removed = await pruneOldBackups(backupDir, BACKUP_KEEP);
    await prisma.householdPreference.update({ where: { id: "default" }, data: { lastAutoBackupAt: new Date() } });
    await prisma.activityLog.create({ data: { action: "BACKUP_AUTO", userId: user.id, detail: `自动备份已保存：${path.basename(target)}` } });
    return NextResponse.json({ saved: true, file: path.basename(target), kept: BACKUP_KEEP, removed });
  } catch (error) { return apiError(error); }
}

/** 只留最近 keep 份自动备份(按文件名里的日期排序,新的在前)。返回删掉几份。 */
async function pruneOldBackups(dir: string, keep: number): Promise<number> {
  const files = (await readdir(dir))
    .filter((name) => /^home-inventory-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();
  let removed = 0;
  for (const name of files.slice(keep)) {
    await rm(path.join(dir, name), { force: true });
    removed += 1;
  }
  return removed;
}
