export type ItemType = "DURABLE" | "CONSUMABLE";
export type ShoppingStatus = "PENDING" | "PURCHASED";

export interface Location {
  id: string;
  name: string;
  icon: string;
  color: string;
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
  imageUrl: string | null;
  locationId: string | null;
  location: Location | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  restockPausedUntil: string | null;
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
  finance: { currentMonthTotal: number; averageMonthly: number; recordCount: number; recent: PriceRecord[] };
}
