// 只读账号的界面验收:凡是「写」的入口,要么不出现,要么明确置灰。
//
// 起因:只读账号(VIEWER)能看到一整屏写入口,点下去只拿到 403。
//   · 任务页整块视图没处理 readOnly —— 「安排任务」「完成」「删除任务」都在,点一下就是失败
//   · 盘点页「结束盘点」可点,点了 POST /api/audits → 403,盘点还停在那里
//   · 物品页「选择」把卡片切进多选模式,批量操作全是 403
//   · 概览页「合并」重复物品、回收站弹窗里的「恢复 / 永久删除」同样只给 403
//
// 这个用例守住四件事:
//   1) 只读账号在主要页面上点遍可见按钮 —— 不产生任何 4xx(界面不再引导用户去撞墙)
//   2) **弹窗里也要点**:很多写动作藏在「确认」背后(合并、永久删除),
//      只点开弹窗再 Esc 关掉是测不到的 —— 这一层必须进去点
//   3) 具体的写入口按预期缺席或置灰(不是「看着能点」)
//   4) 接口侧兜底:直接打写接口仍然一律 403(界面藏了 ≠ 接口松了)
//   5) 对照:管理员照旧能看到并能用(避免用「一刀切全藏掉」把检查做绿)
//
// 用法:PROBE_VIEWER_PASS=... PROBE_PASS=... node scripts/verify-readonly-ui.mjs

import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs } from "./lib/probe-auth.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const VIEWER_USER = process.env.PROBE_VIEWER_USER || "viewcheck";
const VIEWER_PASS = process.env.PROBE_VIEWER_PASS || "View#2026";
const ADMIN_USER = process.env.PROBE_USER || "leadcheck";
const ADMIN_PASS = process.env.PROBE_PASS || "Lead#2026";

/** 每页最多点这么多按钮:够覆盖,又不至于让整套跑成半小时 */
const PAGE_BUDGET = Number(process.env.READONLY_PAGE_BUDGET || 26);
/** 每个弹出的窗口里最多点这么多 */
const DIALOG_BUDGET = Number(process.env.READONLY_DIALOG_BUDGET || 8);
/** 弹窗套弹窗的层数(确认框里再弹确认框) */
const MAX_DEPTH = 3;

/** 写动作更值得点,排前面;剩下的按 DOM 顺序补足 */
const WRITE_HINT = /新增|添加|创建|删除|移除|移入|选择|批量|完成|结束|保存|提交|导入|导出|生成|重置|开始|安排|上传|编辑|清空|确认|确定|恢复|合并|应用|位置|消耗|用掉|补货|丢弃|决定/;
/** 这些点了只会让套件自己崩(退出登录)或什么也不做,跳过 */
const SKIP_LABEL = /退出|登出|注销|关闭|取消|返回|稍后|不再提示/;
/**
 * 自助接口对**所有角色**开放(包括只读),它们返回 4xx 是表单校验的正常结果,
 * 不算「界面把用户引到了墙上」。
 */
const SELF_SERVICE = ["/api/auth/password", "/api/auth/recovery", "/api/auth/logout"];
/**
 * AI 接口:只读账号**刻意**可以用(见 src/proxy.ts 的放行清单),所以它们出现在这里
 * 不算「写入口没收干净」。而它们返回 400 的原因通常与权限无关 ——
 * CI 里没配 AI Key,点一下「发送问题」就是 400;本机配了就是 200。
 * 判失败的口径因此分成两层(见 classify):
 *   · 401 / 403 —— 权限问题,**任何路径**都不许出现
 *   · 其它 4xx —— 只有非 AI 路径才算「界面把只读引到了写路径上」
 * 这样「AI 没配 Key」不会把检查染色,而 AI 接口真出权限问题照样红。
 */
const AI_PATH_PREFIX = "/api/ai/";

