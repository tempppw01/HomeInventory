// 「这份数据是多久之前的快照」—— 文案从组件里抽出来,纯函数、可单测。
//
// 为什么值得单独一个文件:这句话是**离线时用户唯一能判断数据新旧的东西**。
// 它写错(比如把 3 分钟说成「刚刚」)就等于让人拿旧数字当新鲜数据做决定 ——
// 那正是阶段 1 改掉旧 SW 取舍时给自己划的底线。
export type SnapshotAge = {
  /** 「3 分钟前的」/「刚刚同步的」/「本地缓存的」 */
  ageText: string;
  /** 「09:12」;拿不到有效时间时为 null(界面上就不要写这个括号) */
  clock: string | null;
};

export function offlineSnapshotLabel(lastSyncedAt: string | null, now = Date.now()): SnapshotAge {
  const synced = lastSyncedAt ? new Date(lastSyncedAt) : null;
  const valid = synced !== null && !Number.isNaN(synced.getTime());
  if (!valid) return { ageText: "本地缓存的", clock: null };
  const minutes = Math.max(0, Math.round((now - synced.getTime()) / 60_000));
  const ageText = minutes < 1 ? "刚刚同步的" : `${minutes} 分钟前的`;
  const clock = `${String(synced.getHours()).padStart(2, "0")}:${String(synced.getMinutes()).padStart(2, "0")}`;
  return { ageText, clock };
}
