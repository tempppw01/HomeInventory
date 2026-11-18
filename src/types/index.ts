export type ItemType = "DURABLE" | "CONSUMABLE";
export type ShoppingStatus = "PENDING" | "PURCHASED";
export type TaskStatus = "OPEN" | "DONE";
export type TaskRecurrence = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY";

export interface HouseholdTask {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  recurrence: TaskRecurrence;
  status: TaskStatus;
  completedAt: string | null;
  nextDueAt: string | null;
  createdAt: string;
}

export interface Location {
  id: string;
  name: string;
  icon: string;
  color: string;
  thumbnailUrl: string | null;
  parentId?: string | null;
  parent?: { id: string; name: string } | null;
  _count?: { items: number };
}

export interface Item {
  id: string;
  itemCode: string | null;
  name: string;
  category: string;
  type: ItemType;
  quantity: number;
  minQuantity: number;
  remainingPercent: number;
  unit: string;
  price: number | null;
  purchaseDate: string | null;
  expiryDate: string | null;
  notes: string | null;
  aiSummary: string | null;
  aiStorageAdvice: string | null;
  aiUsageAdvice: string | null;
  aiReplenishmentAdvice: string | null;
  /** 后台规则引擎写入的存放建议:COLD / COLD_AFTER_OPEN / ROOM */
  storage: string | null;
  storageReason: string | null;
  /** 后台自动标签,逗号分隔,参与搜索 */
  autoTags: string | null;
  imageUrl: string | null;
  locationId: string | null;
  location: Location | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  restockPausedUntil: string | null;
  consumeRate?: number;
  lastRestockedAt?: string | null;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  category: string | null;
  priority: number;
  status: ShoppingStatus;
  source: string;
  isFavorite?: boolean;
  createdAt: string;
}

export interface PriceRecord {
  id: string;
  itemId: string | null;
  itemName: string;
  category: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  purchasedAt: string;
  store: string | null;
}

export interface DashboardData {
  items: Item[];
  locations: Location[];
  shopping: ShoppingItem[];
  finance: { currentMonthTotal: number; averageMonthly: number; recordCount: number; recent: PriceRecord[]; byCategory: { category: string; total: number }[]; monthly: { label: string; value: number }[] };
  consumption: { itemName: string; count: number; lastUsedAt: string }[];
  preferences?: { expiryReminderDays: number; lowStockReminder: boolean; weeklyReviewEnabled: boolean; weeklyReviewDay: number };
  tasks: HouseholdTask[];
  /** AI 未配置时前端把 AI 按钮换成「去设置」引导,而不是让用户点了才看到报错。 */
  aiAvailable?: boolean;
}
