"use client";

import {
  Archive, Bath, Boxes, ChevronRight, CookingPot, LayoutDashboard, MapPin, Package, Settings, Sofa, Warehouse, ClipboardCheck, ListTodo,
} from "lucide-react";
import { createContext } from "react";
import type { Item, ItemType, Location } from "@/types";
import { usageDays } from "@/lib/item-metrics";
import { APP_VERSION } from "@/lib/version";
import { isMedicineCategory, MEDICINE_CATEGORIES } from "@/lib/categories";
import { PageHeader } from "@/components/ui";
import { DatePickerPreset } from "@/components/date-picker";
export const ReadOnlyContext = createContext(false);

export type View = "dashboard" | "items" | "locations" | "tasks" | "audit" | "settings" | "about";
export type ThemeMode = "light" | "dark" | "system";
export type ItemQuickFilter = "ALL" | ItemType | "MEDICINE";
export type AssistantPosition = { x: number; y: number };
export type ItemDraft = {
  name: string; category: string; type: ItemType; quantity: number; minQuantity: number; remainingPercent: number;
  unit: string; price: string; purchaseDate: string; expiryDate: string; locationId: string; notes: string; imageUrl: string;
  aiSummary: string; aiStorageAdvice: string; aiUsageAdvice: string; aiReplenishmentAdvice: string;
};
export type SavedItemTemplate = Pick<ItemDraft, "name" | "category" | "type" | "quantity" | "minQuantity" | "remainingPercent" | "unit" | "expiryDate" | "locationId" | "notes"> & { id: string; usedAt: number };

export const emptyDraft: ItemDraft = {
  name: "", category: "日用", type: "DURABLE", quantity: 1, minQuantity: 0, remainingPercent: 100,
  unit: "件", price: "", purchaseDate: "", expiryDate: "", locationId: "", notes: "", imageUrl: "",
  aiSummary: "", aiStorageAdvice: "", aiUsageAdvice: "", aiReplenishmentAdvice: "",
};

export async function compressImage(file: File): Promise<File> {
  if (file.size <= 5 * 1024 * 1024 && file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg", lastModified: Date.now() });
}

export const navItems = [
  { id: "dashboard" as View, label: "概览", icon: LayoutDashboard },
  { id: "items" as View, label: "物品", icon: Boxes },
  { id: "tasks" as View, label: "任务", icon: ListTodo },
  { id: "locations" as View, label: "空间", icon: MapPin },
  { id: "audit" as View, label: "盘点", icon: ClipboardCheck },
];
// 移动端五个一级入口:概览 / 物品 / 空间 / 任务 / 设置。以前没有「空间」,
// 移动端完全进不去空间管理;悬浮加号与顶栏的「录入物品」重复,一并去掉。
export const mobileNavItems = [...navItems.filter((item) => item.id !== "audit"), { id: "settings" as View, label: "设置", icon: Settings }];

export const iconMap = { Package, CookingPot, Sofa, Bath, Warehouse };
export const categories = ["日用", "食品", "饮品", "清洁", "家电", "数码", "衣物", "医药", ...MEDICINE_CATEGORIES, "户外", "其他"];
export const units = ["件", "个", "盒", "瓶", "袋", "卷", "包", "台", "kg", "L", "ml"];
export const commonItemTemplates = [
  { keywords: ["冷冻", "虾", "饺子", "雪糕", "冰淇淋"], category: "食品", type: "CONSUMABLE" as ItemType, locationKeywords: ["冷冻", "冰箱"] },
  { keywords: ["牛奶", "酸奶", "鸡蛋", "蔬菜", "水果", "豆腐"], category: "食品", type: "CONSUMABLE" as ItemType, locationKeywords: ["冷藏", "冰箱"] },
  { keywords: ["可乐", "矿泉水", "饮料", "咖啡", "茶"], category: "饮品", type: "CONSUMABLE" as ItemType, locationKeywords: ["冷藏", "餐边", "厨房"] },
  { keywords: ["洗衣液", "洗洁精", "消毒液", "清洁剂", "纸巾", "湿巾"], category: "清洁", type: "CONSUMABLE" as ItemType, locationKeywords: ["洗衣", "清洁", "浴室", "卫生间"] },
  { keywords: ["退烧药", "感冒药", "创可贴", "药", "口罩"], category: "医药", type: "CONSUMABLE" as ItemType, locationKeywords: ["药箱", "医药"] },
] as const;
// The item detail page is a separate route, so coming back used to reset the
// view, the search box and the filters. Remember them for the trip there.
export const returnStateKey = "home-inventory-return-state";
export type ReturnState = { view?: View; search?: string; typeFilter?: ItemQuickFilter; categoryFilter?: string };
export function readReturnState(): ReturnState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(returnStateKey);
    if (!raw) return {};
    window.sessionStorage.removeItem(returnStateKey);
    return JSON.parse(raw) as ReturnState;
  } catch {
    return {};
  }
}

