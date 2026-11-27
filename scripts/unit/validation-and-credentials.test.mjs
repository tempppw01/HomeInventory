// 输入校验与账号相关纯函数的单测。
//
// 说明:恢复码哈希没有纳入单测 —— 它依赖 @/lib/account-auth,
// 而后者会引入 next/headers 这类只能跑在 Next 运行时里的模块。
// (别名问题本身已经解决:测试侧注册了 scripts/lib/register-alias.mjs。)
// 这条链路由权限矩阵套件(47 项,含找回流程)覆盖。

import { test } from "node:test";
import assert from "node:assert/strict";

import { bulkItemPatchSchema, itemPatchSchema, itemSchema, locationSchema, memberSchema, shoppingSchema } from "../../src/lib/validation.ts";
import { createItemCode, createItemCodeBatch } from "../../src/lib/item-code.ts";
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

test("物品:名称不能只有不可见字符(零宽/BOM)", () => {
  // 实测:纯 \u200b\u200b\u200b 能通过 trim().min(1) 存进库 —— 列表里那一条是一片空白,
  // 按名字搜也搜不到,只能靠一条条翻。零宽字符不是空白,trim() 不会去掉它们。
  for (const invisible of ["\u200b\u200b\u200b", "\ufeff", "\u200d", "\u00ad\u00ad", "\u200b \u200b", "\u2060"]) {
    const parsed = itemSchema.safeParse({ ...baseItem, name: invisible });
    assert.equal(parsed.success, false, `「${JSON.stringify(invisible)}」这种名字应该被拒`);
  }
  // 正常的名字不受影响:零宽字符夹在中间、或前后有可见字符,都照常通过
  assert.equal(itemSchema.safeParse({ ...baseItem, name: "纸巾\u200b" }).success, true);
  assert.equal(itemSchema.safeParse({ ...baseItem, name: "🧴\u200d洗手液" }).success, true);
  // emoji、组合字符、全角、数字、单字名都要留着
  for (const good of ["🧴", "é", "ｑ", "1", "巾", "O'Brien", "\u3000纸\u3000"]) {
    assert.equal(itemSchema.safeParse({ ...baseItem, name: good }).success, true, `「${good}」应该通过`);
  }
});

test("空间/成员/采购项的名字也要求看得见", () => {
  // 同一个洞在三处都有:名字看不见 → 列表里是空白行、筛选里也认不出来
  assert.equal(locationSchema.safeParse({ name: "\u200b" }).success, false);
  assert.equal(locationSchema.safeParse({ name: "阳台" }).success, true);
  assert.equal(memberSchema.safeParse({ name: "\u200b\u200b" }).success, false);
  assert.equal(memberSchema.safeParse({ name: "小周" }).success, true);
  assert.equal(shoppingSchema.safeParse({ name: "\ufeff" }).success, false);
  assert.equal(shoppingSchema.safeParse({ name: "牛奶" }).success, true);
});

test("物品:数量不能为负", () => {
  assert.equal(itemSchema.safeParse({ ...baseItem, quantity: -1 }).success, false);
});

test("物品:单位不能为空", () => {
  assert.equal(itemSchema.safeParse({ ...baseItem, unit: "" }).success, false);
});

// ---------- 「没填单价」必须存成 null,不能变成 0 ----------
//
// 由来:price 曾是 z.union([z.coerce.number().min(0), z.literal(""), z.null()])。union 取第一个
// 通过的支,而 coerce.number 排在前面 —— Number(null) === 0、Number("") === 0,于是 null 与 ""
// 都被吞成 0,末尾那句 transform 永远看不到它们(实测:price=null → 存成 0,price="" → 存成 0)。
// 两层后果:「没填」与「0 元」在库里/界面上/财务里成了同一个东西;创建路径的
// `recordPurchase && price != null` 恒真,于是每录一件不填价格的物品都会写一条 ¥0 采购记录。
test("物品:没填单价(null / 空串 / 不传)存成 null,不是 0", () => {
  const of = (patch) => itemSchema.parse({ ...baseItem, ...patch }).price;
  assert.equal(of({ price: null }), null, "price=null 应存 null");
  assert.equal(of({ price: "" }), null, "price=\"\" 应存 null");
  assert.equal(of({ price: "   " }), null, "price 全是空格也应存 null");
  assert.equal(of({}), null, "完全不传 price 应存 null");
});

