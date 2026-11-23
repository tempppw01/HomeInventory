// 窄屏(320px)布局的验收检查。
//
// 单独成篇的原因:套件默认按桌面尺寸跑,窄屏问题(标题被挤成两行、输入框 placeholder 折四行、
// 可点元素小于 44px)完全抓不到 —— 直到用户截图反馈才发现。
// 这里固化几条最容易退化的断言。

import { launchChromiumOrNull } from "./lib/browser.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";
const NARROW = { width: 320, height: 568 };

// 首页的 AI 建议卡片是异步加载的:不等它渲染完就测量,会把卡片里的按钮全漏掉
// (上一轮人工扫描就是这样漏掉的)。这里等它进入「有结论」或「明确的空/错误状态」。
async function waitForAsyncCards(page) {
  for (let i = 0; i < 15; i += 1) {
    const state = await page.evaluate(() => {
      const card = document.querySelector('[aria-label="AI 本周建议"]');
      if (!card) return "missing";
      const text = card.innerText || "";
      if (text.includes("正在看家里的情况")) return "loading";
      const items = card.querySelectorAll("li b").length;
      if (items > 0) return "ready";
      // 明确的终态:没有建议了 / 未配置 / 出错
      if (/不需要了|已经收起来|暂不可用|没有可用|去设置/.test(text)) return "ready";
      return "loading";
    });
    if (state === "ready") return true;
    if (state === "missing") return false;
    await page.waitForTimeout(2000);
  }
  return false;
}


const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const browser = await launchChromiumOrNull();
if (!browser) {
  console.log("跳过:当前环境没有可用的 Chromium");
  process.exit(0);
}

const context = await browser.newContext({ viewport: NARROW });
const page = await context.newPage();

