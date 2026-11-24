// 登录限流的验收:它到底挡得住什么、挡不住什么。
//
// 由来(实测,修之前):
//   同一来源连续登录 15 次 → 第 13 次起 429(限流本身是好的);
//   **每个请求换一个 X-Forwarded-For → 15 次全部放行,0 次被拦** —— 因为来源取的是 XFF 的
//   最左值,而那个位置客户端可以随便写。直连部署(NAS / docker 端口映射)等于没有限流。
//
// 现在两条规则 + 两条如实记录:
//   1 同一来源:12 次/分钟;
//   2 同一账号:10 次/分钟(与来源无关 —— 换来源也拦得住);
//   3 换一个账号不该被连累(家人/多账号正常使用);
//   4 **如实记录残余风险**:同时换来源 + 换用户名仍能绕过(要挡住它得引入全局限流或强制走代理)。
//
// 注意:这个套件会故意打满限流窗口(60 秒),CI 里必须排在**最后**,否则后面的套件登录会被限流。
//
// 用法:BASE_URL=... node scripts/verify-login-rate-limit.mjs

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const attempt = async ({ username, forwarded, password = "wrong-password-for-probe" }) => {
  const headers = { "content-type": "application/json" };
  if (forwarded) headers["x-forwarded-for"] = forwarded;
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers, body: JSON.stringify({ username, password }) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, retryAfter: res.headers.get("retry-after") };
};

const STAMP = Date.now().toString(36).slice(-5);
const victim = `rate-${STAMP}`;          // 一个不存在的账号名:用来量"按账号"那一层
const neighbour = `rate-${STAMP}-b`;

// ---------- 1 同一来源:12 次/分钟 ----------
{
  const forwarded = "203.0.113.200";
  const statuses = [];
  for (let index = 0; index < 14; index += 1) statuses.push((await attempt({ username: `same-${STAMP}-${index}`, forwarded })).status);
  const blocked = statuses.filter((status) => status === 429).length;
  check("同一来源连续登录会被拦(12 次/分钟)", blocked >= 1 && statuses[12] === 429, `statuses=${statuses.join(",")}`);
}

// ---------- 2 换来源打同一个账号:按账号那一层要拦住 ----------
{
  const statuses = [];
  for (let index = 0; index < 14; index += 1) statuses.push((await attempt({ username: victim, forwarded: `198.51.100.${index + 1}` })).status);
  const blocked = statuses.filter((status) => status === 429).length;
  check("每个请求换一个 X-Forwarded-For,打同一个账号也会被拦(修之前 0 次)", blocked >= 1, `statuses=${statuses.join(",")}`);
}

// ---------- 3 换一个账号不该被连累 ----------
{
  const first = await attempt({ username: neighbour, forwarded: "192.0.2.50" });
  check("另一个账号不受刚才那轮限流影响(401 而不是 429)", first.status === 401, `status=${first.status} ${JSON.stringify(first.body?.error ?? "").slice(0, 60)}`);
}

// ---------- 4 不泄露账号是否存在 ----------
{
  const unknown = await attempt({ username: `no-such-user-${STAMP}`, forwarded: "192.0.2.60" });
  const wrongPassword = await attempt({ username: neighbour, forwarded: "192.0.2.61" });
  check(
    "不存在的用户名与密码错误返回同一句话(不泄露账号是否存在)",
    unknown.status === wrongPassword.status && String(unknown.body?.error ?? "") === String(wrongPassword.body?.error ?? ""),
    `${unknown.status} ${JSON.stringify(unknown.body?.error)} / ${wrongPassword.status} ${JSON.stringify(wrongPassword.body?.error)}`,
  );
}

// ---------- 5 全局层:同时换来源 + 换用户名也要被拦住 ----------
// 前两层(来源 / 账号)都依赖「一个能区分请求的维度」,攻击者两个都换就能绕开。
// 第三层与请求内容无关,专门挡这种轮换(与「重置密码」接口的三层做法一致)。
// 注意:这一轮会把全局桶打满(10 分钟窗口),所以本套件必须排在最后;重启服务即清空(计数在进程内存里)。
{
  const statuses = [];
  for (let index = 0; index < 130; index += 1) {
    const result = await attempt({ username: `ghost-${STAMP}-${index}`, forwarded: `10.9.${index % 250}.${(index % 200) + 1}` });
    statuses.push(result.status);
    if (result.status === 429) break;
  }
  const blockedAt = statuses.findIndex((status) => status === 429);
  check("同时换来源 + 换用户名,轮换到一定次数也会被全局那层拦住", blockedAt >= 0, `尝试 ${statuses.length} 次仍未拦住(前 12 次:${statuses.slice(0, 12).join(",")})`);
  console.log(`INFO  全局层在第 ${blockedAt >= 0 ? blockedAt + 1 : "(未触发)"} 次尝试时拦下;这个套件会占满全局桶(10 分钟),CI 里必须排最后。`);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);