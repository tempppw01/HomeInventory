// 两份 localDateString 必须一致 —— 这是「脚本自带依赖」这条设计的保险。
//
// 背景:运行镜像里没有 src/,所以 scripts/ 不能 import `@/lib/local-date`;
// 于是 scripts/lib/local-date.ts 放了一份。复制就会有漂移风险,
// 这里把两份实现喂同一批时刻,逐一对齐(含跨月/跨年/凌晨这些容易出事的点)。
//
// 顺带守一条:scripts/*.ts 里不许出现 `from "@/..."` —— 那在镜像里解析不了,
// 会让容器启动脚本抛错、整个容器起不来(v0.1.41 的 docker 冒烟测试就这么红过两次)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { localDateString as canonical } from "../../src/lib/local-date.ts";
import { localDateString as scriptSide } from "../lib/local-date.ts";

test("脚本侧与规范实现逐个时刻一致", () => {
  const samples = [
    new Date(2026, 0, 1, 0, 0, 0),
    new Date(2026, 2, 5, 0, 30, 0),   // 凌晨:UTC 日与本地日不同的典型时刻
    new Date(2026, 2, 5, 23, 59, 59),
    new Date(2026, 11, 31, 23, 59, 0),
    new Date(2027, 0, 1, 0, 0, 1),
    new Date(2024, 1, 29, 12, 0, 0),  // 闰日
    new Date(2026, 6, 15, 8, 0, 0),
    new Date(1999, 11, 31, 23, 0, 0),
  ];
  for (const sample of samples) {
    assert.equal(scriptSide(sample), canonical(sample), `时刻 ${sample.toISOString()} 两份实现不一致`);
  }
});

test("脚本侧的补零与格式正确", () => {
  assert.equal(scriptSide(new Date(2026, 0, 5, 10, 0, 0)), "2026-01-05");
  assert.equal(scriptSide(new Date(2026, 10, 30, 10, 0, 0)), "2026-11-30");
});

test("scripts/ 里没有 @/ 别名依赖(镜像里没有 tsconfig,解析不了)", () => {
  const offenders = [];
  for (const file of readdirSync("scripts")) {
    if (!file.endsWith(".ts")) continue;
    const code = readFileSync(`scripts/${file}`, "utf8");
    if (/from "@\//.test(code)) offenders.push(`scripts/${file}`);
  }
  for (const file of readdirSync("scripts/lib")) {
    if (!file.endsWith(".ts")) continue;
    const code = readFileSync(`scripts/lib/${file}`, "utf8");
    if (/from "@\//.test(code)) offenders.push(`scripts/lib/${file}`);
  }
  assert.deepEqual(offenders, [], `这些脚本用了 @/ 别名,在镜像里会解析失败:${offenders.join(", ")}`);
});