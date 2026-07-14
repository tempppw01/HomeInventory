import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const statements = [
  `CREATE TABLE IF NOT EXISTS "Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Package',
    "color" TEXT NOT NULL DEFAULT '#7c3aed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
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
  `CREATE TABLE IF NOT EXISTS "FridgeSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "targetMin" REAL NOT NULL DEFAULT 2,
    "targetMax" REAL NOT NULL DEFAULT 8,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "FridgeReading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "temperature" REAL NOT NULL,
    "note" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Location_name_key" ON "Location"("name")`,
  `CREATE INDEX IF NOT EXISTS "Item_type_idx" ON "Item"("type")`,
  `CREATE INDEX IF NOT EXISTS "Item_category_idx" ON "Item"("category")`,
  `CREATE INDEX IF NOT EXISTS "Item_locationId_idx" ON "Item"("locationId")`,
  `CREATE INDEX IF NOT EXISTS "Item_expiryDate_idx" ON "Item"("expiryDate")`,
  `CREATE INDEX IF NOT EXISTS "ShoppingItem_status_idx" ON "ShoppingItem"("status")`,
  `CREATE INDEX IF NOT EXISTS "PriceRecord_itemId_idx" ON "PriceRecord"("itemId")`,
  `CREATE INDEX IF NOT EXISTS "PriceRecord_purchasedAt_idx" ON "PriceRecord"("purchasedAt")`,
  `CREATE INDEX IF NOT EXISTS "PriceRecord_category_idx" ON "PriceRecord"("category")`,
  `CREATE INDEX IF NOT EXISTS "FridgeReading_recordedAt_idx" ON "FridgeReading"("recordedAt")`,
];

async function main() {
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("Item")`);
  if (!columns.some((column) => column.name === "itemCode")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Item" ADD COLUMN "itemCode" TEXT`);
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