test("物品:显式 0 元仍然保留(赠品也是 0 元,不能被当成没填)", () => {
  const of = (patch) => itemSchema.parse({ ...baseItem, ...patch }).price;
  assert.equal(of({ price: 0 }), 0, "price=0 应保持 0");
  assert.equal(of({ price: "0" }), 0, "price=\"0\" 应保持 0");
  assert.equal(of({ price: "0.00" }), 0, "price=\"0.00\" 应保持 0");
});

test("物品:金额字符串能解析,负数与非数字仍然拒绝", () => {
  const of = (patch) => itemSchema.parse({ ...baseItem, ...patch }).price;
  assert.equal(of({ price: "19.90" }), 19.9);
  assert.equal(of({ price: "19,90" }), 19.9, "逗号小数点也要认");
  assert.equal(itemSchema.safeParse({ ...baseItem, price: "abc" }).success, false);
  assert.equal(itemSchema.safeParse({ ...baseItem, price: -1 }).success, false);
});

// ---------- 「没填」不是一个值:余量与数量上的同一个坑 ----------
//
// 由来:z.coerce.number() 把 null / "" / undefined 全算成 0(Number(null) === 0、Number("") === 0),
// 于是「没填」和「0」在库里成了同一个东西 —— 而这两个 0 都有后果:
// 余量 0% 会被 item-metrics 判「需补货」、被 item-forecast 按 0 算用量;数量 0 件的物品
// 不出现在任何列表里。实测(真实接口):remainingPercent=null → 存 0(界面显示「需补货 0%」)
// 而不传 → 100;quantity=null / "" → 201 存 0。
test("物品:没填余量(null / 空串 / 不传)走默认 100,不是 0%", () => {
  const of = (patch) => itemSchema.parse({ ...baseItem, ...patch }).remainingPercent;
  assert.equal(of({ remainingPercent: null }), 100, "remainingPercent=null 应是默认 100");
  assert.equal(of({ remainingPercent: "" }), 100, "remainingPercent=\"\" 应是默认 100");
  assert.equal(of({ remainingPercent: "   " }), 100, "全是空格也应是默认 100");
  assert.equal(of({}), 100, "不传该字段应是默认 100");
});

test("物品:显式 0% 余量仍然保留(那是「用完了」,不是没填)", () => {
  const of = (patch) => itemSchema.parse({ ...baseItem, ...patch }).remainingPercent;
  assert.equal(of({ remainingPercent: 0 }), 0);
  assert.equal(of({ remainingPercent: "0" }), 0);
  assert.equal(of({ remainingPercent: 50 }), 50);
});

test("物品:数量没填时给中文错误,不再静默存成 0 件", () => {
  for (const value of [null, "", "   "]) {
    const result = itemSchema.safeParse({ ...baseItem, quantity: value });
    assert.equal(result.success, false, `quantity=${JSON.stringify(value)} 应该被拒`);
    assert.match(result.error.issues[0].message, /数量/, "错误消息要说中文的「数量」");
  }
  const missing = itemSchema.safeParse({ ...baseItem, quantity: undefined });
  assert.equal(missing.success, false, "完全不传数量也应该被拒");
  assert.match(missing.error.issues[0].message, /数量/);
});

test("物品:显式 0 件仍然接受(消耗到最后一瓶时应用自己会写成 0)", () => {
  assert.equal(itemSchema.parse({ ...baseItem, quantity: 0 }).quantity, 0);
  assert.equal(itemSchema.parse({ ...baseItem, quantity: "0" }).quantity, 0);
  assert.equal(itemSchema.parse({ ...baseItem, quantity: 2.5 }).quantity, 2.5);
});

test("局部更新:不传 = 不改;显式 0 = 真的改成 0;显式 null 的余量回到默认 100", () => {
  // partial() 让「不传」短路成 undefined,调用方据此跳过这一项。
  assert.equal(itemPatchSchema.parse({}).remainingPercent, undefined, "不传应保持 undefined(=不改)");
  assert.equal(itemPatchSchema.parse({ remainingPercent: 0 }).remainingPercent, 0, "显式 0 要保留");
  assert.equal(itemPatchSchema.parse({ quantity: 0 }).quantity, 0, "数量 0 要保留(消耗到最后一瓶就是这个状态)");
  // 显式 null 在 partial() 下走不到「不改」那条短路,所以它落到内层:余量有默认值 → 100。
  // 这是写明了的取舍:两种「没填」都不再是 0%,而「不改」的写法是**不传这个键**。
  assert.equal(itemPatchSchema.parse({ remainingPercent: null }).remainingPercent, 100, "显式 null 应回到默认 100,不是 0%");
  // 数量没有默认值,所以显式 null 只能被拒绝(中文消息),而不是静默变成 0 件。
  const q = itemPatchSchema.safeParse({ quantity: null });
  assert.equal(q.success, false, "显式 null 的数量应被拒");
  assert.match(q.error.issues[0].message, /数量/);
});

