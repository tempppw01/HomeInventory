// 创建验收探针需要的账号(管理员 + 只读 + 找回自查)。
//
// 这些账号只用于自动化检查,不参与产品逻辑:
//   leadcheck / Lead#2026  —— 管理员,跑界面体验与录入修复检查
//   viewcheck / View#2026  —— 只读,跑权限矩阵
//   rcvlead   / Rcv#2026x  —— 普通成员,跑找回流程自查
//
// 用 upsert 保证可重复执行。使用方式:
//   node scripts/make-probe-accounts.mjs

import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

import { probeAccountTargetDecision, redactDatabaseUrl } from "./lib/probe-account-guard.mjs";

const hashPassword = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

const accounts = [
  { username: "leadcheck", displayName: "验收管理员", role: "ADMIN", password: "Lead#2026" },
  { username: "viewcheck", displayName: "只读检查", role: "VIEWER", password: "View#2026" },
  { username: "rcvlead", displayName: "找回自查", role: "MEMBER", password: "Rcv#2026x" },
];

// 闸门:**默认只认探针库**。
//
// 为什么非加不可(2026-11-28 只读实测):家庭库 data/home-inventory.db 里躺着这三个账号
// (2026-11-20 建的),用 scrypt 对着库里的 hash 复核,口令**都能登录**,leadcheck 还是 ADMIN ——
// 而口令就明写在下面这张表里。这个脚本原先不看 DATABASE_URL 指向谁:指到哪个库就建到哪个库。
// 那种后果不该靠「记得别写错环境变量」来兜。
//
// 要在非探针库上建(CI 的 MySQL 作业),显式写 ALLOW_PROBE_ACCOUNTS=1。
const decision = probeAccountTargetDecision(process.env.DATABASE_URL, process.env.ALLOW_PROBE_ACCOUNTS);
if (!decision.allowed) {
  console.error(`拒绝在这里建探针账号:${decision.reason}`);
  console.error("这三个账号(leadcheck/viewcheck/rcvlead)的口令写在 scripts/make-probe-accounts.mjs 里,");
  console.error("建到家庭库上等于给这个家留一个「仓库里写着口令」的管理员账号。");
  console.error("确实要在非探针库上建,请显式设置 ALLOW_PROBE_ACCOUNTS=1。");
  process.exit(1);
}
console.log(`目标库:${redactDatabaseUrl(process.env.DATABASE_URL)}(${decision.reason})`);

const prisma = new PrismaClient();
try {
  for (const account of accounts) {
    const passwordHash = hashPassword(account.password);
    await prisma.user.upsert({
      where: { username: account.username },
      create: {
        username: account.username,
        displayName: account.displayName,
        role: account.role,
        active: true,
        passwordHash,
      },
      update: { role: account.role, active: true, passwordHash },
    });
    console.log(`ready: ${account.username} (${account.role})`);
  }
  console.log(`users now: ${await prisma.user.count()}`);
} finally {
  await prisma.$disconnect();
}