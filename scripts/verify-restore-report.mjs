// 恢复「老版本备份」时,**跳过的行必须被报出来**。
//
// 由来(实测):一份 4 行的老备份(第 2 行缺 unit、第 3 行 type 写成中文「消耗品」、第 4 行缺 category)
// 恢复后只回了 {"items":1} —— 3 行被静默丢掉,界面上也还是「已合并恢复 1 件物品」,
// 而确认文案写着「重复数据会自动跳过」,更像只有重复才会跳过。
// 对升级的人来说这是最糟的失败方式:以为恢复完了,其实少了三件东西。
//
// 现在:接口回 skipped.total + 最多 10 条示例(行号、名称、**中文原因并点名字段**),界面照实显示。
//
// 用法:BASE_URL=http://127.0.0.1:3001 PROBE_USER=bgs PROBE_PASS=... node scripts/verify-restore-report.mjs

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
const api = async (method, path, body) => {
  const response = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 120) }; }
  return { status: response.status, json };
};

const STAMP = Date.now().toString(36).slice(-5);
const PREFIX = `恢复报告探针${STAMP}`;
const backup = {
  items: [
    // 1 合规
    { id: "a", name: `${PREFIX}·正常`, category: "日用", type: "DURABLE", quantity: 2, unit: "个" },
    // 2 很早期的写法:缺 unit
    { id: "b", name: `${PREFIX}·缺单位`, category: "日用", type: "DURABLE", quantity: 1 },
    // 3 类型写成中文
    { id: "c", name: `${PREFIX}·中文类型`, category: "日用", type: "消耗品", quantity: 1, unit: "袋" },
    // 4 缺 category
    { id: "d", name: `${PREFIX}·缺分类`, type: "DURABLE", quantity: 1, unit: "个" },
  ],
  locations: [],
  shopping: [],
};

const restored = await api("POST", "/api/backup/restore", backup);
check("恢复接口不报错(老备份里有坏行属于正常,不该整份失败)", restored.status === 200, `status=${restored.status} ${JSON.stringify(restored.json).slice(0, 120)}`);
check("合规的那一行确实恢复了", Number(restored.json?.items) === 1, `items=${restored.json?.items}`);

const skipped = restored.json?.skipped;
check("响应里带上了「跳过了多少行」", Number(skipped?.total) === 3, `skipped=${JSON.stringify(skipped).slice(0, 160)}`);

const examples = Array.isArray(skipped?.examples) ? skipped.examples : [];
check("示例里带行号(用户能按行去改)", examples.length === 3 && examples.every((entry) => Number.isInteger(entry.row) && entry.row >= 2), JSON.stringify(examples.map((entry) => entry.row)));

const reasons = examples.map((entry) => String(entry.reason ?? ""));
check("原因用中文并点名缺失/写错的字段", reasons.some((text) => text.includes("单位")) && reasons.some((text) => text.includes("类型")) && reasons.some((text) => text.includes("分类")), reasons.join(" | "));
check("原因是中文而不是 zod 的英文原文", !reasons.some((text) => /Required|Invalid enum value/i.test(text)), reasons.join(" | "));

// 库里核对:只有那一条合规的进来了
const dash = await api("GET", "/api/dashboard", null);
const saved = (dash.json?.items ?? []).filter((item) => item.name.startsWith(PREFIX)).map((item) => item.name);
check("坏行确实没进库(否则报告就成了空话)", saved.length === 1 && saved[0].includes("正常"), saved.join("、") || "(无)");

// 收尾
for (const item of (dash.json?.items ?? []).filter((entry) => entry.name.startsWith(PREFIX))) {
  await api("DELETE", `/api/items/${item.id}`, { permanent: true });
}
const after = await api("GET", "/api/dashboard", null);
check("探针数据已清理", (after.json?.items ?? []).every((item) => !item.name.startsWith(PREFIX)), "还有残留");

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);