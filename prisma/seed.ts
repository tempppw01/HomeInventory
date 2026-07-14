import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if ((await prisma.location.count()) > 0) return;

  const [kitchen, livingRoom, bathroom, storage] = await Promise.all([
    prisma.location.create({ data: { name: "厨房", icon: "CookingPot", color: "#f97316" } }),
    prisma.location.create({ data: { name: "客厅", icon: "Sofa", color: "#7c3aed" } }),
    prisma.location.create({ data: { name: "卫生间", icon: "Bath", color: "#06b6d4" } }),
    prisma.location.create({ data: { name: "储物间", icon: "Warehouse", color: "#10b981" } }),
  ]);

  await prisma.item.createMany({
    data: [
      { name: "大米", category: "食品", type: "CONSUMABLE", quantity: 3.5, minQuantity: 2, unit: "kg", price: 32.8, expiryDate: new Date(Date.now() + 120 * 86400000), locationId: kitchen.id },
      { name: "牛奶", category: "饮品", type: "CONSUMABLE", quantity: 2, minQuantity: 3, unit: "盒", price: 14.9, expiryDate: new Date(Date.now() + 5 * 86400000), locationId: kitchen.id },
      { name: "洗衣液", category: "清洁", type: "CONSUMABLE", quantity: 0.6, minQuantity: 1, unit: "瓶", price: 39, locationId: bathroom.id },
      { name: "投影仪", category: "家电", type: "DURABLE", quantity: 1, unit: "台", price: 3299, purchaseDate: new Date("2025-11-18"), locationId: livingRoom.id },
      { name: "露营帐篷", category: "户外", type: "DURABLE", quantity: 1, unit: "顶", price: 699, purchaseDate: new Date("2026-03-02"), locationId: storage.id },
    ],
  });

  await prisma.shoppingItem.createMany({
    data: [
      { name: "牛奶", quantity: 2, unit: "盒", category: "饮品", priority: 2, source: "low-stock" },
      { name: "洗衣液", quantity: 1, unit: "瓶", category: "清洁", priority: 2, source: "low-stock" },
      { name: "厨房纸", quantity: 2, unit: "卷", category: "日用", priority: 1 },
    ],
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
