import { NextResponse } from "next/server";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { apiError, requireAdminUser } from "@/lib/api";
import { localDateString } from "@/lib/local-date";
import { BACKUP_KEEP, buildBackupPayload } from "@/lib/backup-payload";
import { autoBackupFileName, BACKUP_FILE_PATTERN, backupDir, backupFileGroup, databaseFingerprint, listBackupFiles, readBackupOrigin } from "@/lib/backup-files";

export const dynamic = "force-dynamic";

/** 自动备份的状态:界面上要能看出「它到底有没有在跑」。 */
export async function GET() {
  try {
    await requireAdminUser();
    const preference = await prisma.householdPreference.findUnique({ where: { id: "default" } });
    const files = await listBackupFiles();
    return NextResponse.json({
      lastAutoBackupAt: preference?.lastAutoBackupAt ?? null,
      keep: BACKUP_KEEP,
      files: files.length,
      // 完整清单:界面上的「从服务器上的备份恢复」要按它列出来
      fileNames: files,
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
    const dir = backupDir();
    await mkdir(dir, { recursive: true });
    // 名字可能带本库指纹:同一天已有**别的库**的备份占着朴素名时不能覆盖它(见 backup-files.ts 的文件头)。
    const fingerprint = databaseFingerprint();
    const target = path.join(dir, autoBackupFileName(today, fingerprint, await readBackupOrigin(path.join(dir, `home-inventory-${today}.json`))));
    // 负载里记下写它的库 —— 下一次(以及别的实例)据此判断这份备份能不能覆盖。
    await writeFile(target, JSON.stringify({ ...payload, database: fingerprint }, null, 2), "utf8");
    // 保留策略:只留最近 BACKUP_KEEP 份,否则备份目录会无上限增长(实测 10 天已 27 MB)。
    // 按库指纹分别保留,免得另一份实例的备份把本库的历史挤掉。
    const removed = await pruneOldBackups(dir, BACKUP_KEEP);
    await prisma.householdPreference.update({ where: { id: "default" }, data: { lastAutoBackupAt: new Date() } });
    await prisma.activityLog.create({ data: { action: "BACKUP_AUTO", userId: user.id, detail: `自动备份已保存：${path.basename(target)}` } });
    return NextResponse.json({ saved: true, file: path.basename(target), kept: BACKUP_KEEP, removed });
  } catch (error) { return apiError(error); }
}

/** 只留最近 keep 份自动备份(按文件名里的日期排序,新的在前);带库指纹的按指纹分别保留。
 *  返回删掉几份。 */
async function pruneOldBackups(dir: string, keep: number): Promise<number> {
  const names = (await readdir(dir)).filter((name) => BACKUP_FILE_PATTERN.test(name));
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const group = backupFileGroup(name);
    groups.set(group, [...(groups.get(group) ?? []), name]);
  }
  let removed = 0;
  for (const group of groups.values()) {
    for (const name of group.sort().reverse().slice(keep)) {
      await rm(path.join(dir, name), { force: true });
      removed += 1;
    }
  }
  return removed;
}
