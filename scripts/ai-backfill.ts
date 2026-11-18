// 给「还没有 AI 结论」的物品补齐后台分析(按需运行,不阻塞任何用户操作)。
//   npx tsx scripts/ai-backfill.ts            # 只处理前 10 件,避免一次性烧太多额度
//   npx tsx scripts/ai-backfill.ts --all      # 全部
import { PrismaClient } from "@prisma/client";
import { getAiConfig } from "../src/lib/ai";
import { analyzeItemInBackground } from "../src/lib/ai-analyze";

const prisma = new PrismaClient();

async function main() {
  const config = await getAiConfig();
  if (!config) {
    console.log("未配置 AI,跳过");
    return;
  }

  const all = process.argv.includes("--all");
  const limit = Number(process.env.AI_BACKFILL_LIMIT ?? 10);
  const items = await prisma.item.findMany({
    where: { deletedAt: null, aiSummary: null },
    select: { id: true, name: true, category: true, type: true, unit: true, quantity: true, minQuantity: true, expiryDate: true, purchaseDate: true, notes: true, location: { select: { name: true } } },
    take: all ? undefined : limit,
    orderBy: { createdAt: "desc" },
  });
  console.log(`待分析 ${items.length} 件(模型 ${config.model})`);

  let ok = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const { analysis } = await analyzeItemInBackground(config, {
        name: item.name,
        category: item.category,
        type: item.type,
        unit: item.unit,
        quantity: item.quantity,
        minQuantity: item.minQuantity,
        expiryDate: item.expiryDate?.toISOString() ?? null,
        purchaseDate: item.purchaseDate?.toISOString() ?? null,
        notes: item.notes,
        locationName: item.location?.name ?? null,
      });
      await prisma.item.update({
        where: { id: item.id },
        data: {
          aiSummary: analysis.summary ?? null,
          aiStorageAdvice: analysis.storageAdvice ?? null,
          aiUsageAdvice: analysis.usageAdvice ?? null,
          aiReplenishmentAdvice: analysis.replenishmentAdvice ?? null,
        },
      });
      ok += 1;
      console.log("  ✓", item.name, "→", String(analysis.summary ?? "").slice(0, 50));
    } catch (error) {
      failed += 1;
      console.log("  ✗", item.name, error instanceof Error ? error.message.slice(0, 80) : error);
    }
  }
  console.log(`完成:成功 ${ok},失败 ${failed}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());