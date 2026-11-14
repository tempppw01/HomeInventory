import type { View } from "@/components/shared";

/**
 * 视图 ↔ URL 映射:一级导航现在是真的路由,不再只存在于组件 state 里。
 * 详情页 `/items/[id]`、公开消耗页 `/consume/[id]` 是独立路由,不在这张表里。
 */
export const VIEW_PATHS: Record<View, string> = {
  dashboard: "/",
  items: "/items",
  locations: "/locations",
  tasks: "/tasks",
  audit: "/audit",
  settings: "/settings",
  about: "/about",
};

const PATH_VIEW_ENTRIES = Object.entries(VIEW_PATHS) as [View, string][];

/** 视图 id → 路径;未知 id 回落到首页。 */
export function pathForView(view: View): string {
  return VIEW_PATHS[view] ?? "/";
}

/** 导航目标既接受视图 id(视图内部沿用 `onNavigate("items")`),也接受现成路径。 */
export function pathForTarget(target: View | string): string {
  return target.startsWith("/") ? target : pathForView(target as View);
}

/**
 * 由 pathname 推导当前视图。带尾斜杠的地址归一化后再比较;
 * 认不出的路径(理论上不会出现在 (app) 布局里)回落到概览。
 */
export function viewForPath(pathname: string | null | undefined): View {
  const raw = (pathname ?? "/").trim();
  const path = raw.length > 1 ? raw.replace(/\/+$/, "") : "/";
  const match = PATH_VIEW_ENTRIES.find(([, href]) => href === path);
  return match ? match[0] : "dashboard";
}
