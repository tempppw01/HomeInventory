// 任务完成的两条路径核对(直接读库,确认数据真的变了)。
//
// 为什么需要:界面上「完成」只是一次 PATCH,真正重要的是数据后果 ——
//   · 周期任务应该**推进同一个任务的到期日**(不是新建一条,也不是草草标记完成)
//   · 一次性任务应该变 DONE,再点一次能恢复为待办
// 这类「提示说做完了、数据没变」的问题,只有核对数据才看得出来。
//
// 用法:
//   PROBE_USER=bgs PROBE_PASS=... node scripts/verify-task-recurrence.mjs

import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS;
if (!PASS) throw new Error("set PROBE_PASS");

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: USER, password: PASS }),
});
if (!login.ok) {
  check("登录成功", false, `status=${login.status}`);
  process.exit(1);
}
const cookie = (login.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");

const prisma = new PrismaClient();

const toggle = async (id) => {
  const response = await fetch(`${BASE}/api/tasks`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ id, action: "toggle" }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

// ============ ① 周期任务:推进到期日,而不是标记完成 ============
{
  const title = "核对·周期任务";
  await prisma.householdTask.deleteMany({ where: { title } });
  const created = await prisma.householdTask.create({
    data: { title, dueAt: new Date(Date.now() + 86400_000), recurrence: "MONTHLY" },
  });
  const originalDue = created.dueAt.getTime();

  const res = await toggle(created.id);
  check("周期任务:完成请求成功", res.status === 200, `status=${res.status} ${JSON.stringify(res.body).slice(0, 80)}`);

  const after = await prisma.householdTask.findUnique({ where: { id: created.id } });
  const delta = after ? after.dueAt.getTime() - originalDue : 0;
  check("周期任务:到期日推进约一个月", delta > 27 * 86400_000 && delta < 32 * 86400_000, `原=${created.dueAt.toISOString().slice(0, 10)} 现=${after?.dueAt.toISOString().slice(0, 10)}`);
  check("周期任务:记录了完成时间", Boolean(after?.completedAt), `completedAt=${after?.completedAt?.toISOString().slice(0, 10) ?? "null"}`);
  check("周期任务:状态保持 OPEN(等下一轮)", after?.status === "OPEN", `status=${after?.status}`);

  await prisma.householdTask.deleteMany({ where: { title } });
}

// ============ ② 一次性任务:变 DONE,可再点恢复 ============
{
  const title = "核对·一次性任务";
  await prisma.householdTask.deleteMany({ where: { title } });
  const created = await prisma.householdTask.create({
    data: { title, dueAt: new Date(Date.now() + 86400_000), recurrence: "NONE" },
  });

  await toggle(created.id);
  const afterDone = await prisma.householdTask.findUnique({ where: { id: created.id } });
  check("一次性任务:状态变 DONE", afterDone?.status === "DONE", `status=${afterDone?.status}`);
  check("一次性任务:记录了完成时间", Boolean(afterDone?.completedAt), `completedAt=${afterDone?.completedAt?.toISOString().slice(0, 10) ?? "null"}`);

  await toggle(created.id);
  const afterReopen = await prisma.householdTask.findUnique({ where: { id: created.id } });
  check("一次性任务:再点一次恢复为待办", afterReopen?.status === "OPEN", `status=${afterReopen?.status}`);

  await prisma.householdTask.deleteMany({ where: { title } });
}

await prisma.$disconnect();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);