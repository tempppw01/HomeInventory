// 自动备份落盘的那份文件(目录解析 + 文件名规则)只留一处。
//
// 由来:目录解析此前在 auto 路由里写了两遍;而「从服务器上的备份恢复」这个新入口
// 必须和写入端**完全同一份规则**,否则会出现「明明有备份却恢复不了」。
// 同时这里只认 `home-inventory-YYYY-MM-DD.json` 这种纯文件名,天然挡掉路径穿越。

import { readdir } from "node:fs/promises";
import path from "node:path";

/** 自动备份目录(与 docker 部署里的 /app/data/backups 对齐)。 */
export function backupDir() {
  return process.env.BACKUP_DIR || path.join(process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), "data"), "backups");
}

/** 只认这种名字:不含路径分隔符、不含 ..,恢复入口据此挡路径穿越。 */
export const BACKUP_FILE_PATTERN = /^home-inventory-\d{4}-\d{2}-\d{2}\.json$/;

export function isBackupFileName(name: unknown): name is string {
  return typeof name === "string" && BACKUP_FILE_PATTERN.test(name.trim());
}

/** 目录里现有的备份文件名(按日期升序)。目录不存在时返回空数组。 */
export async function listBackupFiles(): Promise<string[]> {
  try {
    return (await readdir(backupDir())).filter((name) => BACKUP_FILE_PATTERN.test(name)).sort();
  } catch {
    return [];
  }
}