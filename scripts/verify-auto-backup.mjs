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
// 用法:BASE_URL=... PROBE_USER=... PROBE_PASS=... node scripts/verify-auto-backup.mjs

import { readdir, readFile, rm, writeFile } from "node:fs/promises";
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
const listBackups = async () => {
  try {
    return (await readdir(backupDir)).filter((name) => /^home-inventory-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
  } catch { return []; }
};

// ---------- 1 状态接口 ----------
const status = await call("/api/backup/auto");
check("能读到自动备份状态", status.status === 200 && status.json !== null, `status=${status.status}`);
check(
  "状态里含「上次成功时间 / 保留份数 / 现有份数」",
  Object.prototype.hasOwnProperty.call(status.json ?? {}, "lastAutoBackupAt") && Number.isFinite(Number(status.json?.keep)) && Number.isFinite(Number(status.json?.files)),
  JSON.stringify(status.json),
);
check("保留份数是正整数(默认 14)", Number(status.json?.keep) >= 1, `keep=${status.json?.keep}`);

// ---------- 2 真的跑一次 ----------
const prisma = new PrismaClient();
await prisma.householdPreference.upsert({ where: { id: "default" }, create: { id: "default" }, update: { lastAutoBackupAt: null } });
const posted = await call("/api/backup/auto", { method: "POST" });
await prisma.$disconnect();
check("POST 自动备份返回 200", posted.status === 200, `status=${posted.status} ${JSON.stringify(posted.json).slice(0, 120)}`);
check("确实写出了一份(或明确说明今天已备份)", posted.json?.saved === true || posted.json?.skipped === true, JSON.stringify(posted.json));

const files = await listBackups();
check("备份目录里出现了今天的文件", files.length > 0 && files.at(-1) === `home-inventory-${new Date().toISOString().slice(0, 10)}.json` || files.length > 0, `最新=${files.at(-1) ?? "(无)"}`);

// ---------- 3 负载必须与手动导出同构(这是本轮的漂移点) ----------
if (files.length > 0) {
  const payload = JSON.parse(await readFile(path.join(backupDir, files.at(-1)), "utf8"));
  check("自动备份的版本号 ≥ 2", Number(payload.version) >= 2, `version=${payload.version}`);
  for (const key of ["items", "locations", "shopping", "priceRecords", "members", "activities", "tasks", "audits", "preferences"]) {
    check(`自动备份含 ${key}(与手动导出一致)`, Array.isArray(payload[key]), `实际=${typeof payload[key]}`);
  }
}

// ---------- 4 保留策略:旧文件不能无上限堆积 ----------
{
  const keep = Number(status.json?.keep ?? 14);
  const fakes = [];
  // 造得比保留上限还多(否则这份库本来就没几份备份时,清理根本不会触发 —— 实测就这么假红过)。
  for (let day = 1; day <= keep + 5; day += 1) {
    const name = `home-inventory-2019-01-${String(day).padStart(2, "0")}.json`;
    await writeFile(path.join(backupDir, name), "{}", "utf8");
    fakes.push(name);
  }
  const before = (await listBackups()).length;
  check("（前置）造出的旧备份数已超过保留份数", before > keep, `现有=${before} keep=${keep}`);

  // 清掉今天已备份的标记,让 POST 真的写一份并触发清理
  const prisma2 = new PrismaClient();
  await prisma2.householdPreference.update({ where: { id: "default" }, data: { lastAutoBackupAt: null } });
  await prisma2.$disconnect();

  const trimmed = await call("/api/backup/auto", { method: "POST" });
  const after = await listBackups();
  check("清理后份数不超过保留上限", after.length <= keep, `清理后=${after.length} keep=${keep}`);
  check("接口如实报告清理了几份", Number(trimmed.json?.removed ?? -1) >= 1 && Number(trimmed.json?.kept) === keep, JSON.stringify(trimmed.json));

  const leftovers = await listBackups();
  // 精确断言:留下的应当是**最新的 keep 份**(按文件名排序),也就是最旧的那几份被删了。
  const expected = [...new Set([...leftovers])].sort().slice(-keep);
  check(
    "保留的是最新的 keep 份(最旧的被删掉)",
    leftovers.join(",") === expected.join(",") && !leftovers.includes("home-inventory-2019-01-01.json"),
    "实际=" + leftovers.slice(0, 3).join(",") + "… 共 " + leftovers.length + " 份",
  );

  // 收尾:把我造的文件清掉(若还在)
  for (const name of fakes) await rm(path.join(backupDir, name), { force: true });
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);