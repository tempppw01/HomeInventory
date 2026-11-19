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

const hashPassword = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

const accounts = [
  { username: "leadcheck", displayName: "验收管理员", role: "ADMIN", password: "Lead#2026" },
  { username: "viewcheck", displayName: "只读检查", role: "VIEWER", password: "View#2026" },
  { username: "rcvlead", displayName: "找回自查", role: "MEMBER", password: "Rcv#2026x" },
];

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