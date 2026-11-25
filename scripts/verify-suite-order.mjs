// CI 步骤顺序的隐式依赖:从**源码**派生,不靠记忆、也不维护易过期的表。
//
// 两次真实事故:
//   1 `verify-ai-guards` 排在 `verify-login-rate-limit` 之后 —— 后者故意打满登录额度,
//      前者第一步就是登录,于是等了 518 秒(api 作业从 2 分钟涨到 11 分钟);
//   2 需要只读/成员账号的套件排在「建号」之前 —— 账号还不存在,只能 403 / 登录失败。
//
// 判定方式(线号比较,兼容 `run: node x.mjs` 与 `run: |` 多行块):
//   · 「需要账号」= 源码里既有 viewcheck/rcvlead/PROBE_VIEWER/PROBE_MEMBER,**且**真的会登录
//     (出现 loginCookie / auth/login)—— 只"提到"这些名字的静态检查不算;
//   · 「建号步骤」= 该作业文本里出现 make-probe-accounts 的那一行;
//   · 「打满额度的套件」= verify-login-rate-limit,必须是该作业最后一个套件步骤。
//
// 用法:node scripts/verify-suite-order.mjs   (纯静态,不需要起服务)

import { readFileSync } from "node:fs";

const CI = ".github/workflows/ci.yml";
const RATE_LIMIT_SUITE = "verify-login-rate-limit";
const VIEWER_NAMES = /viewcheck|rcvlead|PROBE_VIEWER|PROBE_MEMBER/;
const LOGS_IN = /loginCookie|auth\/login/;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const lines = readFileSync(CI, "utf8").split(/\r?\n/);

/** [{ job, start, end }] —— 每个作业的行范围 */
const jobRanges = [];
lines.forEach((line, index) => {
  const job = line.match(/^ {2}([a-z][\w-]*):\s*$/);
  if (job) {
    if (jobRanges.length) jobRanges[jobRanges.length - 1].end = index;
    jobRanges.push({ job: job[1], start: index, end: lines.length });
  }
});

/** 该行范围里跑过的套件:行号 + 名字 */
const suiteCalls = (range) => {
  const calls = [];
  for (let index = range.start; index < range.end; index += 1) {
    const match = lines[index].match(/scripts\/([\w-]+)\.mjs/);
    if (match) calls.push({ line: index, script: match[1] });
  }
  return calls;
};

const allCalls = jobRanges.flatMap((range) => suiteCalls(range));
check("扫到了足够多的套件步骤(防止空跑)", allCalls.length > 30, `调用数=${allCalls.length},作业数=${jobRanges.length}`);

/** 这个套件是否真的需要只读/成员账号(既有名字、又会登录) */
const needsProbeAccounts = (script) => {
  try {
    const text = readFileSync(`scripts/${script}.mjs`, "utf8");
    return VIEWER_NAMES.test(text) && LOGS_IN.test(text);
  } catch {
    return false;
  }
};

// ---------- 规则 1:需要探针账号的套件必须排在建号步骤之后 ----------
{
  const offenders = [];
  for (const range of jobRanges) {
    const accountLine = lines.findIndex((line, index) => index >= range.start && index < range.end && line.includes("make-probe-accounts"));
    for (const call of suiteCalls(range)) {
      if (!needsProbeAccounts(call.script)) continue;
      if (accountLine < 0) offenders.push(`${range.job}/${call.script}(该作业没有建号步骤)`);
      else if (call.line < accountLine) offenders.push(`${range.job}/${call.script}(第 ${call.line + 1} 行,在建号之前)`);
    }
  }
  check("需要只读/成员账号的套件都排在 make-probe-accounts 之后", offenders.length === 0, offenders.join(" | "));
}

// ---------- 规则 2:会打满登录额度的套件必须是该作业最后一个套件步骤 ----------
{
  const offenders = [];
  for (const range of jobRanges) {
    const calls = suiteCalls(range);
    const index = calls.findIndex((call) => call.script === RATE_LIMIT_SUITE);
    if (index < 0) continue;
    const after = calls.slice(index + 1).map((call) => call.script);
    if (after.length) offenders.push(`${range.job}: 后面还有 ${after.join(",")}`);
  }
  check(`${RATE_LIMIT_SUITE} 没有排在别的套件之前(否则对方要等几分钟的限流窗口)`, offenders.length === 0, offenders.join(" | "));
  check("这个套件确实在 CI 里跑(防止规则空转)", allCalls.some((call) => call.script === RATE_LIMIT_SUITE), "CI 里没有它,规则等于没写");
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);