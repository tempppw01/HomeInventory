// 探针账号该不该建在这个库上 —— 纯函数,单独可测。
//
// 背景(2026-11-28,只读实测):
//   家庭库 data/home-inventory.db 里躺着 leadcheck / viewcheck / rcvlead 三个账号
//   (2026-11-20 19:01 建的,用户自己从没建过),而它们的口令明文写在
//   scripts/make-probe-accounts.mjs 里。用 scrypt 对着库里的 passwordHash 复核:
//   三个口令**都能登录**(leadcheck 还是 ADMIN)。也就是说:任何读到这个仓库、
//   又能连上家里那台机器的人,都能用「仓库里写着的那句话」当管理员进这个家。
//
// 脚本本身当时没有任何判断 —— DATABASE_URL 指向哪个库,就往哪个库里 upsert。
// 这类后果不该由「记得别写错环境变量」来兜。
//
// 所以规则只有一条:**默认只认探针库**;真要在别的库上建(CI 的 MySQL 作业就是),
// 必须显式写下 ALLOW_PROBE_ACCOUNTS=1 —— 那是一个看得见的动作,而不是一次疏忽。

/**
 * 「看着就是一次性 / 测试用」的库名。
 * 前后都要求不是字母,免得把 latest.db、mytest.db 这类名字里的字母片段也当成探针库。
 */
const PROBE_DB_PATTERN = /(?:^|[^a-z])(probe|ci|empty|test|hygiene)(?:[^a-z]|$)/i;

/** 把连接串里的口令抹掉再打印:拒绝信息会进 CI 日志,不该顺手把口令抄一遍。 */
export function redactDatabaseUrl(databaseUrl) {
  return String(databaseUrl ?? "").replace(/(:\/\/[^:@/]+):[^@/]*@/, "$1:***@");
}

/**
 * @param {string | undefined | null} databaseUrl  进程里的 DATABASE_URL
 * @param {string | undefined | null} override     ALLOW_PROBE_ACCOUNTS 的值(只认 "1")
 * @returns {{ allowed: boolean, reason: string }}
 */
export function probeAccountTargetDecision(databaseUrl, override) {
  if (override === "1") return { allowed: true, reason: "已显式设置 ALLOW_PROBE_ACCOUNTS=1" };
  const url = String(databaseUrl ?? "").trim();
  if (!url) return { allowed: false, reason: "没有设 DATABASE_URL,不知道要往哪个库里建账号" };
  if (PROBE_DB_PATTERN.test(url)) return { allowed: true, reason: "库名看着是探针库" };
  return { allowed: false, reason: `这个库看着不是探针库(${redactDatabaseUrl(url)})` };
}
