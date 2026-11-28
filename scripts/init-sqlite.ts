import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const statements = [
  `CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "recoveryCodeHash" TEXT,
    "recoveryGeneratedAt" DATETIME,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT '未知设备',
    "ipAddress" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "LoginRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "username" TEXT NOT NULL,
    "ipAddress" TEXT,
    "device" TEXT NOT NULL,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoginRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "AiChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" TEXT,
    "itemDraft" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Package',
    "color" TEXT NOT NULL DEFAULT '#7c3aed',
    "thumbnailUrl" TEXT,
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "HouseholdMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7c3aed',
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HouseholdMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT,
    "memberId" TEXT,
    "userId" TEXT,
    "detail" TEXT,
    "undoOfId" TEXT,
    "undoneAt" DATETIME,
    "percentBefore" REAL,
    "percentAfter" REAL,
    "scanRequestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "HouseholdMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemCode" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DURABLE',
    "quantity" REAL NOT NULL DEFAULT 1,
    "minQuantity" REAL NOT NULL DEFAULT 0,
    "remainingPercent" REAL NOT NULL DEFAULT 100,
    "unit" TEXT NOT NULL DEFAULT '件',
    "price" REAL,
    "purchaseDate" DATETIME,
    "expiryDate" DATETIME,
    "imageUrl" TEXT,
    "notes" TEXT,
    "aiSummary" TEXT,
    "aiStorageAdvice" TEXT,
    "aiUsageAdvice" TEXT,
    "aiReplenishmentAdvice" TEXT,
    "storage" TEXT,
    "storageReason" TEXT,
    "autoTags" TEXT,
    "locationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "consumeRate" REAL NOT NULL DEFAULT 0,
    "lastRestockedAt" DATETIME,
    CONSTRAINT "Item_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "ShoppingItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT '件',
    "category" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "stockedAt" DATETIME,
    "stockedQuantity" REAL,
    "stockedItemId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "HouseholdPreference" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "expiryReminderDays" INTEGER NOT NULL DEFAULT 7,
    "lowStockReminder" BOOLEAN NOT NULL DEFAULT true,
    "weeklyReviewEnabled" BOOLEAN NOT NULL DEFAULT true,
    "weeklyReviewDay" INTEGER NOT NULL DEFAULT 0,
    "lastAutoBackupAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "HouseholdTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" DATETIME NOT NULL,
    "recurrence" TEXT NOT NULL DEFAULT 'NONE',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completedAt" DATETIME,
    "nextDueAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  // 这两张表此前**完全不在这份手写 SQL 里**(schema.prisma 里早就有):
  // 于是全新 SQLite 部署(Docker 走的就是这条)上「盘点历史」与「搜索历史」
  // 从第一次使用起就一直 503 —— 接口只会说「库结构比当前版本旧,请跑 db push」,
  // 而容器在 SQLite 模式下从不自动跑 db push,用户照着做也不知道该在哪跑。
  // 由 scripts/unit/init-sqlite-drift.test.mjs 守着,漏字段会直接红。
  `CREATE TABLE IF NOT EXISTS "AuditRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "total" INTEGER NOT NULL,
    "confirmed" INTEGER NOT NULL,
    "locationName" TEXT NOT NULL DEFAULT '全部空间',
    "finishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "SyncOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resultJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SyncOperation_opId_key" ON "SyncOperation"("opId")`,
  `CREATE INDEX IF NOT EXISTS "SyncOperation_createdAt_idx" ON "SyncOperation"("createdAt")`,
  `CREATE TABLE IF NOT EXISTS "SearchHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "query" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "OssSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "storageMode" TEXT NOT NULL DEFAULT 'oss',
    "localDirectory" TEXT NOT NULL DEFAULT '/app/data/uploads',
    "region" TEXT NOT NULL,
    "endpoint" TEXT,
    "bucket" TEXT NOT NULL,
    "directory" TEXT NOT NULL DEFAULT 'home-inventory',
    "accessKeyId" TEXT NOT NULL,
    "accessKeySecret" TEXT NOT NULL,
    "publicBaseUrl" TEXT,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "AiSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "PriceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unitPrice" REAL NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "totalPrice" REAL NOT NULL,
    "purchasedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "store" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceRecord_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Location_name_key" ON "Location"("name")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash")`,
  `CREATE INDEX IF NOT EXISTS "AuthSession_userId_idx" ON "AuthSession"("userId")`,
  `CREATE INDEX IF NOT EXISTS "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt")`,
  `CREATE INDEX IF NOT EXISTS "LoginRecord_userId_idx" ON "LoginRecord"("userId")`,
  `CREATE INDEX IF NOT EXISTS "LoginRecord_createdAt_idx" ON "LoginRecord"("createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AiChatMessage_userId_position_key" ON "AiChatMessage"("userId", "position")`,
  `CREATE INDEX IF NOT EXISTS "AiChatMessage_userId_updatedAt_idx" ON "AiChatMessage"("userId", "updatedAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "HouseholdMember_userId_key" ON "HouseholdMember"("userId")`,
  `CREATE INDEX IF NOT EXISTS "ActivityLog_userId_idx" ON "ActivityLog"("userId")`,
  // 这四个索引此前只在 prisma db push 建出来的库里存在 —— 容器(SQLite)建的库没有。
  // ActivityLog 是最大的表(实测本地 4 万行以上),详情页历史、扫码记录、回收站都靠它们。
  `CREATE INDEX IF NOT EXISTS "ActivityLog_itemId_idx" ON "ActivityLog"("itemId")`,
  `CREATE INDEX IF NOT EXISTS "ActivityLog_memberId_idx" ON "ActivityLog"("memberId")`,
  `CREATE INDEX IF NOT EXISTS "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "Item_deletedAt_idx" ON "Item"("deletedAt")`,
  `CREATE INDEX IF NOT EXISTS "Item_type_idx" ON "Item"("type")`,
  `CREATE INDEX IF NOT EXISTS "Item_category_idx" ON "Item"("category")`,
  `CREATE INDEX IF NOT EXISTS "Item_locationId_idx" ON "Item"("locationId")`,
  `CREATE INDEX IF NOT EXISTS "Item_expiryDate_idx" ON "Item"("expiryDate")`,
  `CREATE INDEX IF NOT EXISTS "Item_lastRestockedAt_idx" ON "Item"("lastRestockedAt")`,
  `CREATE INDEX IF NOT EXISTS "ShoppingItem_status_idx" ON "ShoppingItem"("status")`,
  `CREATE INDEX IF NOT EXISTS "HouseholdTask_status_idx" ON "HouseholdTask"("status")`,
  `CREATE INDEX IF NOT EXISTS "HouseholdTask_dueAt_idx" ON "HouseholdTask"("dueAt")`,
  `CREATE INDEX IF NOT EXISTS "HouseholdTask_nextDueAt_idx" ON "HouseholdTask"("nextDueAt")`,
  `CREATE INDEX IF NOT EXISTS "PriceRecord_itemId_idx" ON "PriceRecord"("itemId")`,
  `CREATE INDEX IF NOT EXISTS "PriceRecord_purchasedAt_idx" ON "PriceRecord"("purchasedAt")`,
  `CREATE INDEX IF NOT EXISTS "PriceRecord_category_idx" ON "PriceRecord"("category")`,
  `CREATE INDEX IF NOT EXISTS "AuditRecord_finishedAt_idx" ON "AuditRecord"("finishedAt")`,
  `CREATE INDEX IF NOT EXISTS "SearchHistory_userId_idx" ON "SearchHistory"("userId")`,
  `CREATE INDEX IF NOT EXISTS "SearchHistory_createdAt_idx" ON "SearchHistory"("createdAt")`,
];

