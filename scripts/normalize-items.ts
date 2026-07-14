import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.item.updateMany({
    where: { type: "DURABLE", expiryDate: { not: null } },
    data: { expiryDate: null },
  });
  console.log(`Durable item expiry dates normalized (${result.count} updated).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
