// 「离线 · 这是快照」横幅(阶段 1)。
//
// 为什么必须有它才允许发布:阶段 1 的 Service Worker 开始缓存 /api 响应了,
// 一旦没有这句标注,用户断网时会看到数据却**不知道那是旧的** —— 而那正是旧版 SW
// 注释里最担心的事(「家庭账目最忌讳拿旧数据做决定」)。底线没丢:
// 从「宁可什么都看不见」换成「看得见,但必须标明是快照,并说清是多久之前的」。
// 「多久之前」的算法在 lib/offline-snapshot 里,单独可测(说轻说重都不行)。
import { offlineSnapshotLabel } from "@/lib/offline-snapshot";

export function OfflineBanner({ lastSyncedAt, now }: { lastSyncedAt: string | null; now: number }) {
  const { ageText, clock } = offlineSnapshotLabel(lastSyncedAt, now);
  return (
    <div className="mb-4 rounded-2xl px-3 py-2 text-sm font-bold" style={{ background: "var(--warning-soft)", color: "var(--warning)" }} role="status">
      离线 · 显示的是 {ageText}数据快照{clock ? `(上次同步 ${clock})` : ""} · 恢复网络后会自动刷新
    </div>
  );
}
