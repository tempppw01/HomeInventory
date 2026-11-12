/**
 * 服务器本机兜底:直接重置某个账号的密码。
 *
 * 仅在「管理员连一次性恢复码都没保存、又忘了密码」时使用 —— 这是本机运维路径,
 * 需要能登录到部署这套系统的机器并访问数据库文件。日常请用应用内的
 * 「忘记密码」入口(恢复码)或管理员在设置里重置成员密码。
 *
 *   npm run db:reset-password -- <用户名> <新密码>
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/account-auth";
import { generateRecoveryCode } from "../src/lib/recovery-code";
import { hashRecoveryCode } from "../src/lib/recovery-hash";
import { PASSWORD_MIN_LENGTH } from "../src/lib/password";

const prisma = new PrismaClient();

const usage = [
  "用法:npm run db:reset-password -- <用户名> <新密码>",
  "",
  "例如:npm run db:reset-password -- admin '新的安全密码'",
  `新密码至少 ${PASSWORD_MIN_LENGTH} 位;重置后该账号的所有登录设备都需要重新登录。`,
].join("\n");

async function main() {
  const [username, password] = process.argv.slice(2).filter((value) => value !== "--");
  if (!username || !password) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    console.error(`新密码至少需要 ${PASSWORD_MIN_LENGTH} 位。`);
    process.exitCode = 1;
    return;
  }

  const normalized = username.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { username: normalized }, select: { id: true, username: true, displayName: true, role: true } });
  if (!user) {
    console.error(`没有找到用户名「${normalized}」。可以先执行 node scripts/check-users.mjs 查看现有账号。`);
    process.exitCode = 1;
    return;
  }

  const recoveryCode = generateRecoveryCode();
  const removed = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(password), recoveryCodeHash: hashRecoveryCode(recoveryCode), recoveryGeneratedAt: new Date() },
    });
    const sessions = await tx.authSession.deleteMany({ where: { userId: user.id } });
    await tx.activityLog.create({
      data: { action: "PASSWORD_RESET_LOCAL", userId: user.id, detail: `服务器本地重置密码:${user.username}` },
    });
    return sessions.count;
  });

  console.log(`已重置账号「${user.username}」(${user.displayName} · ${user.role})的密码。`);
  console.log(`已踢出 ${removed} 个登录会话,这些设备需要重新登录。`);
  console.log("同时生成了一个新的恢复码(应用内「设置 → 账号与家庭成员 → 密码与恢复码」里也能重新生成):");
  console.log(`  ${recoveryCode}`);
  console.log("请立刻保存上面的恢复码 —— 它只在这一次输出里出现,服务端只保存哈希。");
  console.log("提示:如果这次重置不是你本人操作,请到「设置 → 账号与家庭成员」检查最近登录记录。");
}

main()
  .catch((error) => {
    console.error("重置失败:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