const isPermission = (entry) => / (401|403)$/.test(entry);
const isAiPath = (entry) => entry.includes(AI_PATH_PREFIX);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// 装上探针:记录页面上每一次 /api/ 请求的结果,4xx/5xx 单独留档。
// 用 addInitScript 而不是页面加载后再 patch —— 否则会漏掉首屏请求。
await context.addInitScript((selfService) => {
  if (window.__probeInstalled) return;
  window.__probeInstalled = true;
  window.__probeBad = [];
  window.__probeSelf = [];
  window.__probeCount = 0;
  const original = window.fetch;
  window.fetch = async (...args) => {
    const response = await original(...args);
    try {
      const target = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      const method = (args[1] && args[1].method) || (args[0] && args[0].method) || "GET";
      const path = target ? String(target).replace(/^https?:\/\/[^/]+/, "") : "";
      if (path.startsWith("/api/")) {
        const record = `${method} ${path} → ${response.status}`;
        window.__probeCount += 1;
        if (selfService.some((prefix) => path.startsWith(prefix))) {
          if (response.status >= 400) window.__probeSelf.push(record);
        } else if (response.status >= 400) window.__probeBad.push(record);
      }
    } catch {
      /* 探针本身不能影响页面 */
    }
    return response;
  };
}, SELF_SERVICE);

const page = await context.newPage();

const finish = async (code) => {
  await context.close();
  await browser.close();
  process.exit(code);
};

/** 以指定账号登录(先登出,避免沿用上一条会话) */
const loginAs = async (user, pass) => {
  await page.goto(BASE);
  await page.waitForTimeout(1400);
  await page.evaluate(async () => { await fetch("/api/auth/logout", { method: "POST" }); });
  await page.goto(BASE);
  await page.waitForTimeout(2000);
  if (await page.locator("#auth-username").count()) {
    await page.fill("#auth-username", user);
    await page.fill("#auth-password", pass);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }
  await dismissBlockingDialogs(page);
  const hasForm = await page.evaluate(() => Boolean(document.querySelector("#auth-username")));
  return { ok: !hasForm, detail: hasForm ? "登录表单未消失(账号或密码不对?)" : "" };
};

const resetProbe = () => page.evaluate(() => { window.__probeBad = []; window.__probeSelf = []; window.__probeCount = 0; });
const readProbe = () => page.evaluate(() => ({ bad: window.__probeBad || [], self: window.__probeSelf || [], count: window.__probeCount || 0 }));

const gotoRoute = async (route) => {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);
  await dismissBlockingDialogs(page);
  await closePopups();
  await resetProbe();
};

/** 某个容器里当前可见、可点的按钮 */
const visibleButtons = (scope) => page.evaluate((selector) => {
  const root = selector === "page" ? document.querySelector("main") : document.querySelector(selector);
  if (!root) return [];
  const usable = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 4 && rect.height > 4 && style.visibility !== "hidden" && style.display !== "none"
      && style.pointerEvents !== "none" && !element.disabled && !element.closest("[inert]");
  };
  return Array.from(root.querySelectorAll("button, a[href]"))
    .filter(usable)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: (element.getAttribute("aria-label") || (element.textContent || "").trim().replace(/\s+/g, " ")).slice(0, 28),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    })
    .filter((entry) => entry.label);
}, scope);

/** 点坐标而不是点选择器:同一页可能有多个同名按钮,坐标最贴近「用户真的点了这个」 */
const clickAt = async (point) => {
  const x = point.left + Math.max(2, Math.min(10, point.width / 2));
  const y = point.top + Math.max(2, Math.min(10, point.height / 2));
  await page.mouse.click(x, y).catch(() => {});
};

/**
 * 当前弹出的浮层:语义弹窗,或者右键 / 「⋯」拉出来的菜单。
 * 菜单也必须进 —— 「用掉」「移入回收站」「编辑物品」都在菜单里,
 * 只点开菜单不点里面,同样什么也测不到。
 */
const openPopupSelector = () => page.evaluate(() => {
  const shown = (node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 4 && rect.height > 4;
  };
  const menu = Array.from(document.querySelectorAll('[role="menu"], [data-context-menu]')).find(shown);
  if (menu) return '[role="menu"], [data-context-menu]';
  const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(shown);
  return dialog ? '[role="dialog"]' : null;
});

const closePopups = async () => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!(await openPopupSelector())) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  // 还有没关掉的:点右上角的关闭按钮,再不行点页面空白处
  await page.evaluate(() => {
    for (const dialog of Array.from(document.querySelectorAll('[role="dialog"]'))) {
      const button = dialog.querySelector('button[aria-label^="关闭"]');
      if (button) button.click();
    }
  });
  await page.mouse.click(8, 300).catch(() => {});
  await page.waitForTimeout(250);
};

