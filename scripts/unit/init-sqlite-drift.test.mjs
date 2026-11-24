// 第三份 schema 也要同步。
//
// 由来(Docker 冒烟测试抓到的,不是想出来的):
//   prisma/schema.prisma 是开发用;prisma/schema.mysql.prisma 是 MySQL 用;
//   而 **`scripts/init-sqlite.ts` 是 SQLite 全新部署真正用的那一份** ——
//   docker/entrypoint.sh 在 SQLite 模式下跑的就是它(MySQL 模式才走 prisma db push)。
//   这份手写 SQL 没人对着 schema.prisma 校过,于是它悄悄落后了:
//     · 少了 ShoppingItem.stockedAt / stockedQuantity / stockedItemId(v0.1.56 加的),
//       全新 SQLite 库里「标记已购买 → 入库」直接 503(库结构对不上);
//     · 少了 ActivityLog.percentBefore / percentAfter(v0.1.57 加的),
//       于是容器第一次启动就挂 —— POST /api/auth/setup(建管理员)返回一个**空白 500**。
//   最后一条正好被 docker-publish 的冒烟测试逮住:它只做「建管理员 → 登录 → 建物品 → 读回来」,
//   而建管理员就要写一条 ActivityLog。
//
// 这条检查把「手写 SQL 会不会漏字段」变成可执行的规则:
//   schema.prisma 里每个 model、每个非关系字段,都必须在 init-sqlite.ts 里出现
//   (建表语句里直接写,或作为迁移用的 ALTER TABLE ... ADD COLUMN)。
//
// 只比**字段名在不在**,不比类型:两边一个写 `Float?` 一个写 `REAL`,
// 类型上的噪声会把这条检查变成天天误报、最后被人无视。

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

/** { 模型名: [字段名...] },关系字段(类型是另一个模型)已排除 */
function parsePrisma(file) {
  const text = readFileSync(file, "utf8");
  const models = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^model (\w+)/);
    if (header) {
      current = header[1];
      models[current] = [];
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("}")) {
      current = null;
      continue;
    }
    if (!/^\s{2}\w+\s/.test(line)) continue;
    const [name, type] = line.trim().split(/\s+/);
    if (name.startsWith("@")) continue;
    models[current].push({ name, type });
  }
  const modelNames = new Set(Object.keys(models));
  const out = {};
  for (const [model, fields] of Object.entries(models)) {
    out[model] = fields
      .filter((field) => !modelNames.has(field.type.replace(/[?[\]]/g, "")))
      .map((field) => field.name);
  }
  return out;
}

/** { 表名: [列名...] },来自 CREATE TABLE 与 ALTER TABLE ... ADD COLUMN */
function parseInitSqlite(file) {
  const text = readFileSync(file, "utf8");
  const tables = {};
  const add = (table, column) => {
    tables[table] ??= [];
    if (!tables[table].includes(column)) tables[table].push(column);
  };

  const createRe = /CREATE TABLE IF NOT EXISTS "(\w+)" \(([\s\S]*?)\n  \)`/g;
  for (const match of text.matchAll(createRe)) {
    const [, table, body] = match;
    for (const column of body.matchAll(/^\s*"(\w+)"\s+\w/gm)) add(table, column[1]);
  }
  for (const match of text.matchAll(/ALTER TABLE "(\w+)" ADD COLUMN "(\w+)"/g)) add(match[1], match[2]);
  return tables;
}

const prisma = parsePrisma("prisma/schema.prisma");
const sqlite = parseInitSqlite("scripts/init-sqlite.ts");

test("两边都解析出了足够多的表与列(防止空跑)", () => {
  assert.ok(Object.keys(prisma).length > 10, `prisma 只解析到 ${Object.keys(prisma).length} 个模型`);
  assert.ok(Object.keys(sqlite).length > 10, `init-sqlite 只解析到 ${Object.keys(sqlite).length} 张表`);
  const prismaFields = Object.values(prisma).flat().length;
  const sqliteColumns = Object.values(sqlite).flat().length;
  assert.ok(prismaFields > 100 && sqliteColumns > 100, `prisma=${prismaFields} init-sqlite=${sqliteColumns}`);
});

test("init-sqlite.ts 不缺表", () => {
  const missing = Object.keys(prisma).filter((model) => !sqlite[model]);
  assert.deepEqual(missing, [], `缺表:${missing.join(", ")}`);
});

test("init-sqlite.ts 不缺字段(新加的列要同时补进建表语句与增量 ALTER)", () => {
  const missing = [];
  for (const [model, fields] of Object.entries(prisma)) {
    const columns = sqlite[model] ?? [];
    for (const field of fields) if (!columns.includes(field)) missing.push(`${model}.${field}`);
  }
  assert.deepEqual(missing, [], `缺字段:${missing.join(", ")}`);
});

test("init-sqlite.ts 没有 schema.prisma 里已不存在的列(幽灵列会让人以为字段还在)", () => {
  const phantom = [];
  for (const [table, columns] of Object.entries(sqlite)) {
    if (!prisma[table]) continue;
    for (const column of columns) if (!prisma[table].includes(column)) phantom.push(`${table}.${column}`);
  }
  assert.deepEqual(phantom, [], `多出:${phantom.join(", ")}`);
});
