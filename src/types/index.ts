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
  unit: string;
  price: number | null;
  purchaseDate: string | null;
  expiryDate: string | null;
  notes: string | null;
  imageUrl: string | null;
  locationId: string | null;
  location: Location | null;
  createdAt: string;
  updatedAt: string;
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

export interface DashboardData {
  items: Item[];
  locations: Location[];
  shopping: ShoppingItem[];
}