export const welcomeStorageKey = "home-inventory-welcome-seen";
export const legacyWelcomeStorageKeys = ["home-inventory-welcome-0.0.1"];
export const assistantPositionStorageKey = "home-inventory-ai-assistant-position-v1";
export const itemTemplateStorageKey = "home-inventory-item-templates-v1";

export function dateInputValue(daysFromToday = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 「N 个月后」按自然月对齐:今天是 11-13 就是 12-13,而不是固定 +30 天。
 * 31 号遇到没有 31 号的月份会夹到该月最后一天(3-31 + 1 个月 = 4-30)。
 */
export function monthOffsetDays(months: number) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(today.getFullYear(), today.getMonth() + months, today.getDate());
  if (target.getDate() !== today.getDate()) target.setDate(0);
  return Math.round((target.getTime() - start.getTime()) / 86400000);
}

// 快捷项按语义分组:采购只能发生在过去,保质期发生在未来,任务从今天往后。
export const purchaseDatePresets = (): DatePickerPreset[] => [
  { label: "今天", days: 0 },
  { label: "昨天", days: -1 },
  { label: "3 天前", days: -3 },
  { label: "上周", days: -7 },
  { label: "1 个月前", days: monthOffsetDays(-1) },
];
export const expiryDatePresets = (): DatePickerPreset[] => [
  { label: "3 天后", days: 3 },
  { label: "1 周后", days: 7 },
  { label: "1 个月后", days: monthOffsetDays(1) },
  { label: "3 个月后", days: monthOffsetDays(3) },
  { label: "半年后", days: monthOffsetDays(6) },
  { label: "1 年后", days: monthOffsetDays(12) },
];
export const taskDatePresets = (): DatePickerPreset[] => [
  { label: "今天", days: 0 },
  { label: "明天", days: 1 },
  { label: "1 周后", days: 7 },
  { label: "1 个月后", days: monthOffsetDays(1) },
];

/** 购入日期的相对反馈用「N 天前买的」,而不是保质期那套「已过期 N 天」。 */
export function purchaseAgeLabel(value: string) {
  const days = usageDays(value);
  if (!days) return null;
  if (days <= 1) return "今天买的";
  if (days <= 30) return `${days - 1} 天前买的`;
  const months = Math.max(1, Math.round((days - 1) / 30));
  return `约 ${months} 个月前买的`;
}

export function isMoneyInput(value: string) {
  return /^(?:\d+)?(?:[.,]\d{0,2})?$/.test(value);
}

