// 备份上限的两处写法必须一致:next.config 的字面量与 src/lib/backup-limits.ts 的常量。
//
// 起因:恢复请求经过 proxy,Next 的 proxyClientMaxBodySize **默认 10 MB** —— 实测 3.1 MB 能恢复、
// 10.2 MB 直接 400,而报出来的是「请求内容不是合法的 JSON」(文件是合法的)。
// 本机导出已经有 14 MB,也就是**用户自己的备份恢复不了**。
//
// next.config.ts 里没法 import src/ 下的模块(构建时解析不到),所以只能各写一处 —— 用这条测试钉住。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MAX_BACKUP_BYTES, backupTooLargeMessage, formatBytes } from "../../src/lib/backup-limits.ts";

test("next.config 里的 proxyClientMaxBodySize 与 MAX_BACKUP_BYTES 一致", () => {
  const config = readFileSync("next.config.ts", "utf8");
  const match = /proxyClientMaxBodySize:\s*"(\d+)mb"/.exec(config);
  assert.ok(match, "next.config 里应当显式设置 proxyClientMaxBodySize(默认只有 10 MB)");
  assert.equal(Number(match[1]) * 1024 * 1024, MAX_BACKUP_BYTES, `配置=${match[1]}mb 与常量=${MAX_BACKUP_BYTES} 不一致`);
});

test("上限必须明显大于默认的 10 MB", () => {
  assert.ok(MAX_BACKUP_BYTES > 10 * 1024 * 1024, "导出会随数据增长,上限不能贴着默认值");
});

test("体积格式化说人话", () => {
  assert.equal(formatBytes(14 * 1024 * 1024), "14.0 MB");
  assert.equal(formatBytes(2048), "2 KB");
});

test("过大的说明要能照做:给出实际体积、上限与下一步", () => {
  const message = backupTooLargeMessage(70 * 1024 * 1024);
  assert.match(message, /70\.0 MB/, "要说清文件多大");
  assert.match(message, /64\.0 MB/, "要说清上限是多少");
  assert.match(message, /proxyClientMaxBodySize/, "要指出改哪个配置");
});
