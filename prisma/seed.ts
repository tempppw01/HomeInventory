import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * 数据库种子脚本。
 *
 * 历史:这个脚本以前会在首次启动时写入一批示范数据(5 件物品、4 个空间、
 * 3 条采购、3 条消费记录),方便快速了解界面。产品要求库里只保留用户自己
 * 录入的内容,所以现在不会再写入任何物品 / 空间 / 采购 / 消费记录。
 *
 * 脚本必须继续存在且可运行:`npm run db:seed`、`npm run db:setup` 以及容器
 * 首次启动都会调用它,因此它保持幂等(不写任何数据,可重复执行),并以
 * 退出码 0 结束。
 *
 * `SEED_DEMO_DATA` 仍然会被读取,只是为了兼容旧的 docker-compose 写法:
 * 无论取值如何都不再产生示范数据,旧配置既不会报错,也不会有副作用。
 */
async function main() {
  const seedMode = (process.env.SEED_DEMO_DATA ?? "auto").toLowerCase();
  const legacyDisabled = ["false", "0", "no", "off"].includes(seedMode);

  if (legacyDisabled) {
    console.log("SEED_DEMO_DATA 已无需设置:本版本不再写入示范数据。");
  } else {
    console.log("已不再写入示范数据,数据库只会保留你自己录入的内容。");
  }

  // 只读自检:打印当前数据量,确认脚本确实没有写入任何内容。
  const [locations, items, shoppingItems, priceRecords] = await Promise.all([
    prisma.location.count(),
    prisma.item.count(),
    prisma.shoppingItem.count(),
    prisma.priceRecord.count(),
  ]);
  console.log(`当前数据:空间 ${locations} · 物品 ${items} · 采购 ${shoppingItems} · 消费记录 ${priceRecords}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