test("批量更新:数量/余量传 null 或空串 = 这一项不改,不会把选中的物品改成 0", () => {
  // 带一个真的要改的字段,才能看出空值那几项被当成了「不改」。
  const of = (patch) => bulkItemPatchSchema.parse({ ids: ["x"], category: "日用", ...patch });
  assert.equal(of({ quantity: null }).quantity, undefined, "批量数量 null = 不改");
  assert.equal(of({ quantity: "" }).quantity, undefined, "批量数量空串 = 不改");
  assert.equal(of({ remainingPercent: null }).remainingPercent, undefined, "批量余量 null = 不改");
  assert.equal(of({ remainingPercent: "" }).remainingPercent, undefined, "批量余量空串 = 不改");
  assert.equal(of({ quantity: 0 }).quantity, 0, "显式 0 要保留");
  assert.equal(of({ remainingPercent: 0 }).remainingPercent, 0, "显式 0% 要保留");
  // 整请求只有空值时:一个改动都没有,应当被拒 —— 而不是「默默什么都不做」或「改成 0」。
  const only = bulkItemPatchSchema.safeParse({ ids: ["x"], quantity: null });
  assert.equal(only.success, false);
  assert.match(only.error.issues[0].message, /没有可更新的内容/);
});

test("数量/余量的越界与非法类型也给中文消息", () => {
  const q = itemSchema.safeParse({ ...baseItem, quantity: -1 });
  assert.equal(q.success, false);
  assert.match(q.error.issues[0].message, /数量/);
  const p = itemSchema.safeParse({ ...baseItem, remainingPercent: 101 });
  assert.equal(p.success, false);
  assert.match(p.error.issues[0].message, /剩余量/);
  const bad = itemSchema.safeParse({ ...baseItem, remainingPercent: "abc" });
  assert.equal(bad.success, false);
  assert.match(bad.error.issues[0].message, /剩余量/);
});

// ---------- 物品编号 ----------

test("物品编号:形如 INV-YYYYMMDD-XXXXXX", () => {
  const code = createItemCode();
  assert.match(code, /^INV-\d{8}-[0-9A-F]{6}$/);
});

test("物品编号:一批 1000 个必须互不相同(批量导入的真实规模)", () => {
  // 这条必须是确定性的:编号只有 2^24 种,一次导入 1000 行时「同批撞车」的概率约 3%,
  // 而 itemCode 上有唯一索引 —— 撞一次整个事务回滚,1000 行一条都进不去。
  // (此前这里是「连续生成 200 个不重复」,那是概率性的:约 1/850 的运行会红。)
  const codes = createItemCodeBatch(1000);
  assert.equal(codes.length, 1000);
  assert.equal(new Set(codes).size, 1000);
  for (const code of codes) assert.match(code, /^INV-\d{8}-[0-9A-F]{6}$/);
});

test("物品编号:批量里的每一个也是合法编号", () => {
  const codes = createItemCodeBatch(3);
  assert.equal(new Set(codes).size, 3);
  assert.deepEqual(createItemCodeBatch(0), []);
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

// ---------- 时间点字段:必须保留时刻 ----------
// lastRestockedAt 由服务端在补货入库时写成 new Date();如果按「日期」处理,
// 会被截断到当天零点并在 UTC 取值时挪一天 —— 「3 天前补的货」会显示成「4 天前」。

test("上次补货时间:保留完整时刻,不被截断成日期", () => {
  const stamp = "2026-11-17T15:56:06.356Z";
  const parsed = itemPatchSchema.safeParse({ lastRestockedAt: stamp });
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  assert.equal(parsed.data.lastRestockedAt.toISOString(), stamp);
});

test("上次补货时间:可以清空", () => {
  const parsed = itemPatchSchema.safeParse({ lastRestockedAt: null });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.lastRestockedAt, null);
});

test("上次补货时间:非法字符串被拒", () => {
  assert.equal(itemPatchSchema.safeParse({ lastRestockedAt: "昨天下午" }).success, false);
});
