// 「今天该不该自动备份」的判定 —— 纯函数,零依赖,便于单测。
//
// 由来(2026-11-29 实测代码):客户端原先是这样写的
//     fetch("/api/backup/auto", { method: "POST" })
//       .then((response) => { localStorage.setItem(key, localDateString()); if (!response.ok) throw ... })
// 标记写在判断 `response.ok` **之前** —— 于是任何 HTTP 失败(500、会话过期 401、403)
// 都会把「今天已经备份过」记下来,今天再打开页面也不会重试:这一天家里就没有自动备份。
// 提示是说了(失败会 toast),但这一天的事实是**没了**,而备份正是出事时唯一能救回来的东西。
//
// 现在:只有**成功**才记「今天已完成」;失败记的是「今天这个时刻失败过」,
// 隔一段时间(默认 30 分钟)还会再试 —— 既不放弃这一天,也不会每次翻页都弹一次失败提示。
//
// 标记格式兼容旧版:旧值就是一个本地日期字符串(如 "2026-11-29"),按「当天已成功」处理。

/** 失败后多久再试一次。 */
export const AUTO_BACKUP_RETRY_MS = 30 * 60 * 1000;

export type AutoBackupMarker = {
  /** 最近一次**成功**备份的本地日期(YYYY-MM-DD) */
  lastSuccessDate: string | null;
  /** 最近一次**失败**发生在哪个本地日期 */
  lastFailureDate: string | null;
  /** 最近一次失败的时刻(epoch ms) */
  lastFailureAt: number | null;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const EMPTY_MARKER: AutoBackupMarker = { lastSuccessDate: null, lastFailureDate: null, lastFailureAt: null };

/** 读标记。认不出来的一律当空(宁可多试一次,也不要因为一段坏数据今天就再也不备份)。 */
export function parseAutoBackupMarker(raw: string | null | undefined): AutoBackupMarker {
  if (typeof raw !== "string" || raw.trim() === "") return { ...EMPTY_MARKER };
  const text = raw.trim();
  // 旧格式:就是一个日期字符串
  if (DATE_ONLY.test(text)) return { lastSuccessDate: text, lastFailureDate: null, lastFailureAt: null };
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const success = typeof parsed.lastSuccessDate === "string" && DATE_ONLY.test(parsed.lastSuccessDate) ? parsed.lastSuccessDate : null;
    const failureDate = typeof parsed.lastFailureDate === "string" && DATE_ONLY.test(parsed.lastFailureDate) ? parsed.lastFailureDate : null;
    const failureAt = typeof parsed.lastFailureAt === "number" && Number.isFinite(parsed.lastFailureAt) ? parsed.lastFailureAt : null;
    // 失败日期与失败时刻必须成对出现,否则这次冷却不成立(只留一半就当没有)
    return failureDate !== null && failureAt !== null
      ? { lastSuccessDate: success, lastFailureDate: failureDate, lastFailureAt: failureAt }
      : { lastSuccessDate: success, lastFailureDate: null, lastFailureAt: null };
  } catch {
    return { ...EMPTY_MARKER };
  }
}

export function serializeAutoBackupMarker(marker: AutoBackupMarker): string {
  return JSON.stringify(marker);
}

/**
 * 现在要不要发起一次自动备份?
 *
 * @param today 本地日期(YYYY-MM-DD);与文件名/服务端同一口径,不能用 UTC 日
 * @param now   当前时刻(epoch ms)
 * @param retryAfterMs 失败后重试间隔
 */
export function shouldAttemptAutoBackup(
  marker: AutoBackupMarker,
  today: string,
  now: number,
  retryAfterMs: number = AUTO_BACKUP_RETRY_MS,
): boolean {
  // 今天已经成功过一次:不必再发
  if (marker.lastSuccessDate === today) return false;
  // 今天失败过,而且还没到重试间隔:先等一等(否则每次翻页都弹一次失败提示)
  if (
    marker.lastFailureDate === today
    && marker.lastFailureAt !== null
    // 失败时刻在「未来」说明时钟被改动过 —— 别让它把今天永久卡住,照常重试
    && now >= marker.lastFailureAt
    && now - marker.lastFailureAt < retryAfterMs
  ) {
    return false;
  }
  return true;
}
