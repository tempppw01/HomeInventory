/**
 * 「从服务器上的备份恢复」下拉里那一行显示成什么。
 *
 * 为什么单独一个文件:这个函数要在**客户端组件**里用(data-tools.tsx),而它的兄弟
 * `src/lib/backup-files.ts` 引了 `node:fs/promises` 与 `node:crypto` —— 那个进不了浏览器包。
 * 这里只做字符串解析,没有任何依赖。
 *
 * 由来(实测):自动备份文件名里的 6 位十六进制是「写这份备份的库」的指纹,可界面上原来
 * 只列文件名(`home-inventory-2026-11-28-8a4396.json`),看着像随机后缀 —— 而家庭库那份
 * 当日备份被同一台机器上的探针实例顶掉过,当时从界面上完全看不出哪份是谁写的。
 * 所以翻成人话:本机 / 另一份库(指纹) / 未标明来源(名字和内容都没写来源的老备份)。
 */

/** 从文件名里取日期部分(认不出就原样返回,宁可难懂也不要编)。 */
export function backupFileDate(name: string): string {
  return /^home-inventory-(\d{4}-\d{2}-\d{2})/.exec(name)?.[1] ?? name;
}

/** 从文件名里取库指纹(没有 → null)。 */
export function backupFileFingerprint(name: string): string | null {
  return /-([0-9a-f]{6})\.json$/.exec(name)?.[1] ?? null;
}

/**
 * 一条备份的库指纹:文件名里的后缀优先,没有就用服务端从**内容**里认出来的那个。
 *
 * 为什么两处都要看(实测):同一个目录里先写的那份占着朴素名(`home-inventory-2026-11-28.json`),
 * 名字上什么都没写,可内容里记着写它的那个库 —— 只看名字会把「另一份库的备份」标成
 * 「未标明来源」,而这一版修的正是「看不出是谁写的」。
 */
export function backupFileSourceFingerprint(name: string, contentOrigins?: Record<string, string | null> | null): string | null {
  return backupFileFingerprint(name) ?? contentOrigins?.[name] ?? null;
}

export function backupFileOptionLabel(name: string, fingerprint: string | null, myFingerprint: string): string {
  const date = backupFileDate(name);
  if (!fingerprint) return `${date} · 未标明来源`;
  return fingerprint === myFingerprint ? `${date} · 本机` : `${date} · 另一份库(${fingerprint})`;
}
