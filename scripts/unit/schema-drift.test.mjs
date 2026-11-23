// isSchemaDriftError 的单测 —— 「库结构比应用旧」这件事必须认出来。
//
// 起因(实测):把镜像换成新版本、却忘了同步库结构时,所有业务接口都是 500
// 「服务器暂时开小差了,请稍后重试」,而 /api/health 还是 200 ok —— 用户反复刷新,监控说正常。
//
// 这条判定一旦漏掉,用户就只会看到「稍后重试」;误判则会把真正的故障说成「库结构旧」,
// 把用户指向错误的修法 —— 所以两边都要钉住。

import { test } from "node:test";
import assert from "node:assert/strict";

import { SCHEMA_DRIFT_HINT, isSchemaDriftError } from "../../src/lib/schema-drift.ts";

const prismaError = (code, message) => Object.assign(new Error(message), { code, name: "PrismaClientKnownRequestError" });

test("认 Prisma 的两个官方错误码(P2021 表不存在 / P2022 列不存在)", () => {
  assert.equal(isSchemaDriftError(prismaError("P2021", "The table `main.Item` does not exist in the current database.")), true);
  assert.equal(isSchemaDriftError(prismaError("P2022", "The column `Item.storage` does not exist in the current database.")), true);
});

test("也认驱动/SQLite 的几种措辞(不只靠错误码)", () => {
  const messages = [
    "no such column: Item.storage",
    "no such table: main.Item",
    "Unknown column 'storage' in 'field list'",
    "table Item has no column named storage",
    'The column `Item.storage` does not exist in the current database.',
  ];
  for (const message of messages) {
    assert.equal(isSchemaDriftError(new Error(message)), true, `应当认出来:${message}`);
  }
});

test("别的 Prisma 错误不能被误判成结构漂移", () => {
  // P2025 找不到记录 / P2002 唯一约束 / P2003 外键 —— 都有各自该说的话,不能都推给「库结构旧」
  for (const code of ["P2025", "P2002", "P2003", "P1001", "P2000"]) {
    assert.equal(isSchemaDriftError(prismaError(code, "随便一句什么")), false, `${code} 不该被当成结构漂移`);
  }
  for (const message of ["请先登录", "UNAUTHORIZED", "请求内容不是合法的 JSON", "网络超时"]) {
    assert.equal(isSchemaDriftError(new Error(message)), false, `「${message}」不该被当成结构漂移`);
  }
});

test("空值 / 字符串 / 陌生对象都不会炸", () => {
  assert.equal(isSchemaDriftError(null), false);
  assert.equal(isSchemaDriftError(undefined), false);
  assert.equal(isSchemaDriftError(""), false);
  assert.equal(isSchemaDriftError({}), false);
  assert.equal(isSchemaDriftError({ code: 123 }), false);
});

test("指引文案要能照做:给出命令与下一步", () => {
  assert.match(SCHEMA_DRIFT_HINT, /db:push/, "必须给出具体命令");
  assert.match(SCHEMA_DRIFT_HINT, /Docker/, "自建部署里 Docker 是常见形态,要提一句");
  assert.match(SCHEMA_DRIFT_HINT, /刷新/, "要告诉用户执行完做什么");
});