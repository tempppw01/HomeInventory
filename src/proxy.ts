import { NextRequest, NextResponse } from "next/server";
import { ACCOUNT_COOKIE } from "@/lib/account-auth";
import { userFromToken } from "@/lib/account-auth";

// 这个文件必须在 src/ 下,而且 Next 16 里叫 proxy(旧名 middleware 已弃用)。
//
// 之前它放在仓库根目录、又叫 middleware —— 两个坑一起踩了:Next 会**静默忽略**
// 根目录下的这个文件(构建产物 .next/server/middleware-manifest.json 里是 "middleware": {},
// 一条都没编出来),所以下面两条规则从写下那天起就没有生效过:
//   · 只读账号禁止一切非 GET 请求
//   · 只有管理员能改系统设置 / 账号
// 实际拦住写操作的是**各条路由自己的** canWrite();漏网的正是没写这条判断的路由:
// 实测只读账号能 POST /api/ai/chat、能 DELETE /api/search-history(把搜索历史删掉)。
//
// 规则本身保留原来的意图,只补一条:属于「自己那份」的个人状态与纯问答能力要放行,
// 否则打开这道闸会把只读账号的 AI 助手和搜索历史一起打掉。
// 新增写接口**默认被挡住**,不必在这里登记。

/** 不需要登录就能访问的接口 */
const PUBLIC_PATH = [
  "/api/auth/login",
  "/api/auth/setup",
  "/api/auth/session",
  "/api/auth/logout",
  "/api/auth/recovery/reset",
  "/api/health",
  "/api/public/consume",
];

/**
 * 只读账号也允许的写请求:「只读」限的是家庭数据,不是自己那份。
 *   · 改自己的密码、生成自己的恢复码 —— 自助操作,否则成员/只读忘记密码只能等管理员代改
 *   · 自己的搜索历史、自己的 AI 对话记录 —— 表里按 userId 过滤,动的只是自己那一行
 *   · 问 AI 一句话 / 让 AI 分析一件物品 —— 只读提问,不改库存(真要落库得走 /api/items,那条会被挡)
 * 注意这里是**精确匹配**,所以 /api/ai/chat 与 /api/ai/chat/history 要分别列出。
 */
const SELF_SERVICE_PATH = [
  "/api/auth/password",
  "/api/auth/recovery",
  "/api/search-history",
  "/api/ai/chat",
  "/api/ai/chat/history",
  "/api/ai/analyze-item",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const writeRequest = !["GET", "HEAD", "OPTIONS"].includes(request.method);

  // 读请求直接放行:各条路由自己的 requireUser() 已经在做鉴权,
  // 这里再查一次会话只会让每个页面的十来个请求都多打一次库。
  if (!writeRequest) return NextResponse.next();
  if (PUBLIC_PATH.includes(pathname)) return NextResponse.next();

  const token = request.cookies.get(ACCOUNT_COOKIE)?.value;
  const user = token ? await userFromToken(token) : null;
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  if (user.role === "VIEWER" && !SELF_SERVICE_PATH.includes(pathname)) {
    return NextResponse.json({ error: "只读账号没有修改权限" }, { status: 403 });
  }
  if ((pathname.startsWith("/api/settings/") || pathname === "/api/auth/users") && user.role !== "ADMIN") {
    return NextResponse.json({ error: "只有管理员可以修改系统设置" }, { status: 403 });
  }
  return NextResponse.next();
}

// proxy 一直跑在 Node.js 运行时上(这也是能把 prisma 用在这里的原因),所以 config 里只留 matcher ——
// 写 runtime 会被 build 直接拒绝:"Route segment config is not allowed in Proxy file"。
export const config = { matcher: ["/api/:path*"] };
