// 「这份数据是多久之前的快照」—— 文案与判定都从组件里抽出来,纯函数、可单测。
//
// 为什么值得单独一个文件:这句话是**离线时用户唯一能判断数据新旧的东西**。
// 它写错(比如把 3 分钟说成「刚刚」)就等于让人拿旧数字当新鲜数据做决定 ——
// 那正是阶段 1 改掉旧 SW 取舍时给自己划的底线。
//
// 阶段 5 补的一课(真实浏览器实测抓到,不是推测):
// 断网后重新打开页面,数据是 SW 从缓存里拿的,而「上次同步」当时按**打开页面的那一刻**记 ——
// 实测:缓存是 06:33:53 拉的,06:39:20 断网重开,横幅写着「刚刚同步的数据快照(上次同步 14:39)」,
// 而那份数字其实已经旧了 5 分 27 秒。服务端抓取时刻一直躺在响应头里
// (public/sw.js 的 x-guiwu-cached-at,只打在缓存副本上),只是没人读。
// 所以判定收成三个纯函数:读戳、定时刻、说人话;组件与 provider 不再自己 new Date()。
export type SnapshotAge = {
  /** 「3 分钟前的」/「刚刚同步的」/「本地缓存的」 */
  ageText: string;
  /** 同一天:「09:12」;跨天时带日期「11-25 09:12」;拿不到有效时间时为 null(界面上就不要写这个括号) */
  clock: string | null;
};

/** SW 打在**缓存副本**上的戳:这些字节是什么时候真的从服务器下来的(见 public/sw.js)。 */
export const CACHED_AT_HEADER = "x-guiwu-cached-at";

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** 自然日之差(不是 24 小时数):昨晚 23:50 拉的,今早 00:10 看,差 1 天。 */
function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

/**
 * 从响应头里读「这份数据是什么时候从服务器拉到的」。
 *
 * 在线直连服务器时**没有**这个头(sw.js 只给缓存副本加),返回 null —— 那就代表「就是现在」。
 * 乱码/坏值也返回 null:宁可说「本地缓存的」,也不要拿一个读不准的时间冒充新鲜。
 */
export function cachedAtFromHeaders(headers: { get(name: string): string | null } | null | undefined): string | null {
  const time = parseTime(headers?.get(CACHED_AT_HEADER) ?? null);
  return time === null ? null : new Date(time).toISOString();
}

/**
 * 该把哪一刻记成「这份数据的新鲜时刻」。
 *
 * 在线直连 = 现在(我们自己拉到的);
 * 走缓存 = 那份缓存的**真实抓取时刻**。用户要判断的是「我看到的数字有多旧」,
 * 不是「我什么时候打开过页面」—— 断网久了这两个时刻能差好几个小时。
 */
export function syncedAtFromResponse(cachedAt: string | null | undefined, now: Date = new Date()): string {
  const time = parseTime(cachedAt ?? null);
  return time === null ? now.toISOString() : new Date(time).toISOString();
}

export function offlineSnapshotLabel(lastSyncedAt: string | null, now = Date.now()): SnapshotAge {
  const synced = lastSyncedAt ? new Date(lastSyncedAt) : null;
  const valid = synced !== null && !Number.isNaN(synced.getTime());
  if (!valid) return { ageText: "本地缓存的", clock: null };
  const nowDate = new Date(now);
  // 未来时间(时区/时钟偏差)按「刚刚」处理,不要显示「-3 分钟前的」这种怪话。
  const diffMs = Math.max(0, now - synced.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = calendarDaysBetween(synced, nowDate);
  // 分档顺序有意为之:不到 24 小时就说小时(比「昨天」精确);
  // 过了 24 小时才按自然日说「昨天 / N 天前」,再久就直接给日期 ——
  // 断网三天的人不该看到「4320 分钟前的数据快照」。
  const ageText = minutes < 1
    ? "刚刚同步的"
    : minutes < 60
      ? `${minutes} 分钟前的`
      : hours < 24
        ? `${hours} 小时前的`
        : days <= 1
          ? "昨天的"
          : days < 7
            ? `${days} 天前的`
            : `${synced.getMonth() + 1} 月 ${synced.getDate()} 日的`;
  const time = `${pad(synced.getHours())}:${pad(synced.getMinutes())}`;
  // 跨天的快照只写「09:12」会让人以为是今天的 —— 补上日期。
  const clock = days <= 0 ? time : `${synced.getMonth() + 1}-${synced.getDate()} ${time}`;
  return { ageText, clock };
}
