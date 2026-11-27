// 「这件东西在不在采购清单里」——只能有一处判定。
//
// 起因(2026-11-27 实测):概览上的两处说法不一致。
//   · 「补货建议」那一节会把已经进了清单的物品排除掉(只看名字);
//   · 首屏「最需要做的事」不看,于是同一件东西:补货建议不吭声,首屏还在请你「加入采购清单」。
//   实测点一次,清单上的数量从 4 盒变成 8 盒(而建议补的量本来就是 4 盒)—— 按钮上写的是
//   「加入采购清单」,不是「再加一份」。
//
// 键取「名字 + 单位」,与服务端合并采购项的键一致(src/app/api/shopping/route.ts):
// 只有「点下去会被合并」才算已经在清单里;名字相同但单位不同的(2 瓶 vs 2 盒)点下去会新建
// 一条,界面就该照实说 —— 这也正是服务端注释里那句「2 bottles is never accidentally
// combined with 2 boxes」的意思。

export type PurchaseLike = {
  name: string;
  unit?: string | null;
  status?: string | null;
  isFavorite?: boolean | null;
};

/** 采购项名字归一:去掉空白、忽略大小写(与服务端合并判定同一套规则) */
export function normalizedPurchaseName(value: string): string {
  return value.trim().replace(/\s+/g, "").toLocaleLowerCase();
}

/** 待采购项的身份:归一后的名字 + 单位 */
export function pendingPurchaseKey(name: string, unit?: string | null): string {
  return `${normalizedPurchaseName(name)}|${(unit ?? "").trim()}`;
}

/** 清单里那一条(界面要说「已经有一份 4 瓶」时用;没有就返回 null) */
export function findPendingPurchase<T extends PurchaseLike>(rows: readonly T[], name: string, unit?: string | null): T | null {
  const key = pendingPurchaseKey(name, unit);
  return rows.find((row) => row.status === "PENDING" && pendingPurchaseKey(row.name, row.unit) === key) ?? null;
}

/** 点了会不会被合并进已有的一条 */
export function isPendingPurchase(rows: readonly PurchaseLike[], name: string, unit?: string | null): boolean {
  return findPendingPurchase(rows, name, unit) !== null;
}

/**
 * 常买、且已经买过的那几条。
 *
 * ★ 的提示语是「已加入常买清单」,但全应用此前没有任何一栏列出常买 —— 而且采购项一旦标成
 * 「已购买」就从唯一渲染它的列表(待采购)里消失了,常买标记从此看不到也点不到。
 * 这里交给界面:买过的常买项留在清单里,点一下勾就能改回待采购。
 */
export function boughtFavoritePurchases<T extends PurchaseLike>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.status === "PURCHASED" && row.isFavorite === true);
}
