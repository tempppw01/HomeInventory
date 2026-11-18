// 回填:给已经存在的物品补算存放建议与自动标签(后台规则引擎,不需要用户点任何按钮)。
//   node scripts/backfill-insights.ts
import { PrismaClient } from "@prisma/client";
import { itemInsight } from "../src/lib/item-insight";

const prisma = new PrismaClient();

async function main() {
  const items = await prisma.item.findMany({ select: { id: true, name: true, category: true, unit: true, type: true, storage: true, storageReason: true, autoTags: true } });
  let changed = 0;
  for (const item of items) {
    const insight = itemInsight({ name: item.name, category: item.category, unit: item.unit, type: item.type });
    const autoTags = insight.tags.join(",");
    if (item.storage === insight.storage && item.storageReason === insight.storageReason && item.autoTags === autoTags) continue;
    await prisma.item.update({ where: { id: item.id }, data: { storage: insight.storage, storageReason: insight.storageReason, autoTags } });
    changed += 1;
    console.log(`  ${item.name}: ${insight.storage} — ${insight.storageReason}`);
  }
  console.log(`回填完成:${changed}/${items.length} 件需要更新`);
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(() => prisma.$disconnect());