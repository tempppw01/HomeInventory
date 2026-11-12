import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const hashPassword = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

const mode = process.argv[2];
const prisma = new PrismaClient();

if (mode === "clear") {
  await prisma.authSession.deleteMany();
  await prisma.user.deleteMany();
  await prisma.householdMember.deleteMany();
  console.log("scratch users cleared");
}

if (mode === "reset-admin") {
  const password = process.argv[3];
  await prisma.authSession.deleteMany();
  await prisma.user.deleteMany();
  await prisma.householdMember.deleteMany();
  await prisma.user.create({
    data: {
      username: "admin",
      displayName: "管理员",
      role: "ADMIN",
      active: true,
      passwordHash: hashPassword(password),
    },
  });
  console.log("scratch admin recreated");
}

if (mode === "set-password") {
  const password = process.argv[3];
  const username = process.argv[4] || "admin";
  await prisma.user.update({ where: { username }, data: { passwordHash: hashPassword(password) } });
  console.log(`password set for ${username}`);
}

if (mode === "revoke-sessions") {
  const username = process.argv[3] || "admin";
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.log(`no such user: ${username}`);
  } else {
    const removed = await prisma.authSession.deleteMany({ where: { userId: user.id } });
    console.log(`revoked ${removed.count} session(s) for ${username}`);
  }
}

await prisma.$disconnect();