export function moneyValue(value: string) {
  const normalized = value.replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

export function normalizedItemName(value: string) {
  return value.trim().replace(/\s+/g, "").toLocaleLowerCase();
}

export function locationPath(location: Location | null | undefined, locations: Location[]) {
  if (!location) return "未设置位置";
  const names = [location.name];
  let parentId = location.parentId;
  let guard = 0;
  while (parentId && guard < 8) {
    const parent = locations.find((entry) => entry.id === parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
    guard += 1;
  }
  return names.join(" / ");
}

export function findCommonItemTemplate(name: string) {
  const normalized = normalizedItemName(name);
  return commonItemTemplates.find((template) => template.keywords.some((keyword) => normalized.includes(keyword))) ?? null;
}

export function localDayTimestamp(value: Date | string) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function expiryDays(item: Item, now = Date.now()) {
  return Math.round((localDayTimestamp(item.expiryDate!) - localDayTimestamp(new Date(now))) / 86400000);
}

export function expiryDateLabel(item: Item, now = Date.now()) {
  const days = expiryDays(item, now);
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天到期";
  if (days === 1) return "明天到期";
  return `还剩 ${days} 天`;
}

export function expiryAdvice(item: Item) {
  if (isMedicineCategory(item.category)) return "核对后处理";
  if (["食品", "饮品"].includes(item.category)) return "优先食用";
  if (item.category === "清洁") return "尽快使用";
  return "尽快处理";
}

export function expiryGroupLabel(date: string, now = Date.now()) {
  const target = new Date(date);
  const days = Math.round((localDayTimestamp(target) - localDayTimestamp(new Date(now))) / 86400000);
  if (days < 0) return "已经过期";
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  return target.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", weekday: "short" });
}

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const retryable = !options?.method || ["GET", "PATCH", "DELETE"].includes(options.method.toUpperCase());
  for (let attempt = 0; attempt < (retryable ? 2 : 1); attempt++) {
    try {
      const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(result.error || "操作失败");
      return result as T;
    } catch (error) {
      if (attempt === 0 && retryable) continue;
      const message = error instanceof Error ? error.message : "网络请求失败";
      if (/content-length|network response|failed to fetch/i.test(message)) throw new Error("网络响应不完整，请重试；已保存的内容不会丢失");
      throw error;
    }
  }
  throw new Error("操作失败");
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-2.5"><div className="grid size-10 place-items-center rounded-2xl text-[var(--on-primary)] shadow-lg" style={{ background: "var(--primary)" }}><Archive size={21} /></div>{!compact && <div><div className="flex items-center gap-2 text-lg font-black tracking-tight">归物 <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>v{APP_VERSION}</span></div><div className="text-xs font-semibold tracking-[.18em] muted">HOME INVENTORY</div></div>}</div>;
}

export function PageTitle({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return <PageHeader title={title} description={text} action={action} />;
}

export function SectionHead({ title, action, onClick }: { title: string; action: string; onClick: () => void }) { return <div className="flex items-center justify-between gap-3"><h2 className="m-0 text-base font-black sm:text-lg">{title}</h2><button onClick={onClick} className="flex min-h-10 items-center gap-1 text-xs font-bold max-md:min-h-11" style={{ color: "var(--primary)" }}>{action}<ChevronRight size={14} /></button></div>; }
export function EmptyState({ icon: Icon, title, text }: { icon: typeof Boxes; title: string; text: string }) { return <div className="col-span-full grid place-items-center py-10 text-center"><div className="mb-3 grid size-12 place-items-center rounded-2xl" style={{ background: "var(--surface-soft)", color: "var(--muted)" }}><Icon size={21} /></div><b className="text-sm">{title}</b><p className="mb-0 mt-1 text-xs muted">{text}</p></div>; }
export function LoadingView() { return <div><div className="skeleton mb-3 h-9 w-64 rounded-xl" /><div className="skeleton mb-7 h-4 w-80 max-w-full rounded-lg" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1,2,3,4].map((i) => <div key={i} className="skeleton h-36 rounded-3xl" />)}</div><div className="mt-5 grid gap-4 md:grid-cols-2">{[1,2].map((i) => <div key={i} className="skeleton h-72 rounded-3xl" />)}</div></div>; }
