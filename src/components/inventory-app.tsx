"use client";

/**
 * 兼容入口:应用外壳已拆到 src/components/app/。
 *
 * - 状态与动作 → `@/components/app/app-provider`(`AppProvider` / `useApp`)
 * - 外壳与全局弹窗 → `@/components/app/app-chrome`(`AppChrome`)
 * - 视图 ↔ 路径映射 → `@/components/app/routes`
 *
 * 实际挂载点是 `src/app/(app)/layout.tsx`;这里保留同名导出,避免仍有旧引用
 * 的地方在重构期间直接编译失败。
 */
export { AppProvider, useApp } from "@/components/app/app-provider";
export type { AppContextValue, ModalKind, Role, Density, MotionMode, ToastAction } from "@/components/app/app-provider";
export { AppChrome } from "@/components/app/app-chrome";
export { VIEW_PATHS, pathForTarget, pathForView, viewForPath } from "@/components/app/routes";