/**
 * 在某个范围里点按钮,遇到弹窗就进去接着点。
 *
 * 这一层是关键:写动作常常藏在确认框背后(「合并」→ 确认 → 才发请求),
 * 只点开弹窗再 Esc 掉,403 一次也不会出现 —— 检查会绿得毫无意义。
 */
const exercise = async (scope, depth, budget) => {
  const all = await visibleButtons(scope);
  const candidates = all
    .filter((entry) => !SKIP_LABEL.test(entry.label))
    .sort((left, right) => Number(WRITE_HINT.test(right.label)) - Number(WRITE_HINT.test(left.label)))
    .slice(0, budget);

  const failures = [];
  for (const point of candidates) {
    if (depth > 0 && !(await openPopupSelector())) break; // 浮层已经关了,别去点底下的页面
    await resetProbe();
    await clickAt(point);
    await page.waitForTimeout(620);
    const bad = await readProbe();
    if (bad.bad.length) {
      // 权限类 4xx:任何路径都算失败。
      // AI 路径的其它 4xx:只记一笔(AI 未配置就是这么表现的),不当成产品缺陷。
      const failuresHere = bad.bad.filter((entry) => isPermission(entry) || !isAiPath(entry));
      const aiNotesHere = bad.bad.filter((entry) => !isPermission(entry) && isAiPath(entry));
      if (failuresHere.length) failures.push({ where: scope === "page" ? "页面" : "浮层", label: point.label, bad: failuresHere });
      aiNotes.push(...aiNotesHere.map((entry) => `${point.label} → ${entry}`));
    }

    if (depth < MAX_DEPTH) {
      const popup = await openPopupSelector();
      if (popup) {
        const nested = await exercise(popup, depth + 1, DIALOG_BUDGET);
        failures.push(...nested);
        await closePopups();
      }
    }
  }
  return failures;
};

/** 某个可访问名/文案的控件在不在、是不是禁用 */
const affordance = (label, { contains = false } = {}) => page.evaluate(({ label, contains }) => {
  const node = Array.from(document.querySelectorAll("main button, main a"))
    .find((element) => {
      const name = element.getAttribute("aria-label") || (element.textContent || "").trim();
      return contains ? name.includes(label) : name === label;
    });
  if (!node) return { present: false, disabled: null, title: "" };
  return { present: true, disabled: Boolean(node.disabled), title: node.getAttribute("title") || "" };
}, { label, contains });

/**
 * 打开一个不在 <main> 里的浮层入口(回收站、AI 助手、提醒中心都在侧边栏/顶栏)。
 * 搜索范围是整个 document —— 之前只找 main 里的按钮,回收站那个永远打不开,
 * 检查就变成「回收站没打开 → 跳过」的假绿。
 */
const openOverlay = async (label) => {
  const point = await page.evaluate((label) => {
    const usable = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 4 && rect.height > 4 && style.visibility !== "hidden" && !element.disabled;
    };
    const node = Array.from(document.querySelectorAll("button, [role=\"button\"]"))
      .filter(usable)
      .find((element) => {
        const name = element.getAttribute("aria-label") || (element.textContent || "").trim();
        return name.includes(label);
      });
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height), label };
  }, label);
  if (!point) return false;
  await clickAt(point);
  await page.waitForTimeout(1000);
  return Boolean(await openPopupSelector());
};

const READONLY_ROUTES = ["/tasks", "/audit", "/items", "/locations", "/settings", "/report", "/"];

// ---------- 1 只读视角:点遍可见按钮(含弹窗里)不该有任何 4xx ----------
const viewerPass = await loginAs(VIEWER_USER, VIEWER_PASS);
check("只读账号能登录", viewerPass.ok, viewerPass.detail);

