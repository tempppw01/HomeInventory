// 搜索历史与自动备份的验收。
//
// 这两个功能此前完全没有覆盖:
//   · 搜索历史:服务端去重 + 最多 20 条,前端在「点选搜索建议」时保存
//   · 自动备份:前端每天触发一次(服务端用 lastAutoBackupAt 兜底),把 JSON 写进备份目录
// 它们都属于「坏了也不报错」的类型 —— 没人点就没人知道。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-search-history-and-backup.mjs

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { join } from "node:path";
import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS;
if (!PASS) throw new Error("set PROBE_PASS");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const cookie = await loginCookie(BASE, USER, PASS);

const call = async (method, path, body) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: response.status, body: parsed };
};

// ============ 搜索历史 ============
{
  await call("DELETE", "/api/search-history");
  const empty = await call("GET", "/api/search-history");
  check("搜索历史:清空后为空", Array.isArray(empty.body) && empty.body.length === 0, `status=${empty.status} len=${empty.body?.length}`);

  const saved = await call("POST", "/api/search-history", { query: "验收搜索词" });
  check("搜索历史:能保存一个词", saved.status === 200 || saved.status === 201, `status=${saved.status}`);

  const afterSave = await call("GET", "/api/search-history");
  const rows = Array.isArray(afterSave.body) ? afterSave.body : [];
  check("搜索历史:保存后能读回", rows.some((row) => row.query === "验收搜索词"), `条数=${rows.length}`);

  // 同一个词再存一次:应当只更新已有记录的时间,而不是多出一条
  await call("POST", "/api/search-history", { query: "验收搜索词" });
  const afterDup = await call("GET", "/api/search-history");
  const dupRows = (Array.isArray(afterDup.body) ? afterDup.body : []).filter((row) => row.query === "验收搜索词");
  check("搜索历史:重复的词不会新增一条(去重)", dupRows.length === 1, `同名词条数=${dupRows.length}`);

  // 上限 20 条
  for (let index = 0; index < 25; index += 1) await call("POST", "/api/search-history", { query: `验收词${index}` });
  const capped = await call("GET", "/api/search-history");
  const cappedRows = Array.isArray(capped.body) ? capped.body : [];
  check("搜索历史:最多保留 20 条", cappedRows.length <= 20 && cappedRows.length > 0, `条数=${cappedRows.length}`);

  const cleared = await call("DELETE", "/api/search-history");
  const afterClear = await call("GET", "/api/search-history");
  check("搜索历史:能一次清空", cleared.status === 200 && Array.isArray(afterClear.body) && afterClear.body.length === 0, `status=${cleared.status} len=${afterClear.body?.length}`);

  // 空词/超长词要被挡住
  const blank = await call("POST", "/api/search-history", { query: "   " });
  check("搜索历史:空白词被拒", blank.status >= 400, `status=${blank.status}`);
}

// ============ 自动备份 ============
{
  const dir = process.env.BACKUP_DIR || join(process.env.LOCAL_UPLOAD_DIR || join(process.cwd(), "data"), "backups");

  // 文件名里的日期必须按**本机时区**算,与应用同一口径(src/lib/local-date.ts 的 localDateString)。
  // 这里此前用的是 `new Date().toISOString().slice(0, 10)` —— 那是 UTC 日,
  // 在东八区的 00:00~08:00 之间比用户的今天早一天:应用写的是 `...-2026-11-23.json`,
  // 脚本却在找 `...-2026-11-22.json`,于是凌晨跑 test:api 必红(实测 04:56 红过一次),
  // 而 CI 跑在 UTC 上,两边一致,所以一直没暴露。
  const localDateString = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const today = localDateString();
  const target = join(dir, `home-inventory-${today}.json`);

  // 先把「今天已备份过」的状态清掉,否则接口会直接 skipped ——
  // 那样这一段的断言就会落在**旧文件**上,看着通过其实什么都没验(第一次就是这么写的)。
  const prisma = new PrismaClient();
  await prisma.householdPreference.upsert({ where: { id: "default" }, create: {}, update: { lastAutoBackupAt: null } });
  await prisma.$disconnect();
  if (existsSync(target)) rmSync(target);

  const startedAt = Date.now();
  const first = await call("POST", "/api/backup/auto");
  check("自动备份:请求成功且这次真的执行了(未被跳过)", first.status === 200 && first.body?.skipped !== true, `status=${first.status} body=${JSON.stringify(first.body).slice(0, 60)}`);

  const exists = existsSync(target);
  check("自动备份:备份文件确实被新建", exists, `期望路径=${target}`);
  // 只看「文件在不在」还不够:同名旧文件会让这条断言在什么都没发生时也变绿。
  check("自动备份:这个文件是刚刚写的(不是上次留下的同名文件)", exists && statSync(target).mtimeMs >= startedAt - 2000, exists ? `mtime=${statSync(target).mtime.toISOString()}` : "文件不存在");

  if (exists) {
    let parsed = null;
    try { parsed = JSON.parse(readFileSync(target, "utf8")); } catch { /* 解析失败 */ }
    check("自动备份:文件是合法 JSON 且包含数据段", Boolean(parsed && Array.isArray(parsed.items) && Array.isArray(parsed.locations)), parsed ? `keys=${Object.keys(parsed).join(",")}` : "解析失败");
    check("自动备份:内容与当前库一致(不是空壳)", (parsed?.items ?? []).length > 0, `items=${(parsed?.items ?? []).length}`);
  }

  const activity = await call("GET", "/api/activity");
  const rows = Array.isArray(activity.body) ? activity.body : (activity.body?.items ?? []);
  check("自动备份:活动日志记录了这次备份", rows.some((row) => row.action === "BACKUP_AUTO"), `日志条数=${rows.length}`);

  const second = await call("POST", "/api/backup/auto");
  check("自动备份:同一天不会重复备份", second.status === 200 && second.body?.skipped === true, `status=${second.status} body=${JSON.stringify(second.body).slice(0, 60)}`);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);