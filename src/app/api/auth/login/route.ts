import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ACCOUNT_COOKIE, createSession, verifyPassword } from "@/lib/account-auth";
import { recordLoginAttempt } from "@/lib/login-record";
import { clientAddress, rateLimit, resetRateLimit } from "@/lib/rate-limit";

function requestIp(request: NextRequest) {
  // 与 clientAddress 同一套规则:取**最右**值(代理追加的那一跳),不取客户端可伪造的最左值。
  return request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean).at(-1) || request.headers.get("x-real-ip")?.trim() || null;
}

/** 失败才计数:IP / 账号 / 全局三层各记一次。成功登录不计数(攻击的特征是反复失败)。 */
function recordFailedAttempt(ip: string, username: string) {
  rateLimit(`login:${ip}`, 12, 60_000);
  rateLimit(`login-user:${username || "(空)"}`, 10, 60_000);
  rateLimit("login:global", 120, 10 * 60_000);
}

export async function POST(request: NextRequest) {
  const ip = clientAddress(request);
  const guard = rateLimit(`login:${ip}`, 12, 60_000, { increment: false });
  if (!guard.ok) return NextResponse.json({ error: `尝试次数过多，请 ${guard.retryAfter} 秒后再试` }, { status: 429, headers: { "Retry-After": String(guard.retryAfter) } });
  const body = await request.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  // 按**账号**再限一次:与来源无关。
  // 实测:只按 IP 限流时,攻击者每次换一个 X-Forwarded-For 就能无限猜(连续 15 次 0 次被拦);
  // 直连部署(NAS / docker 端口映射)下 XFF 完全是客户端说了算。按账号计数后,
  // 换来源也只能每分钟试固定的次数 —— 这是「同一个账号」这道门真正挡得住的维度。
  // 允许的余量比 IP 松一些(家人重试密码、或几个人同时登录同一账号)。
  const accountGuard = rateLimit(`login-user:${username || "(空)"}`, 10, 60_000, { increment: false });
  if (!accountGuard.ok) return NextResponse.json({ error: `这个账号的尝试次数过多,请 ${accountGuard.retryAfter} 秒后再试` }, { status: 429, headers: { "Retry-After": String(accountGuard.retryAfter) } });
  // 第三层:全局。前两层都依赖「一个能区分请求的维度」(来源 / 账号),而攻击者**同时换来源与用户名**
  // 就能把两层都绕开(实测 12 次 0 次被拦)。这一层与请求内容无关,所以它挡得住那种轮换,
  // 做法与「重置密码」接口(按 IP / 按账号 / 全局三层)保持一致。
  // 代价是共享的:持续攻击会让所有人登录慢一拍 —— 与重置接口一样,这个取舍是显式接受的;
  // 阈值按家庭用量留足余量(10 分钟 120 次 ≈ 平均 12 次/分钟,家用远达不到)。
  const globalGuard = rateLimit("login:global", 120, 10 * 60_000, { increment: false });
  if (!globalGuard.ok) return NextResponse.json({ error: `登录尝试过于频繁,请 ${globalGuard.retryAfter} 秒后再试` }, { status: 429, headers: { "Retry-After": String(globalGuard.retryAfter) } });
  // "记住我" 关闭时使用浏览器会话 Cookie，关闭浏览器即失效；开启时保持 30 天。
  const remember = body.remember !== false;
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    recordFailedAttempt(ip, username);
    await recordLoginAttempt(request, { username, success: false, failureReason: "用户名不存在" });
    return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
  }
  if (!user.active) {
    recordFailedAttempt(ip, username);
    await recordLoginAttempt(request, { userId: user.id, username, success: false, failureReason: "账号已停用" });
    return NextResponse.json({ error: "账号已停用" }, { status: 401 });
  }
  if (!verifyPassword(password, user.passwordHash)) {
    recordFailedAttempt(ip, username);
    await recordLoginAttempt(request, { userId: user.id, username, success: false, failureReason: "密码错误" });
    return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
  }
  const token = await createSession(user.id, { userAgent: request.headers.get("user-agent"), ipAddress: requestIp(request) }, { days: remember ? undefined : 1 });
    // 密码已验证:这个账号之前的失败计数清零(别让正常用户被自己早先的误输拖住)。
    resetRateLimit(`login-user:${username}`);
  await recordLoginAttempt(request, { userId: user.id, username, success: true });
  const response = NextResponse.json({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
  response.cookies.set(ACCOUNT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}), path: "/" });
  return response;
}