/** 详情页地址要真实存在:挑一件消耗品(有余量加减这类写动作)+ 一件别的,两类都点到 */
let detailRoutes = [];
if (viewerPass.ok) {
  detailRoutes = await page.evaluate(async () => {
    const response = await fetch("/api/items", { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : payload.items ?? [];
    const consumable = items.find((item) => item.type === "CONSUMABLE");
    const other = items.find((item) => item.type !== "CONSUMABLE");
    return [consumable ?? items[0], other ?? items[1]].filter(Boolean).map((item) => `/items/${item.id}`);
  });
}

const allFindings = [];
/** AI 路径上「与权限无关」的 4xx(通常就是 CI 里没配 AI Key),最后统一打印,不判失败 */
const aiNotes = [];
if (viewerPass.ok) {
  for (const route of [...READONLY_ROUTES, ...detailRoutes]) {
    await gotoRoute(route);
    const failures = await exercise("page", 0, PAGE_BUDGET);
    allFindings.push({ route, failures });
    const names = failures.map((entry) => `${entry.where}「${entry.label}」${entry.bad.join(" / ")}`);
    check(`只读在 ${route} 点遍可见按钮与弹窗不产生 4xx`, failures.length === 0, names.slice(0, 6).join("; "));
  }

  // 顶栏 / 侧边栏里的浮层:按钮不在 <main> 里,要按整个 document 找。
  // 回收站里有「恢复 / 永久删除」,提醒中心里有「处理掉」和「编辑物品」——
  // 它们都藏在浮层里,只点页面上的按钮永远测不到。
  await gotoRoute("/");
  for (const overlay of ["回收站", "查看提醒"]) {
    const opened = await openOverlay(overlay);
    check(`只读能打开「${overlay}」浮层(读是允许的)`, opened);
    if (!opened) continue;
    const inside = await exercise('[role="dialog"]', 1, DIALOG_BUDGET);
    check(`只读打开「${overlay}」后,里面的按钮点遍不产生 4xx`, inside.length === 0, inside.map((entry) => `「${entry.label}」${entry.bad.join(" / ")}`).join("; "));
    await closePopups();
  }

  // 提醒中心:只读账号不该看到「处理掉」(它是 DELETE),也不能从行上打开编辑弹窗
  await gotoRoute("/");
  const openedAlerts = await openOverlay("查看提醒");
  const alertState = openedAlerts
    ? await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return { dispose: -1, text: "" };
      return {
        dispose: Array.from(dialog.querySelectorAll("button")).filter((button) => (button.textContent || "").trim() === "处理掉").length,
        text: dialog.innerText.slice(0, 80),
      };
    })
    : { dispose: null, text: "" };
  check("只读的提醒中心没有「处理掉」按钮", openedAlerts && alertState.dispose === 0, JSON.stringify(alertState));
  if (openedAlerts) await closePopups();

  // ---------- 2 只读视角:具体的写入口按预期缺席或置灰 ----------
  await gotoRoute("/tasks");
  const taskAffordances = {
    arrange: await affordance("安排任务"),
    firstTask: await affordance("安排第一个任务", { contains: true }),
    complete: await affordance("完成「", { contains: true }),
    remove: await affordance("删除任务"),
  };
  check(
    "只读的任务页没有「安排任务」入口",
    !taskAffordances.arrange.present && !taskAffordances.firstTask.present,
    JSON.stringify(taskAffordances.arrange) + JSON.stringify(taskAffordances.firstTask),
  );
  check(
    "只读的任务页没有「完成 / 删除任务」按钮",
    !taskAffordances.complete.present && !taskAffordances.remove.present,
    JSON.stringify(taskAffordances.complete) + JSON.stringify(taskAffordances.remove),
  );

  await gotoRoute("/audit");
  const finishAudit = await affordance("结束盘点", { contains: true });
  check("只读的盘点页「结束盘点」在但已置灰并给出原因", finishAudit.present && finishAudit.disabled && finishAudit.title.length > 0, JSON.stringify(finishAudit));

  await gotoRoute("/items");
  const selectEntry = await affordance("选择");
  const batchAi = await affordance("AI 批量识别物品");
  check("只读的物品页没有「选择」多选入口", !selectEntry.present, JSON.stringify(selectEntry));
  check("只读的物品页没有「AI 批量识别」入口", !batchAi.present, JSON.stringify(batchAi));

  await gotoRoute("/locations");
  const addSpace = await affordance("添加空间");
  const firstSpace = await affordance("添加第一个空间", { contains: true });
  check("只读的空间页没有「添加空间」入口", !addSpace.present && !firstSpace.present, JSON.stringify(addSpace) + JSON.stringify(firstSpace));

  await gotoRoute("/");
  const mergeButton = await affordance("合并");
  check("只读的概览页没有「合并重复物品」入口", !mergeButton.present, JSON.stringify(mergeButton));

  await gotoRoute("/");
  const openedBin = await openOverlay("回收站");
  const binState = openedBin
    ? await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return { restored: -1, destroyed: -1, note: "" };
      const buttons = Array.from(dialog.querySelectorAll("button"));
      return {
        restored: buttons.filter((button) => (button.textContent || "").trim() === "恢复").length,
        destroyed: buttons.filter((button) => (button.textContent || "").trim() === "永久删除").length,
        note: dialog.innerText,
      };
    })
    : { restored: null, destroyed: null, note: "" };
  check(
    "只读的回收站没有「恢复 / 永久删除」按钮(仍可查看)",
    openedBin && binState.restored === 0 && binState.destroyed === 0,
    JSON.stringify({ opened: openedBin, restored: binState.restored, destroyed: binState.destroyed }),
  );
  if (openedBin) await closePopups();

  // ---------- 3 接口侧兜底:界面藏了,接口也不能松 ----------
  await gotoRoute("/");
  const codes = await page.evaluate(async () => {
    const probe = async (method, path, body) => {
      const response = await fetch(path, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      return response.status;
    };
    return {
      createTask: await probe("POST", "/api/tasks", { title: "只读越权试探", intervalDays: 30 }),
      finishAudit: await probe("POST", "/api/audits", {}),
      createItem: await probe("POST", "/api/items", { name: "只读越权试探", type: "GOODS", quantity: 1 }),
      createLocation: await probe("POST", "/api/locations", { name: "只读越权试探" }),
      patchPreferences: await probe("PATCH", "/api/settings/preferences", {}),
      deleteItem: await probe("DELETE", "/api/items/__readonly_probe__"),
    };
  });
  const lax = Object.entries(codes).filter(([, status]) => status !== 403);
  check("只读直接打写接口一律 403", lax.length === 0, lax.map(([name, status]) => `${name}=${status}`).join(","));
}

