/**
 * 完整备份的大小上限 —— 界面与 next.config 共用这一份,避免两处各写一个数。
 *
 * 为什么必须显式设置:恢复请求要经过 proxy,而 Next 的 `experimental.proxyClientMaxBodySize`
 * **默认 10 MB**。实测:3.1 MB 能恢复,10.2 MB 返回 400,而且被包装成 SyntaxError,
 * 用户看到的是「请求内容不是合法的 JSON」—— 文件明明是合法的。
 * 导出体积会随数据增长(本机 39190 条活动记录的备份已经是 14 MB),所以上限必须留足余量。
 */
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

/** 给人看的体积(1 位小数 MB) */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 文件过大时的说明 —— 要能照做,不能只说「失败」 */
export function backupTooLargeMessage(bytes: number, limit = MAX_BACKUP_BYTES): string {
  return `这个备份文件 ${formatBytes(bytes)} 超过了服务端上限 ${formatBytes(limit)}。请把上限调高(部署配置里的 proxyClientMaxBodySize)后重试,或改用分次导出的方式迁移数据。`;
}
