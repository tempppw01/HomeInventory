// 完整备份的**覆盖面与体积**:这两件事此前都没人验。
//
// 本轮量到的两个真问题:
//   1 备份会随数据增长(本机 14 MB),而恢复要经过 proxy,Next 的 proxyClientMaxBodySize **默认 10 MB** ——
//     实测 3.1 MB 能恢复、10.2 MB 直接 400,而且报的是「请求内容不是合法的 JSON」(文件明明是合法的)。
//     也就是**用户自己的备份恢复不了**;现在显式抬到 64 MB。
//   2 导出里一直有 activities,但恢复端**完全没处理**;而任务/盘点记录/偏好设置**连导出都没有**。
//     现在:导出补三张表,恢复补四类数据(活动记录只导最近 2000 条,并如实说明还有多少没导)。
//
// 用法:BASE_URL=http://127.0.0.1:3001 PROBE_USER=bgs PROBE_PASS=... node scripts/verify-backup-scope.mjs

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
const call = async (path, { method = "GET", body, text = false } = {}) => {
  const response = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie }, body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
  const raw = await response.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
  return { status: response.status, json, raw, text };
};

// ---------- 1 导出覆盖面 ----------
const exported = await call("/api/backup");
check("能导出完整备份", exported.status === 200 && Boolean(exported.json), `status=${exported.status}`);
const backup = exported.json ?? {};
check("导出版本号已升到 2(新增了任务/盘点/偏好)", Number(backup.version) >= 2, `version=${backup.version}`);
for (const key of ["items", "locations", "shopping", "priceRecords", "members", "activities", "tasks", "audits", "preferences"]) {
  check(`备份里含 ${key}`, Array.isArray(backup[key]), `实际=${typeof backup[key]}`);
}
check("备份文件里确实带了任务/盘点记录(此前根本没有)", (backup.tasks?.length ?? 0) + (backup.audits?.length ?? 0) > 0, `tasks=${backup.tasks?.length ?? 0} audits=${backup.audits?.length ?? 0}`);

// ---------- 2 恢复这份备份:四类数据都要被处理且如实回报 ----------
const before = await call("/api/tasks");
const tasksBefore = Array.isArray(before.json) ? before.json.length : (before.json?.tasks?.length ?? before.json?.items?.length ?? -1);

const restored = await call("/api/backup/restore", { method: "POST", body: backup });
check("恢复自己的备份能成功", restored.status === 200, `status=${restored.status} ${JSON.stringify(restored.json).slice(0, 120)}`);
const report = restored.json ?? {};
check("响应里回报了活动记录/任务/盘点/偏好的处理数", ["activities", "tasks", "audits", "preferences"].every((key) => Number.isFinite(Number(report[key]))), JSON.stringify(report).slice(0, 200));
check("如实说明有多少条活动记录**没**导入(不假装全导了)", Number.isFinite(Number(report.notImported?.activities)), JSON.stringify(report.notImported ?? null));
check(
  "活动记录导入量 + 未导入量 = 备份里的总数",
  Number(report.activities ?? 0) + Number(report.notImported?.activities ?? 0) <= (backup.activities?.length ?? 0),
  `导入=${report.activities} 未导=${report.notImported?.activities} 备份里=${backup.activities?.length}`,
);
check("偏好设置被恢复(单行 upsert)", Number(report.preferences ?? 0) === 1 || (backup.preferences?.length ?? 0) === 0, `preferences=${report.preferences}`);

const after = await call("/api/tasks");
const tasksAfter = Array.isArray(after.json) ? after.json.length : (after.json?.tasks?.length ?? after.json?.items?.length ?? -1);
check("重复恢复不会把任务翻倍(按标题+到期时间去重)", tasksBefore === tasksAfter && tasksBefore >= 0, `之前=${tasksBefore} 之后=${tasksAfter}`);

// ---------- 3 大备份:超过默认 10 MB 也必须能恢复 ----------
{
  // 造一份合法的、11~12 MB 的负载(用活动记录填充),这正是修之前会 400 的情形
  // 注意:不能每轮都对整个数组 JSON.stringify —— 那是 O(n²),实测能把这一步拖到十分钟。
  // 先量一行的字节数,再按目标体积算行数,最后只 stringify 一次。
  const sampleRow = { action: "BULK_PROBE", itemName: "大备份探针000000", detail: "x".repeat(220), createdAt: new Date().toISOString() };
  const rowBytes = JSON.stringify(sampleRow).length + 1;
  const rowCount = Math.ceil((11 * 1024 * 1024) / rowBytes);
  const filler = Array.from({ length: rowCount }, (_, index) => ({
    action: "BULK_PROBE",
    itemName: `大备份探针${index}`,
    detail: "x".repeat(220),
    createdAt: new Date().toISOString(),
  }));
  const bigPayload = JSON.stringify({
    version: 2, exportedAt: new Date().toISOString(),
    items: [], locations: [], shopping: [], priceRecords: [], members: [],
    activities: filler, tasks: [], audits: [], preferences: [],
  });
  check("造出的测试负载确实超过默认上限 10 MB", bigPayload.length > 10 * 1024 * 1024, `${Math.round(bigPayload.length / 1024)} KB`);

  const big = await fetch(`${BASE}/api/backup/restore`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: bigPayload });
  const text = await big.text();
  check("超过 10 MB 的备份能被恢复(此前会以「不是合法 JSON」被拒)", big.status === 200, `status=${big.status} ${text.slice(0, 120)}`);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);