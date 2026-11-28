// 自动备份落盘的那份文件(目录解析 + 文件名规则)只留一处。
//
// 由来:目录解析此前在 auto 路由里写了两遍;而「从服务器上的备份恢复」这个新入口
// 必须和写入端**完全同一份规则**,否则会出现「明明有备份却恢复不了」。
// 同时这里只认 `home-inventory-YYYY-MM-DD.json` 这种纯文件名,天然挡掉路径穿越。
//
// 又一层由来(v0.1.136,实测):文件名里**没有库的标识**,而 BACKUP_DIR 是环境给的、
// 一天又只有一个名字。同一台机器上跑第二份实例(探针库、另一份家庭库)而目录没分开时,
// 后备份的那份会**静默覆盖**前一份 —— 实测家庭库 2026-11-28 的那份被探针库顶掉
// (家庭库 9 件物品 → 变成探针库的 15 件「界面检查·…」),而且从文件名上完全看不出来。
// 所以现在:备份负载里记下写它的库的指纹;同一天已有**别的库**(或来历不明的老文件)
// 占着朴素名时,本库另存为 `home-inventory-YYYY-MM-DD-<指纹>.json`,绝不覆盖别人的那份。

import { createHash } from "node:crypto";
import { open, readFile, readdir } from "node:fs/promises";
import path from "node:path";

// 源码里统一写 `@/lib/xxx`(tsconfig 是 moduleResolution: bundler);
// 顺带一个好处:单测的别名钩子认得它,而相对路径 + 省扩展名在 `node --test` 下会解析失败。
import { backupFileFingerprint } from "@/lib/backup-label";

/** 自动备份目录(与 docker 部署里的 /app/data/backups 对齐)。 */
export function backupDir() {
  return process.env.BACKUP_DIR || path.join(process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), "data"), "backups");
}

/**
 * 只认这种名字:不含路径分隔符、不含 `..`,恢复入口据此挡路径穿越。
 * `-<6 位十六进制库指纹>` 后缀是可选的(见文件头注释)。
 */
export const BACKUP_FILE_PATTERN = /^home-inventory-\d{4}-\d{2}-\d{2}(?:-[0-9a-f]{6})?\.json$/;

/** 名字里的库指纹(朴素名与老文件没有 → 空串)。同一份目录里按它分组保留,多实例互不挤占。 */
export function backupFileGroup(name: string): string {
  return backupFileFingerprint(name) ?? "";
}

export function isBackupFileName(name: unknown): name is string {
  return typeof name === "string" && BACKUP_FILE_PATTERN.test(name.trim());
}

/** 目录里现有的备份文件名(按名字升序,也就按日期升序)。目录不存在时返回空数组。 */
export async function listBackupFiles(): Promise<string[]> {
  try {
    return (await readdir(backupDir())).filter((name) => BACKUP_FILE_PATTERN.test(name)).sort();
  } catch {
    return [];
  }
}

/**
 * 库指纹:DATABASE_URL 的短哈希 —— 同一份库永远同一个值,不同库(含探针库)不同。
 * 故意取哈希而不是原串:备份文件里/界面上都不该出现连接串(它带着口令)。
 */
export function databaseFingerprint(databaseUrl: string | undefined = process.env.DATABASE_URL): string {
  return createHash("sha256").update(String(databaseUrl ?? "(未设置)")).digest("hex").slice(0, 6);
}

export type BackupOrigin = { exists: boolean; database: string | null };

/**
 * 看一份备份是哪个库写的。
 * 文件不在 → `{exists:false}`;读不动 / 不是 JSON / 老文件里没有这个字段 → `database: null`
 * (老备份没有指纹,只能当「不是本库的」,见 autoBackupFileName)。
 */
export async function readBackupOrigin(file: string): Promise<BackupOrigin> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { exists: false, database: null };
  }
  try {
    const parsed = JSON.parse(text) as { database?: unknown };
    return { exists: true, database: typeof parsed.database === "string" ? parsed.database : null };
  } catch {
    return { exists: true, database: null };
  }
}

/**
 * 今天这份备份该写哪个名字。
 * · 空位 → 朴素名(与历史行为一致,`home-inventory-2026-11-28.json`);
 * · 今天这份本来就是本库写的 → 还是朴素名(覆盖自己的没问题);
 * · 今天这份是别的库写的(或老文件/读不动,都算「不是本库的」)→ 带本库指纹另存,
 *   原文件一个字节都不动 —— 宁可与别人并存,也不静默毁掉别人的当日备份。
 */
export function autoBackupFileName(today: string, fingerprint: string, origin: BackupOrigin): string {
  if (!origin.exists || origin.database === fingerprint) return `home-inventory-${today}.json`;
  return `home-inventory-${today}-${fingerprint}.json`;
}

/**
 * 只读文件**末尾**那点字节,把库指纹认出来(`database` 是负载的最后一个键)。
 *
 * 为什么需要它:文件名里**没有**后缀的那种备份,光看名字只能标成「未标明来源」——
 * 可实测就撞上了这种情形:同一个目录里,先写的那份占着朴素名(B 库看 A 库这份,
 * 名字上什么都没写),而文件内容里明明记着 A 的指纹。读整个文件太贵(一份 2~3 MB ×  十几份,
 * 每次打开设置页都要读),所以只读尾巴 256 字节:136 起的备份把 `database` 写在最后,
 * 升级前的老备份尾巴上则只有 `]` 和 `}`,自然认不出来(标「未标明来源」是对的)。
 */
export async function readBackupTailOrigin(file: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(file, "r");
    const { size } = await handle.stat();
    if (!size) return null;
    const length = Math.min(256, size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return /"database"\s*:\s*"([0-9a-f]{6})"/.exec(buffer.toString("utf8"))?.[1] ?? null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** 一份备份的库指纹:先看文件名里的后缀,没有就看文件内容(见 readBackupTailOrigin)。 */
export async function resolveBackupFingerprint(file: string, name: string): Promise<string | null> {
  return backupFileFingerprint(name) ?? (await readBackupTailOrigin(file));
}

/** 只给「名字里没写来源」的那几份去读内容 —— 名字里已经带着指纹的不必碰磁盘。 */
export async function collectFileOrigins(names: string[], dir = backupDir()): Promise<Record<string, string | null>> {
  const origins: Record<string, string | null> = {};
  for (const name of names) {
    if (backupFileFingerprint(name)) continue;
    origins[name] = await readBackupTailOrigin(path.join(dir, name));
  }
  return origins;
}
