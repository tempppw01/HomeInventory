// 输入校验与账号相关纯函数的单测。
//
// 说明:恢复码哈希没有纳入单测 —— 它依赖 @/lib/account-auth,
// 而后者会引入 next/headers 这类只能跑在 Next 运行时里的模块。
// (别名问题本身已经解决:测试侧注册了 scripts/lib/register-alias.mjs。)
// 这条链路由权限矩阵套件(47 项,含找回流程)覆盖。

import { test } from "node:test";
import assert from "node:assert/strict";

import { itemSchema } from "../../src/lib/validation.ts";
import { createItemCode } from "../../src/lib/item-code.ts";
import { activityLabel, ACTIVITY_LABELS } from "../../src/lib/activity-label.ts";
import { passwordStrength, generatePassword, PASSWORD_MIN_LENGTH, USERNAME_PATTERN } from "../../src/lib/password.ts";

const baseItem = {
  name: "单测物品",
  category: "日用",
  type: "CONSUMABLE",
  unit: "件",
  quantity: 1,
};

const parseDate = (value) => {
  const result = itemSchema.safeParse({ ...baseItem, expiryDate: value });
  if (!result.success) return { ok: false, message: result.error.issues[0]?.message ?? "" };
  return { ok: true, date: result.data.expiryDate };
};

// ---------- 日期:两种合法写法 ----------

test("日期:接受 YYYY-MM-DD", () => {
  const parsed = parseDate("2026-12-31");
  assert.equal(parsed.ok, true);
  // 存的是本地零点,取本地日历日应当仍是 12-31
  assert.equal(parsed.date.getFullYear(), 2026);
  assert.equal(parsed.date.getMonth(), 11);
  assert.equal(parsed.date.getDate(), 31);
});

test("日期:接受标准 ISO 时间戳(此前会被 400 拒掉)", () => {
  const parsed = parseDate("2026-12-31T03:00:00.000Z");
  assert.equal(parsed.ok, true);
  // 内部按 UTC 日历日取值、再存成本地零点 —— 于是界面(按本地显示)看到的仍是 31 号。
  assert.equal(parsed.date.getFullYear(), 2026);
  assert.equal(parsed.date.getMonth(), 11);
  assert.equal(parsed.date.getDate(), 31);
});

test("日期:空字符串与 null 视为未设置", () => {
  assert.equal(parseDate("").date, null);
  assert.equal(parseDate(null).date, null);
});

// ---------- 日期:非法输入要被挡住并给出可读原因 ----------

test("日期:斜杠写法被拒,且提示可读", () => {
  const parsed = parseDate("2026/12/31");
  assert.equal(parsed.ok, false);
  assert.match(parsed.message, /日期/);
});

test("日期:1999-13-01 这类月份越界被拒", () => {
  const parsed = parseDate("2026-13-01");
  assert.equal(parsed.ok, false);
});

test("日期:2026-02-31 不存在的日子被拒,而不是被静默进位成 3 月 3 日", () => {
  const parsed = parseDate("2026-02-31");
  assert.equal(parsed.ok, false);
  assert.match(parsed.message, /不存在|不正确/);
});

test("日期:随便一句中文不会被当成日期", () => {
  const parsed = parseDate("下周三");
  assert.equal(parsed.ok, false);
});

// ---------- 物品字段的基本约束 ----------

test("物品:名称会去掉首尾空格", () => {
  const parsed = itemSchema.safeParse({ ...baseItem, name: "  纸巾  " });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.name, "纸巾");
});

test("物品:名称不能为空", () => {
  assert.equal(itemSchema.safeParse({ ...baseItem, name: "   " }).success, false);
});

test("物品:数量不能为负", () => {
  assert.equal(itemSchema.safeParse({ ...baseItem, quantity: -1 }).success, false);
});

test("物品:单位不能为空", () => {
  assert.equal(itemSchema.safeParse({ ...baseItem, unit: "" }).success, false);
});

// ---------- 物品编号 ----------

test("物品编号:形如 INV-YYYYMMDD-XXXXXX", () => {
  const code = createItemCode();
  assert.match(code, /^INV-\d{8}-[0-9A-F]{6}$/);
});

test("物品编号:连续生成不重复", () => {
  const codes = new Set(Array.from({ length: 200 }, () => createItemCode()));
  assert.equal(codes.size, 200);
});

// ---------- 活动日志文案 ----------

test("活动文案:已知动作有中文说明", () => {
  for (const action of ["CREATE", "DELETE", "CONSUME", "SHOPPING_UPDATE", "AI_ANALYZE", "MERGE"]) {
    assert.equal(typeof ACTIVITY_LABELS[action], "string", `${action} 缺少中文标签`);
    assert.notEqual(activityLabel(action).trim(), "");
  }
});

test("活动文案:未知动作原样返回(不清空、不显示 undefined)", () => {
  const label = activityLabel("SOMETHING_NEW");
  assert.equal(label, "SOMETHING_NEW");
});

// ---------- 密码强度(返回 score/label/tone,没有 ok 字段) ----------

test("密码强度:太短 → score 0,提示至少 8 位", () => {
  const result = passwordStrength("Ab1!");
  assert.equal(result.score, 0);
  assert.equal(result.tone, "danger");
  assert.match(result.label, /8 位/);
  assert.equal(PASSWORD_MIN_LENGTH, 8);
});

test("密码强度:够长但只有小写字母 → 不能算强", () => {
  const result = passwordStrength("aaaaaaaaaaaa");
  assert.ok(result.score >= 1 && result.score <= 2, "实际 score=" + result.score);
  assert.notEqual(result.tone, "success");
});

test("密码强度:大小写 + 数字且够长 → 最强档", () => {
  const result = passwordStrength("GuiWu2026Home");
  assert.equal(result.score, 4);
  assert.equal(result.tone, "success");
});

test("密码强度:空密码给出明确提示", () => {
  const result = passwordStrength("");
  assert.equal(result.score, 0);
  assert.match(result.label, /输入密码/);
});

test("生成密码:长度符合要求且每次不同", () => {
  const a = generatePassword(16);
  const b = generatePassword(16);
  assert.equal(a.length, 16);
  assert.notEqual(a, b);
});

test("用户名规则:大小写与长度边界", () => {
  assert.equal(USERNAME_PATTERN.test("bgs"), true);
  assert.equal(USERNAME_PATTERN.test("ab"), false);
  assert.equal(USERNAME_PATTERN.test("Bgs"), false);
  assert.equal(USERNAME_PATTERN.test("-bgs"), false);
});
// 这次就是靠这条发现 7 个动作(账号相关、AI 分析、合并、踢出登录、采购更新)
// 没有中文名,会在「变更记录」里直接显示英文枚举。
test("服务端写入的动作都有中文标签", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = dir + "/" + name;
      if (statSync(path).isDirectory()) return walk(path);
      return /\.(ts|tsx)$/.test(path) ? [path] : [];
    });

  const actions = new Set();
  for (const file of walk("src")) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/action:\s*"([A-Z_]+)"/g)) actions.add(match[1]);
  }

  assert.ok(actions.size > 5, `没有扫到动作(防止空跑),扫到 ${actions.size} 个`);
  const missing = [...actions].filter((action) => !(action in ACTIVITY_LABELS)).sort();
  assert.deepEqual(missing, [], `这些动作缺少中文标签:${missing.join(", ")}`);
});