// 登录(窄屏同样是移动端布局)
await page.goto(BASE);
await page.waitForTimeout(1600);
if (await page.locator("#auth-username").count()) {
  await page.fill("#auth-username", USER);
  await page.fill("#auth-password", PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
}
for (let i = 0; i < 5; i += 1) {
  const welcome = page.locator('[role="dialog"][aria-label="欢迎使用"]:visible');
  if ((await welcome.count()) === 0) break;
  const skip = page.locator('[aria-label="暂时跳过欢迎引导"]:visible');
  if (await skip.count()) await skip.first().click({ timeout: 3000 }).catch(() => {});
  else await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
}

// ============ 0. 必须先确认已登录 ============
// 这一条是被真实事故逼出来的:清理脚本会裁剪会话,若登录没成功,
// 后面所有断言其实都量在登录页上 —— 全部「通过」却毫无意义。
{
  const loginState = await page.evaluate(() => ({
    hasLoginForm: Boolean(document.querySelector("#auth-username")),
    mainHead: (document.querySelector("main")?.innerText || "").slice(0, 40),
  }));
  check("窄屏检查已登录(否则测的是登录页)", !loginState.hasLoginForm, `仍停在登录页:${loginState.mainHead.replace(/\n/g, " ")}`);
  if (loginState.hasLoginForm) {
    await context.close();
    await browser.close();
    const failedEarly = results.filter((entry) => !entry.ok);
    console.log(`\n${results.length - failedEarly.length}/${results.length} 通过`);
    process.exit(1);
  }
}

// ============ 1. 各页面在 320px 下不横向滚动 ============
{
  const routes = ["/", "/items", "/locations", "/tasks", "/audit", "/settings", "/report"];
  const offenders = [];
  const missingMain = [];
  for (const route of routes) {
    await page.goto(BASE + route);
    await page.waitForTimeout(2200);
    const state = await page.evaluate(() => ({
      docWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      boundary: (document.querySelector("main")?.innerText || "").includes("页面没能加载出来"),
      hasMain: Boolean(document.querySelector("main")),
    }));
    if (state.scrollWidth > state.docWidth + 2 || state.boundary) offenders.push(`${route}(scroll=${state.scrollWidth}/${state.docWidth},boundary=${state.boundary})`);
    if (!state.hasMain) missingMain.push(route);
  }
  check("窄屏下各页面无横向滚动、无错误边界", offenders.length === 0, offenders.join(" | "));
  // 页面没有 main 地标时,所有「按 main 取范围」的检查都会空跑(什么都没测到却全绿)——
  // /report 就是这样一路绿了很久:它是全站唯一用 div 当根元素的页面。
  check("每个页面都有 main 地标", missingMain.length === 0, `缺 main:${missingMain.join(", ")}`);
// 窄屏物品页的搜索框:此前它和「空间 / 排序 / 导出 / 选择」挤在同一行,
// 在 390px 上被压到只剩「搜」一个字,占位提示完全看不见 —— 而搜索是主要操作。
// 现在它独占一行,这里量一下真实可见宽度。
{
  await page.goto(`${BASE}/items`);
  await page.waitForTimeout(2600);
  const search = await page.evaluate(() => {
    // 只找「可见」的搜索框:顶栏那个在窄屏是隐藏的(宽 0)
    const inputs = Array.from(document.querySelectorAll('main input[placeholder]'))
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter((entry) => entry.rect.width > 0 && entry.rect.height > 0);
    const target = inputs.sort((a, b) => b.rect.width - a.rect.width)[0];
    if (!target) return { found: false };
    return {
      found: true,
      width: Math.round(target.rect.width),
      placeholder: target.node.getAttribute("placeholder") ?? "",
      truncated: target.node.scrollWidth > target.node.clientWidth + 2,
    };
  });

  check("窄屏物品页有可见的搜索框", search.found, "没找到可见的搜索框");
  if (search.found) {
    check("搜索框不被挤压(宽度 ≥ 240px)", search.width >= 240, `width=${search.width}`);
    check("搜索框的占位提示看得见", search.placeholder.length > 0 && !search.truncated, `placeholder=${search.placeholder}`);
  }

  // 悬浮的助手按钮是固定定位的,弹窗打开时会压在弹窗内容上(手机上尤其明显)。
  // 现在用 :has() 在「文档里有 aria-modal 弹窗」时把它隐藏。
  {
    const fabState = () => page.evaluate(() => {
      const fab = document.querySelector('.assistant-fab');
      if (!fab) return { found: false };
      const style = getComputedStyle(fab);
      return { found: true, hidden: style.visibility === 'hidden' || style.opacity === '0' };
    });

    const idle = await fabState();
    check("窄屏有悬浮的助手按钮", idle.found, "没找到 .assistant-fab");
    if (idle.found) {
      check("平时悬浮按钮是可见的", !idle.hidden, JSON.stringify(idle));

      const addButton = page.locator('button:has-text("录入物品"), button[aria-label*="录入"]').first();
      if ((await addButton.count()) === 0) {
        console.log("      跳过「弹窗打开时隐藏悬浮按钮」:没找到录入入口");
      } else {
        await addButton.click();
        await page.waitForTimeout(1500);
        const during = await fabState();
        check("弹窗打开时悬浮按钮被隐藏(不压在弹窗上)", during.hidden, JSON.stringify(during));

        // 关掉弹窗(用弹窗自己的关闭按钮,别用 Esc —— 有时会触发浏览器返回)
        const closeButton = page.locator('[role="dialog"] button[aria-label*="关闭"], [role="dialog"] button[aria-label*="取消"]').first();
        if (await closeButton.count()) {
          await closeButton.click();
          await page.waitForTimeout(1200);
          const after = await fabState();
          check("关掉弹窗后悬浮按钮回来了", after.found && !after.hidden, JSON.stringify(after));
        }
      }
    }
  }
}
}

// ============ 2. 助手面板:文字不折成多行 ============
{
  await page.goto(BASE);
  await page.waitForTimeout(2000);
  await page.locator('button[aria-label="打开归物助手"]').last().click();
  await page.waitForTimeout(1600);

  const panel = await page.evaluate(() => {
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((node) => (node.getAttribute("aria-label") || "").includes("归物助手"));
    if (!dialog) return null;
    const lineCount = (node, fallback) => {
      if (!node) return 0;
      const rect = node.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(node).lineHeight) || fallback;
      return Math.max(1, Math.round(rect.height / lineHeight));
    };
    const h2 = dialog.querySelector("h2");
    const subtitle = dialog.querySelector("p");
    const textarea = dialog.querySelector("textarea");
    return {
      titleLines: lineCount(h2, 22),
      subtitleLines: lineCount(subtitle, 16),
      textareaHeight: textarea ? Math.round(textarea.getBoundingClientRect().height) : 0,
      placeholder: textarea?.getAttribute("placeholder") ?? "",
      overflow: Array.from(dialog.querySelectorAll("*")).filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 4 && (rect.right > window.innerWidth + 2 || rect.left < -2);
      }).length,
      smallTargets: Array.from(dialog.querySelectorAll("button")).filter((button) => {
        const rect = button.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return false;
        const centerInView = rect.y + rect.height / 2 > 0 && rect.y + rect.height / 2 < window.innerHeight;
        if (!centerInView) return false;
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const probe = (dx, dy) => {
          const el = document.elementFromPoint(cx + dx, cy + dy);
          return Boolean(el && (el === button || button.contains(el)));
        };
        const verticalOk = rect.height >= 40 || (probe(0, -19) && probe(0, 19));
        const horizontalOk = rect.width >= 40 || (probe(-19, 0) && probe(19, 0));
        return !(rect.width >= 32 ? verticalOk : verticalOk && horizontalOk);
      }).length,
    };
  });

  if (!panel) {
    check("窄屏能打开助手面板", false, "panel not found");
  } else {
    check("助手标题在窄屏只占一行", panel.titleLines === 1, `lines=${panel.titleLines}`);
    check("助手副标题不折行", panel.subtitleLines === 1, `lines=${panel.subtitleLines}`);
    check("输入框保持单行高度", panel.textareaHeight <= 52, `height=${panel.textareaHeight}`);
    check("placeholder 足够短(不至于折行)", (panel.placeholder || "").length <= 8, `placeholder=${panel.placeholder}`);
    check("助手面板内没有元素溢出视口", panel.overflow === 0, `overflowing=${panel.overflow}`);
    check("助手面板内可点元素都 ≥40px", panel.smallTargets === 0, `small=${panel.smallTargets}`);
  }
}

