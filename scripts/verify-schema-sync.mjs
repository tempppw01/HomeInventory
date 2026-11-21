// 两份 schema 必须同步(静态)。
//
// 背景:`prisma/schema.mysql.prisma` 是 MySQL 部署用的表结构,而 `docker/entrypoint.sh`
// 会在启动时把它**覆盖成正式 schema** —— 也就是说 MySQL 用户实际跑的就是这一份。
//
// 它此前落后于 `schema.prisma`:缺了 `AuditRecord`、`SearchHistory`、`AiChatMessage` 三张表,
// 以及 `User.recoveryCodeHash` / `recoveryGeneratedAt`。后果是 MySQL 部署下
// **盘点历史、搜索历史、AI 聊天记录、恢复码(忘记密码自助重置)四处写入都会因表/字段不存在而失败**。
//
// 这条检查比较两份 schema 的 model 与字段清单,防止再次分叉。
//
// 用法:node scripts/verify-schema-sync.mjs   (不需要起服务)

import { readFileSync } from "node:fs";

const SQLITE = "prisma/schema.prisma";
const MYSQL = "prisma/schema.mysql.prisma";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

/** 解析出 { 模型名: [字段名...] } */
const parseModels = (file) => {
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
    if (current && /^\s{2}\w+\s/.test(line)) {
      const name = line.trim().split(/\s+/)[0];
      if (!name.startsWith("@")) models[current].push(name);
    }
    if (line.startsWith("}")) current = null;
  }
  return models;
};

const sqlite = parseModels(SQLITE);
const mysql = parseModels(MYSQL);
const sqliteModels = Object.keys(sqlite);
const mysqlModels = Object.keys(mysql);

check("两份 schema 都解析出了足够多的模型(防止空跑)", sqliteModels.length > 10 && mysqlModels.length > 10, `sqlite=${sqliteModels.length} mysql=${mysqlModels.length}`);

const missingInMysql = sqliteModels.filter((name) => !mysql[name]);
check("MySQL schema 不缺表", missingInMysql.length === 0, `缺:${missingInMysql.join(", ")}`);

const extraInMysql = mysqlModels.filter((name) => !sqlite[name]);
check("MySQL schema 没有多余的表", extraInMysql.length === 0, `多出:${extraInMysql.join(", ")}`);

const fieldDiffs = [];
for (const name of sqliteModels) {
  if (!mysql[name]) continue;
  const missing = sqlite[name].filter((field) => !mysql[name].includes(field));
  const extra = mysql[name].filter((field) => !sqlite[name].includes(field));
  if (missing.length || extra.length) {
    fieldDiffs.push(`${name}(缺:${missing.join(",") || "无"} 多:${extra.join(",") || "无"})`);
  }
}
check("同名字段的清单一致", fieldDiffs.length === 0, fieldDiffs.join(" | "));

console.log(`      对照:${sqliteModels.length} 个模型 / ${sqliteModels.reduce((sum, name) => sum + sqlite[name].length, 0)} 个字段`);

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);