async function main() {
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("Item")`);
  const sessionColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("AuthSession")`);
  const locationColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("Location")`);
  if (!locationColumns.some((column) => column.name === "thumbnailUrl")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Location" ADD COLUMN "thumbnailUrl" TEXT`);
  }
  if (!locationColumns.some((column) => column.name === "parentId")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Location" ADD COLUMN "parentId" TEXT`);
  }
  const shoppingColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("ShoppingItem")`);
  if (!shoppingColumns.some((column) => column.name === "isFavorite")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ShoppingItem" ADD COLUMN "isFavorite" BOOLEAN NOT NULL DEFAULT false`);
  }
  if (!columns.some((column) => column.name === "itemCode")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Item" ADD COLUMN "itemCode" TEXT`);
  }
  if (!columns.some((column) => column.name === "deletedAt")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Item" ADD COLUMN "deletedAt" DATETIME`);
  }
  if (!columns.some((column) => column.name === "restockPausedUntil")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Item" ADD COLUMN "restockPausedUntil" DATETIME`);
  }
  if (!columns.some((column) => column.name === "consumeRate")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Item" ADD COLUMN "consumeRate" REAL NOT NULL DEFAULT 0`);
  }
  if (!columns.some((column) => column.name === "lastRestockedAt")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Item" ADD COLUMN "lastRestockedAt" DATETIME`);
  }
  if (!columns.some((column) => column.name === "remainingPercent")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Item" ADD COLUMN "remainingPercent" REAL NOT NULL DEFAULT 100`);
  }
  if (!sessionColumns.some((column) => column.name === "device")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuthSession" ADD COLUMN "device" TEXT NOT NULL DEFAULT '未知设备'`);
  }
  if (!sessionColumns.some((column) => column.name === "ipAddress")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuthSession" ADD COLUMN "ipAddress" TEXT`);
  }
  // 「忘记密码」用的一次性恢复码:老库升级时补列,新库由上面的 CREATE TABLE 建好。
  const userColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("User")`);
  if (!userColumns.some((column) => column.name === "recoveryCodeHash")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "recoveryCodeHash" TEXT`);
  }
  if (!userColumns.some((column) => column.name === "recoveryGeneratedAt")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "recoveryGeneratedAt" DATETIME`);
  }
  // Count units (including bottles) represent whole packages. Their partial
  // in-use state lives in remainingPercent, so old fractional data is repaired
  // on startup without touching weight or volume based inventory.
  await prisma.$executeRawUnsafe(`UPDATE "Item" SET "quantity" = MAX(1, ROUND("quantity")) WHERE "unit" IN ('件', '个', '盒', '瓶', '袋', '卷', '包', '台') AND "quantity" > 0 AND "quantity" != ROUND("quantity")`);
  for (const column of ["aiSummary", "aiStorageAdvice", "aiUsageAdvice", "aiReplenishmentAdvice"]) {
    if (!columns.some((existing) => existing.name === column)) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Item" ADD COLUMN "${column}" TEXT`);
    }
  }
  const ossColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("OssSetting")`);
  const memberColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("HouseholdMember")`);
  if (!memberColumns.some((column) => column.name === "userId")) await prisma.$executeRawUnsafe(`ALTER TABLE "HouseholdMember" ADD COLUMN "userId" TEXT`);
  const activityColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("ActivityLog")`);
  if (!activityColumns.some((column) => column.name === "userId")) await prisma.$executeRawUnsafe(`ALTER TABLE "ActivityLog" ADD COLUMN "userId" TEXT`);
  if (!activityColumns.some((column) => column.name === "undoOfId")) await prisma.$executeRawUnsafe(`ALTER TABLE "ActivityLog" ADD COLUMN "undoOfId" TEXT`);
  if (!activityColumns.some((column) => column.name === "undoneAt")) await prisma.$executeRawUnsafe(`ALTER TABLE "ActivityLog" ADD COLUMN "undoneAt" DATETIME`);
  if (!activityColumns.some((column) => column.name === "scanRequestId")) await prisma.$executeRawUnsafe(`ALTER TABLE "ActivityLog" ADD COLUMN "scanRequestId" TEXT`);
  // 老库升级:这两列由「撤销余量型消耗」使用(v0.1.57),少了它容器里第一次
  // 建管理员就会 500(那条 ACCOUNT_SETUP 流水写不进去)。
  if (!activityColumns.some((column) => column.name === "percentBefore")) await prisma.$executeRawUnsafe(`ALTER TABLE "ActivityLog" ADD COLUMN "percentBefore" REAL`);
  if (!activityColumns.some((column) => column.name === "percentAfter")) await prisma.$executeRawUnsafe(`ALTER TABLE "ActivityLog" ADD COLUMN "percentAfter" REAL`);
  // 采购项上的入库记账(v0.1.56):少了它「标记已购买 → 入库 / 撤销退回」直接 503。
  // 复用上面已经读过的 shoppingColumns,不再重复 PRAGMA。
  if (!shoppingColumns.some((column) => column.name === "stockedAt")) await prisma.$executeRawUnsafe(`ALTER TABLE "ShoppingItem" ADD COLUMN "stockedAt" DATETIME`);
  if (!shoppingColumns.some((column) => column.name === "stockedQuantity")) await prisma.$executeRawUnsafe(`ALTER TABLE "ShoppingItem" ADD COLUMN "stockedQuantity" REAL`);
  if (!shoppingColumns.some((column) => column.name === "stockedItemId")) await prisma.$executeRawUnsafe(`ALTER TABLE "ShoppingItem" ADD COLUMN "stockedItemId" TEXT`);
  if (!ossColumns.some((column) => column.name === "storageMode")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "OssSetting" ADD COLUMN "storageMode" TEXT NOT NULL DEFAULT 'oss'`);
  }
  if (!ossColumns.some((column) => column.name === "localDirectory")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "OssSetting" ADD COLUMN "localDirectory" TEXT NOT NULL DEFAULT '/app/data/uploads'`);
  }
  if (!ossColumns.some((column) => column.name === "directory")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "OssSetting" ADD COLUMN "directory" TEXT NOT NULL DEFAULT 'home-inventory'`);
  }
  // 老库里补不上外键(SQLite 的 ALTER 不支持加约束),那就用**同样的语义**把孤儿引用清掉:
  // 删掉一个空间后,子空间的 parentId 原本仍指向已删除的行(实测:容器建的库就是这样,
  // 而 prisma db push 建出来的库会按 ON DELETE SET NULL 置空),界面上那个子空间就无处挂靠 ——
  // 东西还在、树上看不到,是这类应用最容易被当成「数据丢了」的情形。
  await prisma.$executeRawUnsafe(`UPDATE "Location" SET "parentId" = NULL WHERE "parentId" IS NOT NULL AND "parentId" NOT IN (SELECT "id" FROM "Location")`);
  await prisma.$executeRawUnsafe(`UPDATE "ActivityLog" SET "userId" = NULL WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT "id" FROM "User")`);
  await prisma.$executeRawUnsafe(`UPDATE "HouseholdMember" SET "userId" = NULL WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT "id" FROM "User")`);
  await prisma.$executeRawUnsafe(`UPDATE "Item" SET "expiryDate" = NULL WHERE "type" = 'DURABLE' AND "expiryDate" IS NOT NULL`);
  // 存放建议与自动标签(后台规则引擎写入)
  for (const statement of [
    `ALTER TABLE "Item" ADD COLUMN "storage" TEXT`,
    `ALTER TABLE "Item" ADD COLUMN "storageReason" TEXT`,
    `ALTER TABLE "Item" ADD COLUMN "autoTags" TEXT`,
  ]) {
    try { await prisma.$executeRawUnsafe(statement); } catch { /* 列已存在 */ }
  }

  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Item_itemCode_key" ON "Item"("itemCode")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ActivityLog_undoOfId_idx" ON "ActivityLog"("undoOfId")`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ActivityLog_scanRequestId_key" ON "ActivityLog"("scanRequestId")`);
  console.log("SQLite schema is ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