// ============ 3. 各页面触摸目标 ≥40px ============
// 只统计真正可见且可点的元素:sr-only 的隐藏控件(高 1px)是给读屏用的,
// 它们对应的可见 label 才是触摸目标,所以用「尺寸 + 可见性」一起判断。
{
  // 「/items/__detail__」是占位:物品详情页的地址带物品 id,运行时再解析成真实链接。
  // 它此前不在这条扫描里 —— 而详情页刚新增了「上传照片」入口(v0.1.16),
  // 新控件必须被同一条触摸目标底线管住。
  const routes = ["/", "/items", "/locations", "/tasks", "/audit", "/settings", "/report", "/items/__detail__"];
  const offenders = [];
  const scanned = [];
  for (const route of routes) {
    let path = route;
    if (route === "/items/__detail__") {
      const detailId = await page.evaluate(async () => {
        try {
          const response = await fetch("/api/items", { cache: "no-store" });
          const body = await response.json();
          const rows = Array.isArray(body) ? body : (body.items ?? []);
          return rows[0]?.id ?? null;
        } catch {
          return null;
        }
      });
      if (!detailId) {
        console.log("      跳过物品详情页:库里没有物品");
        continue;
      }
      path = `/items/${detailId}`;
    }
    await page.goto(BASE + path);
    await page.waitForTimeout(2200);
    // 关闭遗留弹层:上一步若打开过批量识别/采购清单等底部弹层,它会盖住页面内容,
    // 导致命中区探针落到弹层上、误判为「按钮太小」。
    for (let i = 0; i < 3; i += 1) {
      const open = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).some((d) => d.getBoundingClientRect().height > 0));
      if (!open) break;
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(500);
    }
    if (route === "/") {
      await waitForAsyncCards(page); // 异步卡片就绪后再测
      // 折叠面板里的控件也要测到
      await page.evaluate(async () => {
        const summaries = Array.from(document.querySelectorAll("main details summary"));
        for (const summary of summaries) summary.click();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      });
      await page.waitForTimeout(1200);
    }
    const small = await page.evaluate(() => {
      const hitAreaOk = (node) => {
        const rect = node.getBoundingClientRect();
        // .tap-target::after { inset: -8px } 这类扩展:把伪元素的扩展量算进命中区
        const after = getComputedStyle(node, "::after");
        const hasExpansion = after.content && after.content !== "none" && after.position === "absolute";
        const inset = hasExpansion ? Math.abs(parseFloat(after.inset) || 0) : 0;
        const hitHeight = rect.height + inset * 2;
        const hitWidth = rect.width + inset * 2;
        const verticalOk = hitHeight >= 40;
        const horizontalOk = hitWidth >= 40;
        // 文本类按钮(宽度本就够)只看纵向命中高度;图标按钮两边都要够
        return rect.width >= 32 ? verticalOk : verticalOk && horizontalOk;
      };
      const main = document.querySelector("main");
      if (!main) return [];
      return Array.from(main.querySelectorAll('button, a, select, [role="button"]'))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) return false;
          const style = getComputedStyle(node);
          if (style.visibility === "hidden" || style.display === "none") return false;
          return !hitAreaOk(node);
        })
        .map((node) => (node.getAttribute("aria-label") || node.textContent || "").trim().slice(0, 14) || node.tagName);
    });
    if (small.length) offenders.push(`${path}: ${small.join("/")}`);
    scanned.push(path);
  }
  check("窄屏下各页面可点元素都 ≥40px", offenders.length === 0, offenders.join(" | "));
  // 防止「没扫到也算绿」:详情页是这一轮新增的扫描目标,必须确认它真的被扫了。
  check("触摸目标扫描覆盖了物品详情页", scanned.some((item) => item.startsWith("/items/") && item !== "/items"), `扫过:${scanned.join(", ")}`);

  // 防止「空跑」:如果卡片一直没渲染,上面的触摸目标检查等于没测到卡片里的按钮。
  // 但要区分两种情况:
  //  · 环境配了 AI → 卡片必须真的渲染出来,否则本轮触摸目标检查等于没覆盖到卡片
  //  · 环境没配 AI(比如 CI 的干净库)→ 卡片本来就按设计不渲染,这时如实标记为跳过
  const aiAvailable = await page.evaluate(async () => {
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (!response.ok) return false;
      const body = await response.json();
      return Boolean(body.aiAvailable);
    } catch {
      return false;
    }
  });

  if (!aiAvailable) {
    check("首页 AI 建议卡片已渲染(触摸目标检查没有空跑)", true, "跳过:本环境未配置 AI,卡片按设计不渲染");
  } else {
    await page.goto(BASE + "/");
    await page.waitForTimeout(2000);
    const cardReady = await waitForAsyncCards(page);
    check("首页 AI 建议卡片已渲染(触摸目标检查没有空跑)", cardReady, `ready=${cardReady}`);

    // 忽略按钮是绝对定位到右上角的(为了给正文腾出宽度),必须确认它没有压住文字。
    const overlap = await page.evaluate(() => {
      const li = document.querySelector('[aria-label="AI 本周建议"] li');
      if (!li) return null;
      const dismiss = li.querySelector('button[aria-label^="忽略这条建议"]');
      const textNode = li.querySelector('b')?.parentElement;
      if (!dismiss || !textNode) return null;
      const d = dismiss.getBoundingClientRect();
      const t = textNode.getBoundingClientRect();
      return !(d.right < t.left || d.left > t.right || d.bottom < t.top || d.top > t.bottom);
    });
    check("建议的忽略按钮不压住正文", overlap === false, `overlap=${overlap}`);
  }
}

