// 自动备份的验收:它有没有在跑、负载完不完整、旧文件会不会无上限堆积。
//
// 本轮量到的三件事:
//   1 每日自动备份与手动导出是**两套实现**,已经漂开 —— 自动备份还是 version 1、不含任务/盘点/偏好,
//      而手动导出已是 version 2。用户真要在灾难后恢复的那份,反而少东西;
//   2 **没有任何保留策略**:本机 10 份已 27 MB,而备份文件会随活动记录增长(每份约 2.7 MB);
//   3 界面上**完全没有**自动备份的状态,而客户端触发是 `.catch(() => undefined)` ——
//      连着几天没备份,用户也看不出来。
//
// 现在:两条路径共用 buildBackupPayload(版本 2、字段一致);保留最近 BACKUP_KEEP 份(默认 14);
// GET /api/backup/auto 给出状态供界面显示;触发失败会弹提示。
//
// v0.1.136 补的:文件名里要能看出**是哪份库**写的。实测家庭库 2026-11-28 的那份被同一台
// 机器上的探针实例顶掉(9 件物品 → 探针库的 15 件「界面检查·…」),文件名上完全看不出来。
// 所以这一版钉住:备份里记库指纹;同一天已有别人的文件时另存 `-<指纹>` 而不是覆盖;
// 带指纹的名字恢复入口也认(否则那份就恢复不了了)。跨实例的端到端验证见 .github/release-notes/v0.1.136.md。
//
// 用法:BASE_URL=... PROBE_USER=... PROBE_PASS=... node scripts/verify-auto-backup.mjs

import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const cookie = await loginCookie(BASE, USER, PASS);
const call = async (path, opts = {}) => {
  const response = await fetch(BASE + path, { method: opts.method ?? "GET", headers: { "content-type": "application/json", cookie }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json };
};

// 备份目录:与接口同一套推导逻辑
const backupDir = process.env.BACKUP_DIR || path.join(process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), "data"), "backups");
// 文件名规则与 src/lib/backup-files.ts 的 BACKUP_FILE_PATTERN 一致:`-<6 位库指纹>` 后缀可选
const BACKUP_NAME = /^home-inventory-\d{4}-\d{2}-\d{2}(?:-[0-9a-f]{6})?\.json$/;
const listBackups = async () => {
  try {
    return (await readdir(backupDir)).filter((name) => BACKUP_NAME.test(name)).sort();
  } catch { return []; }
};

// 本地日历日:文件名里的日期按**用户所在时区**算(src/lib/local-date.ts)。
// 用 `toISOString().slice(0,10)` 那是 UTC 日,在东八区的 00:00~08:00 之间会差一天 ——
// verify-search-history-and-backup.mjs 就这么在凌晨红过一次。
const localDateString = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

// 库指纹:接口侧是 DATABASE_URL 的 sha256 前 6 位(接口与脚本必须同一份库、同一个 DATABASE_URL)
const fingerprintOf = (databaseUrl) => createHash("sha256").update(String(databaseUrl ?? "(未设置)")).digest("hex").slice(0, 6);
const expectedFingerprint = fingerprintOf(process.env.DATABASE_URL);

// ---------- 1 状态接口 ----------
const status = await call("/api/backup/auto");
check("能读到自动备份状态", status.status === 200 && status.json !== null, `status=${status.status}`);
check(
  "状态里含「上次成功时间 / 保留份数 / 现有份数」",
  Object.prototype.hasOwnProperty.call(status.json ?? {}, "lastAutoBackupAt") && Number.isFinite(Number(status.json?.keep)) && Number.isFinite(Number(status.json?.files)),
  JSON.stringify(status.json),
);
check("保留份数是正整数(默认 14)", Number(status.json?.keep) >= 1, `keep=${status.json?.keep}`);
check(
  "状态接口给出了本库指纹(界面据此把每条备份标成「本机 / 另一份库」)",
  status.json?.database === expectedFingerprint,
  `接口=${status.json?.database ?? "(没有这个字段)"} 本库=${expectedFingerprint}`,
);
check(
  "状态接口列出的文件名都是恢复入口认的名字(否则界面上选了也恢复不了)",
  Array.isArray(status.json?.fileNames) && status.json.fileNames.every((name) => BACKUP_NAME.test(String(name))),
  JSON.stringify(status.json?.fileNames ?? null).slice(0, 160),
);
// 名字里没写来源的那几份(占着朴素名的、升级前的老备份),接口要去内容里认一下是谁写的 ——
// 只读每份文件末尾 256 字节。实测踩到过:先写的那份占着朴素名,名字上什么都没写,
// 内容里却是**另一个库**的指纹,只看名字会把它标成「本机」。
{
  const origins = status.json?.fileOrigins ?? null;
  const bare = (status.json?.fileNames ?? []).filter((name) => !/-[0-9a-f]{6}\.json$/.test(name));
  check(
    "名字里没写来源的备份,接口都去内容里认过了(fileOrigins 不缺项)",
    origins !== null && bare.every((name) => Object.prototype.hasOwnProperty.call(origins, name)),
    `朴素名=${bare.join(",") || "(没有)"} fileOrigins=${JSON.stringify(origins ?? null).slice(0, 140)}`,
  );
}