// ---------- 4 对照:管理员照旧看得到、点得动 ----------
{
  const adminPass = await loginAs(ADMIN_USER, ADMIN_PASS);
  check("管理员账号能登录", adminPass.ok, adminPass.detail);
  if (adminPass.ok) {
    await gotoRoute("/tasks");
    const arrange = await affordance("安排任务");
    check("管理员照旧能看到「安排任务」", arrange.present && !arrange.disabled, JSON.stringify(arrange));

    await gotoRoute("/locations");
    const addSpace = await affordance("添加空间");
    check("管理员照旧能看到「添加空间」", addSpace.present && !addSpace.disabled, JSON.stringify(addSpace));

    await gotoRoute("/items");
    const selectEntry = await affordance("选择");
    const batchAi = await affordance("AI 批量识别物品");
    check("管理员照旧能看到「选择」与批量识别", selectEntry.present && batchAi.present, JSON.stringify({ selectEntry, batchAi }));

    await gotoRoute("/audit");
    // 管理员看到的可能是「开始盘点」(还没有进行中的盘点)或「结束盘点」,两者都可点
    const finishEntry = await affordance("结束盘点", { contains: true });
    const startEntry = await affordance("开始盘点", { contains: true });
    const auditEntry = finishEntry.present ? finishEntry : startEntry;
    check("管理员的盘点入口可用(未因只读修复被误置灰)", auditEntry.present && !auditEntry.disabled, JSON.stringify({ finishEntry, startEntry }));
  }
}

// 命中的缺陷打一张清单,失败时不用再翻日志
if (allFindings.some((entry) => entry.failures.length)) {
  console.log("\n只读账号仍然会撞上的写入口:");
  for (const entry of allFindings) {
    for (const failure of entry.failures) console.log(`  ${entry.route} → ${failure.where}「${failure.label}」${failure.bad.join(" / ")}`);
  }
}

// AI 接口的 4xx 单独说明:这类多半是「这台机器没配 AI」,不是权限问题
if (aiNotes.length) {
  console.log(`\nAI 接口的 4xx(${aiNotes.length} 条,已确认不是权限问题,仅记录):`);
  for (const note of [...new Set(aiNotes)].slice(0, 5)) console.log(`  ${note}`);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
await finish(failed.length ? 1 : 0);