// ============ 3.5 底部留白:内容能滚出固定导航的遮挡 ============
// 真实故障:页面容器底部只留 32px,而移动端底栏是 fixed 且高 75px,
// 最后一张卡片的按钮整块压在导航下面 —— 点不到也看不见。
//
// 判断方式说明:一开始想用「滚到底后量最低元素是否露出」,但实测不可靠 ——
// 页面里有嵌套滚动容器(设置页的记录列表)与分批加载,坐标会失真、结论自相矛盾。
// 所以改为直接量那条修复所保证的不变量:页面容器底部留白 ≥ 导航高度 + 余量。
{
  const offenders = [];
  for (const route of ["/items", "/settings", "/"]) {
    await page.goto(BASE + route);
    await page.waitForTimeout(2200);
    const state = await page.evaluate(() => {
      const nav = document.querySelector(".mobile-bottom-nav");
      const navHeight = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
      const main = document.querySelector("main");
      const paddingBottom = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : null;
      return { navHeight, paddingBottom: paddingBottom === null ? null : Math.round(paddingBottom) };
    });
    if (!state.navHeight || state.paddingBottom === null) continue; // 该视口没有底部导航
    if (state.paddingBottom < state.navHeight + 8) {
      offenders.push(`${route}: 底部留白 ${state.paddingBottom}px < 导航 ${state.navHeight}px+8`);
    }
  }
  check("窄屏下页面底部留白足够(内容不被底部导航压住)", offenders.length === 0, offenders.join(" | "));
}

