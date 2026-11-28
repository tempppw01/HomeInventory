// 换机迁移:把一个实例的完整备份恢复进**另一个(空)实例**,逐项核对。
//
// 为什么必须有这条:此前只验过「同一份库恢复自己」,而恢复端的去重规则**默认按 名称+位置** 判重复 ——
// 空库上第二次遇到同名物品(同一房间放两包口罩、或都没设位置)就被当成「重复」丢掉,**而且什么都不说**。
// 实测:333 件物品的备份恢复进空库只进了 23 件,响应里 skipped=0(它只统计格式错误)。
//
// 现在物品优先按 **itemCode** 判重(备份里本来就有且唯一),换机到空库一件都不会被误判;
// 而「与库里重复而跳过」的条数也会回报(duplicated)。
//
// 需要两个实例:SOURCE_URL(有数据的)与 TARGET_URL(空库)。CI 里用 3001 与空库实例 3002。
// 用法:SOURCE_URL=... TARGET_URL=... PROBE_PASS=... TARGET_PASS=... node scripts/verify-backup-migration.mjs

import { loginCookie } from "./lib/probe-login.mjs";

const SOURCE = process.env.SOURCE_URL || process.env.BASE_URL || "http://127.0.0.1:3001";
const TARGET = process.env.TARGET_URL || "http://127.0.0.1:3005";
const SOURCE_USER = process.env.PROBE_USER || "bgs";
const SOURCE_PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";
const TARGET_USER = process.env.TARGET_USER || "leadcheck";
const TARGET_PASS = process.env.TARGET_PASS || process.env.PROBE_TARGET_PASS || "Lead#2026";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const call = async (base, path, { method = "GET", body, cookie } = {}) => {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json, text };
};

const sourceCookie = await loginCookie(SOURCE, SOURCE_USER, SOURCE_PASS);
const targetCookie = await loginCookie(TARGET, TARGET_USER, TARGET_PASS);

// ---------- 0 目标必须是空库(否则这一套测的不是「换机到新机器」) ----------
const targetBefore = await call(TARGET, "/api/dashboard", { cookie: targetCookie });
const beforeItems = targetBefore.json?.items?.length ?? -1;
check("确认目标实例是空库(否则这不是换机场景)", beforeItems === 0, `目标现有物品=${beforeItems}`);

// ---------- 1 导出源库 ----------
const exported = await call(SOURCE, "/api/backup", { cookie: sourceCookie });
check("能导出源库备份", exported.status === 200 && Array.isArray(exported.json?.items), `status=${exported.status}`);
const backup = exported.json ?? {};
console.log(`      源备份:${Math.round(exported.text.length / 1024)} KB | items=${backup.items?.length} locations=${backup.locations?.length} tasks=${backup.tasks?.length} audits=${backup.audits?.length} activities=${backup.activities?.length}`);
check("源库里确实有物品可迁(防止空跑)", (backup.items?.length ?? 0) > 0, `items=${backup.items?.length}`);

// ---------- 2 恢复进空库 ----------
const restored = await call(TARGET, "/api/backup/restore", { method: "POST", body: backup, cookie: targetCookie });
check("跨实例恢复返回 200", restored.status === 200, `status=${restored.status} ${JSON.stringify(restored.json).slice(0, 140)}`);
const report = restored.json ?? {};

// ---------- 3 一件都不能少 ----------
check("物品**一件不少**地进库(此前会因同名被当成重复而丢掉大半)", Number(report.items) === (backup.items?.length ?? 0), `恢复=${report.items} 备份=${backup.items?.length} 重复跳过=${report.duplicated?.total ?? "-"}`);
check("空间全部进库", Number(report.locations) === (backup.locations?.length ?? 0), `恢复=${report.locations} 备份=${backup.locations?.length}`);
check("任务全部进库", Number(report.tasks) === (backup.tasks?.length ?? 0), `恢复=${report.tasks} 备份=${backup.tasks?.length}`);
check("盘点记录全部进库", Number(report.audits) === (backup.audits?.length ?? 0), `恢复=${report.audits} 备份=${backup.audits?.length}`);
check("偏好设置进库", Number(report.preferences) === 1, `恢复=${report.preferences}`);
check("活动记录按窗口导入且如实说明未导条数", Number(report.activities) + Number(report.notImported?.activities ?? 0) <= (backup.activities?.length ?? 0) && Number.isFinite(Number(report.notImported?.activities)), `导入=${report.activities} 未导=${report.notImported?.activities}`);

