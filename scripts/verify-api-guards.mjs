// 写接口守卫检查(静态)。
//
// 目标:防止**新加的写接口忘记加权限校验**。这类漏洞不会在功能测试里暴露 ——
// 功能是好的,只是没锁门。
//
// 规则:每个非 GET 的处理器(POST/PATCH/PUT/DELETE)必须满足其一:
//   1. 文件里出现了统一守卫(requireUser / requireWritableUser / requireAdminUser)
//   2. 在「设计上公开」清单里(每条都要写清楚为什么可以公开)
//   3. 在「自带细粒度校验」清单里(自己做了更严格的判断,见注释)
//
// 另外会校验这两份清单没有过期(条目对应的路由仍然存在),避免删除路由后清单悄悄腐烂。
//
// 用法:node scripts/verify-api-guards.mjs   (不需要起服务)

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const GUARDS = ["requireUser", "requireWritableUser", "requireAdminUser"];

// 设计上必须公开的写接口 —— 每一条都要能说清为什么
const PUBLIC = new Map([
  ["/api/auth/login", "登录入口,不公开就无法登录"],
  ["/api/auth/logout", "登出,只作用于当前会话 cookie"],
  ["/api/auth/setup", "首次初始化管理员,仅在还没有管理员时可用(路由内部判断)"],
  ["/api/auth/recovery/reset", "用一次性恢复码自助重置密码 —— 忘了密码时的唯一出口"],
  ["/api/public/consume", "扫码消耗:物品标签上的二维码扫开即用,靠幂等 requestId + 频率限制约束"],
]);

// 自带更细粒度校验的写接口(不用统一守卫,但自己判断了权限/归属)
const SELF_GUARDED = new Map([
  [
    "/api/activity/[id]/undo",
    "自带校验:管理员可撤销任何消耗记录,非管理员只能撤销自己的、且限 5 分钟内(currentUser + canAdmin + 归属判断)",
  ],
]);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const target = path.join(dir, name);
    if (statSync(target).isDirectory()) return walk(target);
    return target.endsWith("route.ts") ? [target] : [];
  });

const routePathOf = (file) => file.replace(/^src[\\/]app/, "").replace(/[\\/]route\.ts$/, "").split(path.sep).join("/");

const files = walk(path.join("src", "app", "api"));
check("扫到了足够多的路由文件(防止空跑)", files.length > 30, `文件数=${files.length}`);

const handlers = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const methods = [...text.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)/g)].map((match) => match[1]);
  const writes = methods.filter((method) => method !== "GET");
  const route = routePathOf(file).replace(/\\/g, "/");
  if (!writes.length) continue;
  handlers.push({
    route,
    writes,
    hasGuard: GUARDS.some((guard) => text.includes(guard)),
    public: PUBLIC.has(route),
    selfGuarded: SELF_GUARDED.has(route),
  });
}

check("扫到了足够多的写处理器(防止空跑)", handlers.length > 30, `写处理器=${handlers.length}`);

const unguarded = handlers.filter((handler) => !handler.hasGuard && !handler.public && !handler.selfGuarded);
check(
  "所有写接口都有权限校验,或在「公开 / 自带校验」清单里",
  unguarded.length === 0,
  unguarded.map((handler) => `${handler.route} [${handler.writes.join(",")}]`).join(" | "),
);

// 清单不能过期:条目对应的路由必须还在
const routes = new Set(handlers.map((handler) => handler.route));
const stalePublic = [...PUBLIC.keys()].filter((route) => !routes.has(route));
const staleSelf = [...SELF_GUARDED.keys()].filter((route) => !routes.has(route));
check("「公开」清单没有过期条目", stalePublic.length === 0, stalePublic.join(", "));
check("「自带校验」清单没有过期条目", staleSelf.length === 0, staleSelf.join(", "));

// 有守卫的写接口数量(便于看出覆盖面)
const guardedCount = handlers.filter((handler) => handler.hasGuard).length;
const writeMethods = handlers.reduce((sum, handler) => sum + handler.writes.length, 0);
console.log(`      带写操作的路由 ${handlers.length} 个(共 ${writeMethods} 个写处理器):统一守卫 ${guardedCount} · 设计上公开 ${PUBLIC.size} · 自带校验 ${SELF_GUARDED.size}`);

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);