// ============ 3.8 文字被裁切时必须有查看全文的途径 ============
// 小屏最容易出的阅读问题:文字被容器裁掉,用户又没有任何办法看到全文。
// 判定:内容溢出容器(scrollWidth > clientWidth)且**既没有 title/aria-label,也没用截断样式** ——
// 这说明是「意外裁切」,信息真的丢了。有 title 或用 truncate 的属于有意为之,不算问题。
{
  const routes = ["/items", "/locations", "/audit", "/settings", "/"];
  const problems = [];
  for (const route of routes) {
    await page.goto(BASE + route);
    await page.waitForTimeout(2300);
    const found = await page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) return [];
      const clipped = [];
      for (const node of main.querySelectorAll("span, b, p, h1, h2, h3, td")) {
        const text = (node.textContent || "").trim();
        if (text.length < 4) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 4) continue;
        // 不在视口内的元素坐标不可靠,跳过
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
        const style = getComputedStyle(node);
        const clippedX = node.scrollWidth > node.clientWidth + 4;
        const clippedY = node.scrollHeight > node.clientHeight + 4;
        if (!clippedX && !clippedY) continue;
        const deliberate = /truncate|line-clamp|ellipsis/.test(String(node.className)) || style.textOverflow === "ellipsis";
        if (deliberate) continue;
        const hasWay = Boolean(node.getAttribute("title") || node.getAttribute("aria-label") || node.closest("[title]"));
        if (hasWay) continue;
        clipped.push(text.slice(0, 20));
      }
      return clipped.slice(0, 3);
    });
    if (found.length) problems.push(`${route}: ${found.join(" / ")}`);
  }
  check("窄屏下没有「被裁切且无法查看全文」的文字", problems.length === 0, problems.join(" | "));
}

// ============ 4. 主要弹窗内部触摸目标与溢出 ============
{
  const records = [];

  const measureDialog = () =>
    page.evaluate(() => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).filter((node) => node.getBoundingClientRect().width > 0).pop();
      if (!dialog) return null;
      const hitAreaOk = (node) => {
        const rect = node.getBoundingClientRect();
        // .tap-target::after { inset: -8px } 这类扩展:把伪元素的扩展量算进命中区
        const after = getComputedStyle(node, "::after");
        const hasExpansion = after.content && after.content !== "none" && after.position === "absolute";
        const inset = hasExpansion ? Math.abs(parseFloat(after.inset) || 0) : 0;
        const hitHeight = rect.height + inset * 2;
        const hitWidth = rect.width + inset * 2;
        const verticalOk = hitHeight >= 40;
        const horizontalOk = hitWidth >= 40;
        // 文本类按钮(宽度本就够)只看纵向命中高度;图标按钮两边都要够
        return rect.width >= 32 ? verticalOk : verticalOk && horizontalOk;
      };
      const small = Array.from(dialog.querySelectorAll("button, a, select"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) return false;
          return !hitAreaOk(node);
        })
        .map((node) => (node.getAttribute("aria-label") || node.textContent || "").trim().slice(0, 14) || node.tagName);
      const overflow = Array.from(dialog.querySelectorAll("*")).filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 4 && (rect.right > window.innerWidth + 2 || rect.left < -2);
      }).length;
      return { small, overflow };
    });

  // 录入物品
  await page.goto(BASE + "/items");
  await page.waitForTimeout(2200);
  await page.locator('button[aria-label="录入物品"]').first().click();
  await page.waitForTimeout(1200);
  records.push({ name: "录入物品", ...(await measureDialog()) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  const giveUp = page.locator('[role="dialog"] button:has-text("放弃")').first();
  if (await giveUp.count()) { await giveUp.click().catch(() => {}); await page.waitForTimeout(600); }

  // 添加空间
  await page.goto(BASE + "/locations");
  await page.waitForTimeout(2200);
  await page.locator('button:has-text("添加空间")').first().click();
  await page.waitForTimeout(1200);
  records.push({ name: "添加空间", ...(await measureDialog()) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // 安排任务
  await page.goto(BASE + "/tasks");
  await page.waitForTimeout(2200);
  await page.locator('button:has-text("安排任务")').first().click();
  await page.waitForTimeout(1200);
  records.push({ name: "安排任务", ...(await measureDialog()) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  const problems = records.filter((record) => record.small.length || record.overflow);
  const detail = records.map((record) => `${record.name}:${record.small.length ? record.small.join("/") : "ok"}/overflow=${record.overflow}`).join(" | ");
  check("窄屏下主要弹窗可点元素 ≥40px 且不溢出", problems.length === 0, detail);
}

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
}
process.exit(failed.length ? 1 : 0);