// ---------- 4 目标库实地核对 ----------
// 读物品要连**回收站**一起读:备份里本来就带着已删除的行(`deletedAt` 有值),而 v0.1.135 起
// 恢复后它们老老实实留在回收站里 —— 这正是 v0.1.135 想要的;可这里原来读的是 /api/dashboard
// (只给活物品),于是「恢复 12 件、读回 11 件」,2026-11-28 就这么让 CI 红了一整轮(v0.1.135 的
// Release 也因此没发出来)。物品总数对不上时,下面还按「活 / 回收站」拆开报,免得下次又靠猜。
const targetItems = await call(TARGET, "/api/items?includeDeleted=1", { cookie: targetCookie });
const items = Array.isArray(targetItems.json) ? targetItems.json : [];
const trashCount = items.filter((row) => row.deletedAt).length;
check(
  "目标库读得到全部物品(含回收站)",
  items.length === (backup.items?.length ?? 0),
  `读回=${items.length}(活 ${items.length - trashCount} · 回收站 ${trashCount}) 备份=${backup.items?.length} status=${targetItems.status}`,
);
check(
  "备份里已删除的物品在目标库里也是已删除的(不是被救活成新物品)",
  trashCount === (backup.items ?? []).filter((row) => row.deletedAt).length,
  `目标回收站=${trashCount} 备份里已删除=${(backup.items ?? []).filter((row) => row.deletedAt).length}`,
);
const sourceItem = backup.items.find((item) => item.locationId) ?? backup.items[0];
const restoredItem = items.find((item) => item.name === sourceItem?.name);
check("物品名称能对上", Boolean(restoredItem), `找的是 ${sourceItem?.name}`);
check("位置被映射到新库的空间(不是沿用原 id)", Boolean(restoredItem?.location?.name ?? backup.items.some((item) => !item.locationId)), `location=${JSON.stringify(restoredItem?.location ?? null)}`);

const targetTasks = await call(TARGET, "/api/tasks", { cookie: targetCookie });
check("目标库读得到任务", (targetTasks.json?.tasks?.length ?? -1) === (backup.tasks?.length ?? 0), `读回=${targetTasks.json?.tasks?.length}`);
const sourceTask = backup.tasks?.[0];
if (sourceTask) {
  const same = (targetTasks.json?.tasks ?? []).find((task) => task.title === sourceTask.title);
  check("任务到期时间解析正确", Boolean(same) && Math.abs(new Date(same.dueAt).getTime() - new Date(sourceTask.dueAt).getTime()) < 1000, `源=${sourceTask.dueAt} 目标=${same?.dueAt ?? "(没找到)"}`);
}
// 偏好设置仍在 /api/dashboard 上(它给的是当前生效的偏好,而不是物品列表)
const targetDash = await call(TARGET, "/api/dashboard", { cookie: targetCookie });
check("偏好设置与源一致", Number(targetDash.json?.preferences?.expiryReminderDays) === Number(backup.preferences?.[0]?.expiryReminderDays), `目标=${targetDash.json?.preferences?.expiryReminderDays} 源=${backup.preferences?.[0]?.expiryReminderDays}`);

// ---------- 5 再恢复一次:应当报告「重复」而不是再造一份 ----------
const again = await call(TARGET, "/api/backup/restore", { method: "POST", body: backup, cookie: targetCookie });
check("重复恢复仍然 200", again.status === 200, `status=${again.status}`);
check(
  "重复恢复不再新增物品,并如实report 重复条数",
  Number(again.json?.items ?? -1) === 0 && Number(again.json?.duplicated?.total ?? 0) >= (backup.items?.length ?? 0),
  JSON.stringify(again.json).slice(0, 200),
);
const afterAgain = await call(TARGET, "/api/items?includeDeleted=1", { cookie: targetCookie });
const afterRows = Array.isArray(afterAgain.json) ? afterAgain.json : [];
check("物品总数没有被恢复两次而翻倍(含回收站)", afterRows.length === items.length, `${items.length} → ${afterRows.length}`);

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);