// 为界面检查准备最小可用的演示数据。
//
// 为什么需要:月报页的图表(近 6 个月支出、分类占比)依赖消费记录,
// 空库下页面本身没问题,但断言「图表必须渲染」就没有意义了。
// 这里造 2 件物品 + 3 条跨月消费记录,让检查有真实形状可看。
//
// 使用方式:node scripts/seed-ci-fixtures.mjs

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const monthStart = (monthsAgo, day) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, day);
};

try {
  const existing = await prisma.item.count({ where: { deletedAt: null } });
  if (existing > 0) {
    console.log(`库里已有 ${existing} 件物品,跳过播种`);
    process.exit(0);
  }

  const soon = new Date();
  soon.setDate(soon.getDate() + 5);

  const milk = await prisma.item.create({
    data: {
      name: "界面检查·鲜奶",
      category: "饮品",
      type: "CONSUMABLE",
      unit: "盒",
      quantity: 3,
      expiryDate: soon,
      autoTags: "饮料,乳制品,消耗品,需冷藏",
      storage: "COLD",
    },
  });
  const water = await prisma.item.create({
    data: {
      name: "界面检查·矿泉水",
      category: "饮品",
      type: "CONSUMABLE",
      unit: "瓶",
      quantity: 12,
      autoTags: "饮料,消耗品",
      storage: "ROOM",
    },
  });

  const records = [
    { item: milk, qty: 2, price: 12.5, at: monthStart(0, 8) },
    { item: water, qty: 12, price: 2, at: monthStart(1, 12) },
    { item: milk, qty: 3, price: 12.5, at: monthStart(2, 15) },
  ];
  for (const record of records) {
    await prisma.priceRecord.create({
      data: {
        itemId: record.item.id,
        itemName: record.item.name,
        category: record.item.category,
        unitPrice: record.price,
        quantity: record.qty,
        totalPrice: Number((record.price * record.qty).toFixed(2)),
        purchasedAt: record.at,
      },
    });
  }

  console.log(`已播种:物品 ${await prisma.item.count()} 件,消费记录 ${await prisma.priceRecord.count()} 条`);
} finally {
  await prisma.$disconnect();
}