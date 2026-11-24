// withPoolParams 的单测 —— 连接池调参只该给 SQLite。
//
// 起因:src/lib/prisma.ts 原本对任何 DATABASE_URL 都追加 `connection_limit=1&socket_timeout=20`。
// 那是为 SQLite 的单写者调的(实测 20 并发创建挂掉 12 个),但 MySQL 支持并发,
// 强制 1 条连接只会让请求排队 —— 不报错,却白丢并发能力。
//
// 顺带记录一个已验证的事实:Prisma 的 MySQL 连接器**会忽略** socket_timeout 这类 SQLite 专用参数
// (实测两个 URL 都能解析、只是连不上服务器),所以这不是「MySQL 起不来」的硬故障,
// 但确实是把一套上下文里的调参复制到了另一套里 —— 正是这类问题最容易被忽略。

import { test } from "node:test";
import assert from "node:assert/strict";

import { withPoolParams } from "../../src/lib/prisma-url.ts";

test("SQLite(file:)才追加连接池参数", () => {
  assert.equal(withPoolParams("file:../data/home-inventory.db"), "file:../data/home-inventory.db?connection_limit=1&socket_timeout=20");
  assert.equal(withPoolParams("file:/app/data/home-inventory.db?x=1"), "file:/app/data/home-inventory.db?x=1&connection_limit=1&socket_timeout=20");
});

test("MySQL 不追加(它不需要被压成单连接)", () => {
  const url = "mysql://user:pass@db:3306/homeinventory";
  assert.equal(withPoolParams(url), url, "MySQL 的 URL 应当原样返回");
  assert.ok(!withPoolParams(url)?.includes("socket_timeout"), "不该把 SQLite 专用参数塞给 MySQL");
});

test("已经带了 connection_limit 的 URL 原样返回(别覆盖部署方的设置)", () => {
  const sqlite = "file:../data/app.db?connection_limit=5";
  assert.equal(withPoolParams(sqlite), sqlite);
  const mysql = "mysql://user:pass@db:3306/app?connection_limit=8";
  assert.equal(withPoolParams(mysql), mysql);
});

test("空值返回 undefined,不会拼出 'undefined?connection_limit…'", () => {
  assert.equal(withPoolParams(undefined), undefined);
  assert.equal(withPoolParams(""), undefined);
});