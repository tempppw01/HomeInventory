import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/account-auth";
import { generateRecoveryCode, isRecoveryCodeShape, normalizeRecoveryCode } from "@/lib/recovery-code";
import { hashRecoveryCode } from "@/lib/recovery-hash";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import { recordLoginAttempt } from "@/lib/login-record";
import { recoveryResetSchema } from "@/lib/validation";
import { apiError } from "@/lib/api";

// 与登录密码同长的“假”哈希:账号不存在或还没设恢复码时也跑一次 scrypt,
// 让“用户名不存在”和“恢复码不对”在耗时与响应上无法区分。
const DUMMY_HASH = `${"0".repeat(32)}:${"0".repeat(128)}`;

/**
 * 公开接口:用一次性恢复码重置密码(这就是「忘记密码」的服务端实现)。
 * - 账号不存在、未设置恢复码、恢复码错误 → 同样的 401 与同样的提示;
 * - 成功后立刻轮换恢复码(旧码作废)并踢掉该账号的所有登录会话;
 * - 三重限流:按 IP、按用户名、以及全局总量(见下方注释)。
 */
export async function POST(request: NextRequest) {
  const ipGuard = rateLimit(`recovery-reset:${clientAddress(request)}`, 10, 10 * 60_000);
  if (!ipGuard.ok) return NextResponse.json({ error: `当前网络尝试次数过多,请 ${ipGuard.retryAfter} 秒后再试` }, { status: 429, headers: { "Retry-After": String(ipGuard.retryAfter) } });
  // `clientAddress` 优先读 X-Forwarded-For,而反向代理没剥离该头时可以伪造,
  // 所以再加一道与来源无关的全局上限,避免用换 IP 的方式无限试探。
  const globalGuard = rateLimit("recovery-reset:global", 60, 10 * 60_000);
  if (!globalGuard.ok) return NextResponse.json({ error: `服务器正忙,请 ${globalGuard.retryAfter} 秒后再试` }, { status: 429, headers: { "Retry-After": String(globalGuard.retryAfter) } });

  let payload: { username: string; code: string; password: string };
  try {
    payload = recoveryResetSchema.parse(await request.json());
  } catch (error) {
    return apiError(error);
  }

  // 形状校验只与「用户敲进来的字符」有关,不涉及账号是否存在,所以可以直接给
  // 明确的格式提示(常见的 I/O/0/1 与位数不够都能当场纠正),不算信息泄露。
  if (!isRecoveryCodeShape(payload.code)) {
    return NextResponse.json({ error: "恢复码应为 16 位字母数字(不含 I、O、0、1),请对照保存的记录重新输入" }, { status: 400 });
  }

  // 这一重按用户名计数,不受伪造 X-Forwarded-For 影响,是防定向爆破的主控制。
  const userGuard = rateLimit(`recovery-reset-user:${payload.username}`, 5, 10 * 60_000);
  if (!userGuard.ok) return NextResponse.json({ error: `该账号尝试次数过多,请 ${userGuard.retryAfter} 秒后再试` }, { status: 429, headers: { "Retry-After": String(userGuard.retryAfter) } });

  const user = await prisma.user.findUnique({ where: { username: payload.username } });
  const stored = user?.recoveryCodeHash ?? null;
  const codeMatches = verifyPassword(normalizeRecoveryCode(payload.code), stored ?? DUMMY_HASH);

  if (!user || !user.active || !stored || !codeMatches) {
    await recordLoginAttempt(request, { userId: user?.id, username: payload.username, success: false, failureReason: "恢复码重置失败" });
    return NextResponse.json({ error: "用户名或恢复码不正确" }, { status: 401 });
  }

  const nextCode = generateRecoveryCode();
  const generatedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(payload.password), recoveryCodeHash: hashRecoveryCode(nextCode), recoveryGeneratedAt: generatedAt },
    });
    await tx.authSession.deleteMany({ where: { userId: user.id } });
    await tx.activityLog.create({ data: { action: "PASSWORD_RESET", userId: user.id, detail: `使用恢复码重置密码:${user.username}` } });
  });
  await recordLoginAttempt(request, { userId: user.id, username: user.username, success: true, failureReason: "使用恢复码重置密码" });

  // 新恢复码只在这里返回一次,之后服务端只有哈希。
  return NextResponse.json({ ok: true, username: user.username, code: nextCode, generatedAt });
}
