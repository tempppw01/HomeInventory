import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const day = 86400000;

function daysFromNow(days: number) {
  return new Date(Date.now() + days * day);
}

async function main() {
  const seedMode = (process.env.SEED_DEMO_DATA ?? "auto").toLowerCase();
  if (["false", "0", "no", "off"].includes(seedMode)) {
    console.log("Demo data disabled.");
    return;
  }

  const counts = await Promise.all([
    prisma.location.count(),
    prisma.item.count(),
    prisma.shoppingItem.count(),
    prisma.priceRecord.count(),
    prisma.fridgeSetting.count(),
    prisma.fridgeReading.count(),
  ]);
  if (counts.some((count) => count > 0)) {
    console.log("Existing household data detected, skipping demo data.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    const [kitchen, livingRoom, bathroom, storage] = await Promise.all([
      tx.location.create({ data: { name: "厨房", icon: "CookingPot", color: "#f97316" } }),
      tx.location.create({ data: { name: "客厅", icon: "Sofa", color: "#7c3aed" } }),
      tx.location.create({ data: { name: "卫生间", icon: "Bath", color: "#06b6d4" } }),
      tx.location.create({ data: { name: "储物间", icon: "Warehouse", color: "#10b981" } }),
    ]);

    const [rice, milk, detergent] = await Promise.all([
      tx.item.create({ data: { itemCode: "INV-DEMO-001", name: "大米", category: "食品", type: "CONSUMABLE", quantity: 3.5, minQuantity: 2, unit: "kg", price: 32.8, purchaseDate: daysFromNow(-6), expiryDate: daysFromNow(120), locationId: kitchen.id, notes: "示范数据，可直接编辑或删除" } }),
      tx.item.create({ data: { itemCode: "INV-DEMO-002", name: "牛奶", category: "饮品", type: "CONSUMABLE", quantity: 2, minQuantity: 3, unit: "盒", price: 14.9, purchaseDate: daysFromNow(-2), expiryDate: daysFromNow(5), locationId: kitchen.id, notes: "用于体验临期与低库存提醒" } }),
      tx.item.create({ data: { itemCode: "INV-DEMO-003", name: "洗衣液", category: "清洁", type: "CONSUMABLE", quantity: 0.6, minQuantity: 1, unit: "瓶", price: 39, purchaseDate: daysFromNow(-18), locationId: bathroom.id, notes: "用于体验消耗品补货提醒" } }),
      tx.item.create({ data: { itemCode: "INV-DEMO-004", name: "投影仪", category: "家电", type: "DURABLE", quantity: 1, unit: "台", price: 3299, purchaseDate: daysFromNow(-120), locationId: livingRoom.id } }),
      tx.item.create({ data: { itemCode: "INV-DEMO-005", name: "露营帐篷", category: "户外", type: "DURABLE", quantity: 1, unit: "顶", price: 699, purchaseDate: daysFromNow(-45), locationId: storage.id } }),
    ]);

    await tx.shoppingItem.createMany({
      data: [
        { name: "牛奶", quantity: 2, unit: "盒", category: "饮品", priority: 2, source: "low-stock" },
        { name: "洗衣液", quantity: 1, unit: "瓶", category: "清洁", priority: 2, source: "low-stock" },
        { name: "厨房纸", quantity: 2, unit: "卷", category: "日用", priority: 1, source: "manual" },
      ],
    });

    await tx.priceRecord.createMany({
      data: [
        { itemId: milk.id, itemName: milk.name, category: milk.category, unitPrice: 14.9, quantity: 2, totalPrice: 29.8, purchasedAt: daysFromNow(-2), store: "社区超市", notes: "示范消费记录" },
        { itemId: rice.id, itemName: rice.name, category: rice.category, unitPrice: 32.8, quantity: 1, totalPrice: 32.8, purchasedAt: daysFromNow(-6), store: "粮油店", notes: "示范消费记录" },
        { itemId: detergent.id, itemName: detergent.name, category: detergent.category, unitPrice: 39, quantity: 1, totalPrice: 39, purchasedAt: daysFromNow(-18), store: "生活超市", notes: "示范消费记录" },
      ],
    });

    await tx.fridgeSetting.create({ data: { id: "default", enabled: true, targetMin: 2, targetMax: 8 } });
    await tx.fridgeReading.create({ data: { temperature: 4.2, note: "示范温度记录" } });
  });

  console.log("Demo household data seeded for the first visit.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
