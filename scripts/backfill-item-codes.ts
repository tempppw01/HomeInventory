import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { localDateString } from "./lib/local-date";

const prisma = new PrismaClient();

/**
 * 编号:与在线路径 createItemCode 同一口径 ——
 * 日期取 **本地**那一天,不是 UTC 日。取 UTC 日会在东八区的凌晨把编号写成前一天,
 * 与新建物品的编号口径不一致(实测:本地 03-05 00:30 创建的物品被写成 INV-20260304-…)。
 */
function codeFor(createdAt: Date) {
  const date = localDateString(createdAt).replaceAll("-", "");
  // 后缀与在线 createItemCode 同一种字母表(随机十六进制),避免同一格式出现两种字符集
  return `INV-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function main() {
  const items = await prisma.item.findMany({ where: { itemCode: null }, select: { id: true, createdAt: true } });
  for (const item of items) {
    // 撞上已有编号(唯一索引)就重掷几次,别让整批停在中途
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await prisma.item.update({ where: { id: item.id }, data: { itemCode: codeFor(item.createdAt) } });
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002" || attempt === 4) throw error;
      }
    }
  }
  console.log(`Item codes ready (${items.length} backfilled).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
