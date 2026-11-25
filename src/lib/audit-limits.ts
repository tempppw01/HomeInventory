// 盘点数量的合理上界 —— 接口与「恢复备份」共用一份。
//
// 由来(实测,修之前):`POST /api/audits { total: 1000000000 }` 会被原样写进**永久**盘点历史,
// 界面上那条记录再也删不掉。接口侧于是加了上界。
//
// 但上界只加在接口上还不够:恢复备份是另一条写入路径,而且它面对的是**外部文件**
// (老版本导出的、手改过的、下载截断的),里面完全可能有 10 亿。
// 实测(修之前)恢复一份 `total: 1000000000, confirmed: 999999999` 的备份:
// 接口会拒绝的值,从备份里一路写进了库 —— 两处各说各话。
// 所以上界与夹取都收到这里,两边都从这里取。
export const MAX_AUDIT_COUNT = 1_000_000;

/** 数量是否落在合理范围(非负、有限、不超过上界) */
export function isAuditCount(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_AUDIT_COUNT;
}

/** 超出范围时给用户看的话(接口 400 与恢复里「跳过的原因」共用同一句) */
export function auditCountRangeMessage(): string {
  return `盘点数量超出合理范围(单次最多 ${MAX_AUDIT_COUNT.toLocaleString("zh-CN")} 件),请核对后重试`;
}

/**
 * 确认数不可能超过总数。
 * 夹取而不是拒绝:老版本可能写下 `confirmed > total`,那是一条**真实**盘点记录,
 * 丢掉它比把数字改小更糟。
 */
export function clampAuditConfirmed(total: number, confirmed: number): number {
  if (!Number.isFinite(confirmed) || confirmed < 0) return 0;
  return Math.min(Math.round(confirmed), Math.round(total));
}