// ---------- 2 真的跑一次 ----------
const prisma = new PrismaClient();
await prisma.householdPreference.upsert({ where: { id: "default" }, create: { id: "default" }, update: { lastAutoBackupAt: null } });
const posted = await call("/api/backup/auto", { method: "POST" });
await prisma.$disconnect();
check("POST 自动备份返回 200", posted.status === 200, `status=${posted.status} ${JSON.stringify(posted.json).slice(0, 120)}`);
check("确实写出了一份(或明确说明今天已备份)", posted.json?.saved === true || posted.json?.skipped === true, JSON.stringify(posted.json));

const files = await listBackups();
// 断言接口自己说的那个文件名真的在目录里(原来是拿 **UTC 日**拼名字比,而且末尾缀着
// `|| files.length > 0` —— 等于永远为真,什么都没验)。
const writtenName = typeof posted.json?.file === "string" ? posted.json.file : null;
check(
  "备份目录里出现了接口说的那份文件",
  Boolean(writtenName) && BACKUP_NAME.test(writtenName) && files.includes(writtenName),
  `接口说=${writtenName ?? "(没说)"} 目录最新=${files.at(-1) ?? "(无)"}`,
);
check(
  "文件名用的是本地日,且朴素名/带指纹名二选一",
  Boolean(writtenName) && (writtenName === `home-inventory-${localDateString()}.json` || writtenName === `home-inventory-${localDateString()}-${expectedFingerprint}.json`),
  `接口说=${writtenName ?? "(没说)"} 本地今天=${localDateString()} 本库指纹=${expectedFingerprint}`,
);

// ---------- 3 负载必须与手动导出同构(这是本轮的漂移点) ----------
const writtenFile = writtenName ? path.join(backupDir, writtenName) : (files.length ? path.join(backupDir, files.at(-1)) : null);
if (writtenFile) {
  const payload = JSON.parse(await readFile(writtenFile, "utf8"));
  check("自动备份的版本号 ≥ 2", Number(payload.version) >= 2, `version=${payload.version}`);
  for (const key of ["items", "locations", "shopping", "priceRecords", "members", "activities", "tasks", "audits", "preferences"]) {
    check(`自动备份含 ${key}(与手动导出一致)`, Array.isArray(payload[key]), `实际=${typeof payload[key]}`);
  }
  // 库指纹:下一次备份(以及同一台机器上的别的实例)据此判断这份能不能覆盖
  check(
    "这份备份记下了写它的库的指纹",
    payload.database === expectedFingerprint,
    `文件里=${payload.database ?? "(没有这个字段)"} 本库=${expectedFingerprint}(DATABASE_URL 的 sha256 前 6 位)`,
  );
  check(
    "指纹是 6 位小写十六进制(不会把连接串/口令写进备份)",
    /^[0-9a-f]{6}$/.test(String(payload.database ?? "")) && !JSON.stringify(payload.database ?? "").includes("//"),
    `database=${String(payload.database).slice(0, 40)}`,
  );
  check(
    "备份里没有 DATABASE_URL 原串(连接串带口令,不该写进备份)",
    !JSON.stringify(payload).includes(String(process.env.DATABASE_URL ?? "\u0000")),
    "备份里不该出现 DATABASE_URL 原串",
  );

  // 同一天再备份一次:自己的文件可以覆盖,不该生出 `-指纹` 副本
  {
    const prisma2 = new PrismaClient();
    await prisma2.householdPreference.update({ where: { id: "default" }, data: { lastAutoBackupAt: null } });
    await prisma2.$disconnect();
    const again = await call("/api/backup/auto", { method: "POST" });
    check(
      "同一天再备份一次仍写同一个名字(自己的文件覆盖自己的,不生出副本)",
      again.json?.file === writtenName,
      `第一次=${writtenName ?? "(没说)"} 第二次=${again.json?.file ?? "(没说)"}`,
    );
    // 这一份是**本库**刚写的:文件名里带指纹就从名字认,占着朴素名就从内容认 —— 两条路都得认成「本库的」
    const statusNow = await call("/api/backup/auto");
    const fromContent = statusNow.json?.fileOrigins?.[String(writtenName)] ?? null;
    const resolved = /-[0-9a-f]{6}\.json$/.test(String(writtenName)) ? /-([0-9a-f]{6})\.json$/.exec(String(writtenName))?.[1] ?? null : fromContent;
    check(
      "接口自己刚写的那份备份,能被认成「本库的」(界面才敢标「本机」)",
      resolved === expectedFingerprint,
      `名字=${writtenName ?? "(没说)"} 内容里=${fromContent} 期望=${expectedFingerprint}`,
    );
  }
}

