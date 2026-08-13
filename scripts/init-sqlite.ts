import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const statements = [
  `CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Package',
    "color" TEXT NOT NULL DEFAULT '#7c3aed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "HouseholdMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7c3aed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT,
    "memberId" TEXT,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "HouseholdMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "locationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
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
  `CREATE UNIQUE INDEX IF NOT EXISTS "HouseholdMember_userId_key" ON "HouseholdMember"("userId")`,
  `CREATE INDEX IF NOT EXISTS "ActivityLog_userId_idx" ON "ActivityLog"("userId")`,
  `CREATE INDEX IF NOT EXISTS "Item_type_idx" ON "Item"("type")`,
  `CREATE INDEX IF NOT EXISTS "Item_category_idx" ON "Item"("category")`,
  `CREATE INDEX IF NOT EXISTS "Item_locationId_idx" ON "Item"("locationId")`,
  `CREATE INDEX IF NOT EXISTS "Item_expiryDate_idx" ON "Item"("expiryDate")`,
  `CREATE INDEX IF NOT EXISTS "ShoppingItem_status_idx" ON "ShoppingItem"("status")`,
  `CREATE INDEX IF NOT EXISTS "PriceRecord_itemId_idx" ON "PriceRecord"("itemId")`,
  `CREATE INDEX IF NOT EXISTS "PriceRecord_purchasedAt_idx" ON "PriceRecord"("purchasedAt")`,
  `CREATE INDEX IF NOT EXISTS "PriceRecord_category_idx" ON "PriceRecord"("category")`,
];

async function main() {
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("Item")`);
  if (!columns.some((column) => column.name === "itemCode")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Item" ADD COLUMN "itemCode" TEXT`);
  }
  if (!columns.some((column) => column.name === "deletedAt")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Item" ADD COLUMN "deletedAt" DATETIME`);
  }
  if (!columns.some((column) => column.name === "restockPausedUntil")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Item" ADD COLUMN "restockPausedUntil" DATETIME`);
  }
  if (!columns.some((column) => column.name === "remainingPercent")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Item" ADD COLUMN "remainingPercent" REAL NOT NULL DEFAULT 100`);
  }
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
  if (!ossColumns.some((column) => column.name === "storageMode")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "OssSetting" ADD COLUMN "storageMode" TEXT NOT NULL DEFAULT 'oss'`);
  }
  if (!ossColumns.some((column) => column.name === "localDirectory")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "OssSetting" ADD COLUMN "localDirectory" TEXT NOT NULL DEFAULT '/app/data/uploads'`);
  }
  if (!ossColumns.some((column) => column.name === "directory")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "OssSetting" ADD COLUMN "directory" TEXT NOT NULL DEFAULT 'home-inventory'`);
  }
  await prisma.$executeRawUnsafe(`UPDATE "Item" SET "expiryDate" = NULL WHERE "type" = 'DURABLE' AND "expiryDate" IS NOT NULL`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Item_itemCode_key" ON "Item"("itemCode")`);
  console.log("SQLite schema is ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
