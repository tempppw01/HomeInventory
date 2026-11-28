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

// ---------- 存 JSON 的字段:MySQL 必须显式 @db.Text ----------
// 起因(v0.1.129 CI,MySQL 作业):SyncOperation.resultJson 在 SQLite 上是无长度限制的字符串,
// 到了 MySQL 默认变成 VARCHAR(191) —— 一条物品/采购项的结果 JSON 存不下,写入被拒,
// 而调用方那处 .catch 把它吞了:标记在、结果不在,重放永远只能回「已经在处理了」。
// SQLite 没有长度限制,本地套件一路全绿 —— 这条只有真的在 MySQL 上跑才看得见,
// 所以在这里做静态守卫:名字里带 Json 的字段,MySQL 上必须声明清楚它能装多长。
const mysqlText = readFileSync(MYSQL, "utf8");
const jsonFields = [];
for (const line of mysqlText.split("\n")) {
  const match = line.match(/^\s+(\w*Json\w*)\s+String(\?|\[\])?\s*(.*)$/i);
  if (!match) continue;
  jsonFields.push({ name: match[1], declared: (match[3] || "").trim(), ok: /@db\.(Text|MediumText|LongText|VarChar\(\d{4,}\))/.test(match[3] || "") });
}
check(
  "存 JSON 的字段在 MySQL 上声明了足够大的类型(默认 VARCHAR(191) 存不下)",
  jsonFields.length > 0 && jsonFields.every((field) => field.ok),
  jsonFields.map((field) => `${field.name}: ${field.declared || "(没有声明 -> 默认 VARCHAR(191))"}`).join(" | ") || "(一个都没扫到 —— 字段是不是改名字了?)",
);

console.log(`      对照:${sqliteModels.length} 个模型 / ${sqliteModels.reduce((sum, name) => sum + sqlite[name].length, 0)} 个字段`);

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);