// ---------- 3.5 恢复入口要认得带指纹的名字 ----------
// 同一天两份备份(本库 + 另一个实例)里,带指纹那一份也必须能恢复,否则它等于白存。
{
  const accepted = await call("/api/backup/restore", { method: "POST", body: { fromFile: "home-inventory-1999-01-01-abc123.json" } });
  check(
    "带库指纹的备份文件名被恢复入口接受(是 404「找不到」,不是 400「名字不合法」)",
    accepted.status === 404,
    `status=${accepted.status} ${String(accepted.json?.error ?? "").slice(0, 70)}`,
  );
  const rejected = await call("/api/backup/restore", { method: "POST", body: { fromFile: "home-inventory-1999-01-01-abc12.json" } });
  check("后缀不是 6 位十六进制时仍然拒掉(400)", rejected.status === 400, `status=${rejected.status} ${String(rejected.json?.error ?? "").slice(0, 70)}`);
}

// ---------- 4 保留策略:旧文件不能无上限堆积 ----------
{
  const keep = Number(status.json?.keep ?? 14);
  // 带库指纹的名字按指纹各自成组,保留份数是**每组** keep 份(不然另一个实例的备份会把本库的历史挤掉)
  const groupOf = (name) => /-([0-9a-f]{6})\.json$/.exec(name)?.[1] ?? "";
  const byGroup = (list) => {
    const groups = new Map();
    for (const name of list) groups.set(groupOf(name), [...(groups.get(groupOf(name)) ?? []), name]);
    return groups;
  };
  const fakes = [];
  // 造得比保留上限还多(否则这份库本来就没几份备份时,清理根本不会触发 —— 实测就这么假红过)。
  for (let day = 1; day <= keep + 5; day += 1) {
    const name = `home-inventory-2019-01-${String(day).padStart(2, "0")}.json`;
    await writeFile(path.join(backupDir, name), "{}", "utf8");
    fakes.push(name);
  }
  const beforeList = await listBackups();
  check("（前置）造出的旧备份数已超过保留份数", beforeList.length > keep, `现有=${beforeList.length} keep=${keep}`);

  // 清掉今天已备份的标记,让 POST 真的写一份并触发清理
  const prisma2 = new PrismaClient();
  await prisma2.householdPreference.update({ where: { id: "default" }, data: { lastAutoBackupAt: null } });
  await prisma2.$disconnect();

  const trimmed = await call("/api/backup/auto", { method: "POST" });
  const after = await listBackups();
  const over = [...byGroup(after).entries()].filter(([, list]) => list.length > keep);
  check(
    "清理后每组份数都不超过保留上限(按库指纹分别保留)",
    over.length === 0,
    `清理后=${after.length} keep=${keep} 分组=${[...byGroup(after).entries()].map(([g, list]) => `${g || "朴素"}:${list.length}`).join(",")}`,
  );
  check("接口如实报告清理了几份", Number(trimmed.json?.removed ?? -1) >= 1 && Number(trimmed.json?.kept) === keep, JSON.stringify(trimmed.json));

  const leftovers = await listBackups();
  // 精确断言:每组留下的应当是**该组最新的 keep 份**(按文件名排序),也就是最旧的那几份被删了。
  const keptWrong = [...byGroup(beforeList).entries()].flatMap(([group, list]) => {
    const kept = [...list].sort().slice(-keep);
    const actual = byGroup(leftovers).get(group) ?? [];
    return actual.join(",") === kept.join(",") ? [] : [`${group || "朴素"}: 实际 ${actual.length} 份 / 应有 ${kept.length} 份`];
  });
  check(
    "保留的是每组最新的 keep 份(最旧的被删掉)",
    keptWrong.length === 0 && !leftovers.includes("home-inventory-2019-01-01.json"),
    keptWrong.join(" | ") + ` | 实际 ${leftovers.length} 份,例:${leftovers.slice(0, 3).join(",")}`,
  );

  // 收尾:把我造的文件清掉(若还在)
  for (const name of fakes) await rm(path.join(backupDir, name), { force: true });
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);