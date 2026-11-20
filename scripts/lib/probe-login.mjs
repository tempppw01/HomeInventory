// Node 侧验收脚本共用的登录:Cookie 会话 + 限速重试。
//
// 为什么需要:登录接口限速 12 次/分钟/IP,而 api 作业里排了十多个套件,
// 每个都要登录一次 —— 排在后面的套件很容易拿到 429,
// 表现出来却是「登录成功 → status=429」这种看起来像故障的失败。
//
// 用法:
//   import { loginCookie } from "./lib/probe-login.mjs";
//   const cookie = await loginCookie(BASE, USER, PASS);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 登录并返回 Cookie 头。遇到 429 时按 Retry-After 等待重试。
 * @returns {Promise<string>} cookie(失败时抛出)
 */
export async function loginCookie(base, user, pass, attempts = 8) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: user, password: pass }),
    });

    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? 10);
      lastStatus = 429;
      console.log(`      登录限速,等待 ${wait} 秒后重试(${attempt + 1}/${attempts})`);
      await sleep((wait + 1) * 1000);
      continue;
    }

    if (!response.ok) {
      lastStatus = response.status;
      throw new Error(`登录失败:status=${response.status}`);
    }

    const cookie = (response.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
    if (!cookie) throw new Error("登录成功但没有拿到 Cookie");
    return cookie;
  }
  throw new Error(`登录持续被限速(status=${lastStatus}),请稍后再试或降低并发`);
}
