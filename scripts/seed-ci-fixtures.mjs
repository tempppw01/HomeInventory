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

  // 再放一件「按个数消耗、非液体」的物品:
  // 「用掉 1 包」这类按钮只对这种物品出现,而桌面端有断言要检查它的文字标签。
  const tissue = await prisma.item.create({
    data: {
      name: "界面检查·抽纸",
      category: "日用",
      type: "CONSUMABLE",
      unit: "包",
      quantity: 4,
      autoTags: "日用,消耗品",
      storage: "ROOM",
    },
  });

  const records = [
    { item: milk, qty: 2, price: 12.5, at: monthStart(0, 8) },
    { item: water, qty: 12, price: 2, at: monthStart(1, 12) },
    { item: milk, qty: 3, price: 12.5, at: monthStart(2, 15) },
    { item: tissue, qty: 6, price: 3.5, at: monthStart(0, 3) },
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

  // 再补一件「AI 结论已过时」的物品:列表卡片会因此出现「建议重新分析」这个胶囊按钮。
  // 这个按钮在窄屏下曾经只有约 18px 高(点击目标不合格),但 CI 数据里没有这种物品,
  // 于是窄屏检查一直覆盖不到它 —— 本地却因为演示数据里有而过不去。
  const stale = new Date();
  stale.setDate(stale.getDate() - 10);
  // 注意:aiAnalyzedAt **不是数据库字段** —— 接口是从活动日志里的 AI_ANALYZE 记录推导出来的
  // (见 src/app/api/dashboard/route.ts)。所以这里要造一条活动记录,而不是写字段。
  const staleItem = await prisma.item.create({
    data: {
      name: "界面检查·AI 结论已过时",
      category: "日用",
      type: "CONSUMABLE",
      unit: "瓶",
      quantity: 2,
      aiSummary: "这是旧的 AI 结论,用于让列表显示「建议重新分析」入口",
    },
  });
  await prisma.activityLog.create({
    data: {
      action: "AI_ANALYZE",
      itemId: staleItem.id,
      itemName: staleItem.name,
      detail: "播种数据:让 AI 结论早于物品更新时间",
      createdAt: stale,
    },
  });

  // 下面这些物品专门用来覆盖「只有特定数据状态才会出现」的界面元素:
  // 已过期 / 低库存 / 余量见底 / 回收站有东西 / 采购清单非空 / 有任务。
  // 背景:此前种子数据只有健康状态的物品,于是这些状态的元素在 CI 里从未被对比度、
  // 窄屏点击目标、无障碍这些检查看到 —— 补上之后第一次就抓到了真问题(深色下表头对比度 2.03)。
  const past = new Date();
  past.setDate(past.getDate() - 3);
  await prisma.item.create({
    data: {
      name: "界面检查·已过期酸奶",
      category: "食品",
      type: "CONSUMABLE",
      unit: "盒",
      quantity: 1,
      expiryDate: past,
      storage: "COLD",
    },
  });

  await prisma.item.create({
    data: {
      name: "界面检查·低库存抽纸",
      category: "日用",
      type: "CONSUMABLE",
      unit: "包",
      quantity: 1,
      minQuantity: 5,
    },
  });

  await prisma.item.create({
    data: {
      name: "界面检查·余量见底洗洁精",
      category: "清洁",
      type: "CONSUMABLE",
      unit: "瓶",
      quantity: 1,
      remainingPercent: 8,
    },
  });

  // 已经用完的消耗品 + 日均消耗:让「快用完了」的边界(用完的正是该补货的)可以被量到。
  // 日均消耗只能由真实的消耗事件学出来(至少 2 次),套件里现造不出来,所以直接写进种子。
  // 注意用「包」而不是「瓶」:瓶装会被当成液体,这里要的就是按数量估算的那条路径。
  await prisma.item.create({
    data: {
      name: "界面检查·已经用完的挂面",
      category: "食品",
      type: "CONSUMABLE",
      unit: "包",
      quantity: 0,
      consumeRate: 1,
    },
  });

  // 暂停补货 + 日均消耗:用来核对「用户点名暂停的东西,不该出现在任何『快用完了』清单里」。
  const pausedUntil = new Date();
  pausedUntil.setDate(pausedUntil.getDate() + 7);
  await prisma.item.create({
    data: {
      name: "界面检查·暂停补货的牙膏",
      category: "日用",
      type: "CONSUMABLE",
      unit: "支",
      quantity: 2,
      consumeRate: 1,
      restockPausedUntil: pausedUntil,
    },
  });

  // 冰箱清单的两个边界:
  //   · 已经喝完的冷藏品(数量 0):月报此前会念它「还没放好」,而一件吃完的东西没法再放回冰箱
  //   · 开封后冷藏的:摘要里的「该冷藏 N 件」把它算进去了,界面却从来没显示过它
  await prisma.item.create({
    data: {
      name: "界面检查·已经喝完的鲜奶",
      category: "饮品",
      type: "CONSUMABLE",
      unit: "盒",
      quantity: 0,
      storage: "COLD",
    },
  });
  await prisma.item.create({
    data: {
      name: "界面检查·开封后冷藏的果酱",
      category: "食品",
      type: "CONSUMABLE",
      unit: "瓶",
      quantity: 1,
      storage: "COLD_AFTER_OPEN",
    },
  });

  // 回收站里放一件,让「回收站」弹窗有内容可渲染
  const discarded = new Date();
  discarded.setDate(discarded.getDate() - 1);
  await prisma.item.create({
    data: {
      name: "界面检查·回收站里的旧物",
      category: "日用",
      type: "DURABLE",
      unit: "个",
      quantity: 1,
      deletedAt: discarded,
    },
  });

  // 采购清单与任务各留一条,让对应视图不是空状态
  await prisma.shoppingItem.create({
    data: {
      name: "界面检查·待采购物品",
      quantity: 2,
      unit: "瓶",
      category: "日用",
      priority: 2,
      source: "manual",
      status: "PENDING",
    },
  });

  const due = new Date();
  due.setDate(due.getDate() + 2);
  await prisma.householdTask.create({
    data: {
      title: "界面检查·换滤芯",
      dueAt: due,
      status: "OPEN",
      recurrence: "NONE",
    },
  });

  console.log(`已播种:物品 ${await prisma.item.count()} 件,消费记录 ${await prisma.priceRecord.count()} 条`);
} finally {
  await prisma.$disconnect();
}