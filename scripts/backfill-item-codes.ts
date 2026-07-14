import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function codeFor(id: string, createdAt: Date) {
  const date = createdAt.toISOString().slice(0, 10).replaceAll("-", "");
  return `INV-${date}-${id.slice(-6).toUpperCase()}`;
}

async function main() {
  const items = await prisma.item.findMany({ where: { itemCode: null }, select: { id: true, createdAt: true } });
  for (const item of items) {
    await prisma.item.update({ where: { id: item.id }, data: { itemCode: codeFor(item.id, item.createdAt) } });
  }
  console.log(`Item codes ready (${items.length} backfilled).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
