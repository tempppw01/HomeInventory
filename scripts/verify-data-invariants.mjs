// 数据不变量:把写入路径走一遍,再看库里有没有「自相矛盾」的状态。
//
// 由来:此前的套件都在验「接口返回对不对」,没有一条验「库里落下的状态自不自洽」。
// 而这类矛盾正是最难被用户说清、也最容易悄悄积累的:
//   · 撤销量与库存对不上(多退一件、少退一件)
//   · 采购入库的三件套(stockedAt / stockedQuantity / stockedItemId)只写了一半
//   · 流水指向已经不存在的物品 / 账号 / 成员
//   · 余量越界(负数或超过 100)、数量为负
//
// 这个套件分两半:
//   1 走一遍真实写入路径(单位消耗 / 余量消耗 / 撤销 / 采购入库 / 撤销入库 /
//     物品进回收站后撤销入库 / 盘点),每一步都读库核对「量必须精确对上」;
//   2 最后对**这台已经有真实流水的库**做一次全量不变量扫描(17 条),
//     空库上「没有孤儿引用」是空转,所以扫描前先断言库里确实有数据。
//
// 用法:PROBE_USER=... PROBE_PASS=... BASE_URL=... DATABASE_URL=... node scripts/verify-data-invariants.mjs
//   注意 DATABASE_URL 必须指向 BASE_URL 那个库,否则读库核对会读到空 —— 第一条检查会挡住。
//   这个套件会写库(它就是要走写入路径),请指一个临时的库,别对着家里的真实库跑。

import { PrismaClient } from "@prisma/client";
import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";
const TAG = Date.now().toString(36).slice(-6);
const NAME = (part) => `不变量-${part}-${TAG}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const prisma = new PrismaClient();
const cookie = await loginCookie(BASE, USER, PASS);
const api = async (path, init = {}) => {
  const response = await fetch(BASE + path, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text.slice(0, 160); }
  return { status: response.status, body };
};

const itemById = (id) => prisma.item.findUnique({ where: { id }, select: { id: true, name: true, quantity: true, remainingPercent: true, consumeRate: true, deletedAt: true } });
const shoppingById = (id) => prisma.shoppingItem.findUnique({ where: { id }, select: { id: true, status: true, stockedAt: true, stockedQuantity: true, stockedItemId: true } });
const lastConsume = (itemId) => prisma.activityLog.findFirst({ where: { itemId, action: "CONSUME" }, orderBy: { createdAt: "desc" }, select: { id: true, undoneAt: true, percentBefore: true, percentAfter: true } });

const cleanup = { items: [], shopping: [], locations: [] };
let exitCode = 0;

try {
  // ---------- 0 前置:两边必须是同一个库 ----------
  const probe = await api("/api/items", {
    method: "POST",
    body: JSON.stringify({ name: NAME("同库自检"), category: "日用", type: "CONSUMABLE", unit: "件", quantity: 1, minQuantity: 0, remainingPercent: 100 }),
  });
  const probeId = probe.body?.id ?? probe.body?.item?.id ?? null;
  const dbSees = probeId ? await prisma.item.findUnique({ where: { id: probeId }, select: { id: true } }) : null;
  if (probeId) {
    cleanup.items.push(probeId);
    await api(`/api/items/${probeId}`, { method: "DELETE", body: JSON.stringify({ permanent: true }) });
    cleanup.items.pop();
  }
  check("BASE_URL 与 DATABASE_URL 指向同一个库", Boolean(dbSees?.id && dbSees.id === probeId), `接口建的 id=${probeId ?? "(建失败)"},读库看到 ${dbSees?.id ?? "null"}`);
  if (!dbSees?.id || dbSees.id !== probeId) throw new Error("两边不是同一个库,后面读库核对的结论都会是错的,先停");

  // ---------- 1 造场景数据 ----------
  const location = await api("/api/locations", { method: "POST", body: JSON.stringify({ name: NAME("空间") }) });
  const locationId = location.body?.id ?? null;
  if (locationId) cleanup.locations.push(locationId);

  const unitItem = await api("/api/items", {
    method: "POST",
    body: JSON.stringify({ name: NAME("大米"), category: "食品", type: "CONSUMABLE", unit: "袋", quantity: 5, minQuantity: 0, remainingPercent: 100, price: 30, locationId }),
  });
  const unitId = unitItem.body?.id ?? unitItem.body?.item?.id ?? null;
  if (unitId) cleanup.items.push(unitId);

  const liquidItem = await api("/api/items", {
    method: "POST",
    body: JSON.stringify({ name: NAME("洗衣液"), category: "清洁", type: "CONSUMABLE", unit: "瓶", quantity: 4, minQuantity: 0, remainingPercent: 80, price: 20 }),
  });
  const liquidId = liquidItem.body?.id ?? liquidItem.body?.item?.id ?? null;
  if (liquidId) cleanup.items.push(liquidId);

  const shopping = await api("/api/shopping", { method: "POST", body: JSON.stringify({ name: NAME("抽纸"), quantity: 3, unit: "包" }) });
  // 采购项是 `{ item: {...} }` 包装(物品与空间是平的)—— 取值要按各自形状来,
  // 否则 id 恒为 null,后面每条核对都变成「拿 null 去比」。
  const shoppingId = shopping.body?.item?.id ?? shopping.body?.id ?? null;
  if (shoppingId) cleanup.shopping.push(shoppingId);

  check(
    "场景数据建成功(空间 / 单位物品 / 余量物品 / 采购项)",
    Boolean(locationId && unitId && liquidId && shoppingId),
    JSON.stringify({ location: location.status, unit: unitItem.status, liquid: liquidItem.status, shopping: shopping.status }),
  );
  if (!locationId || !unitId || !liquidId || !shoppingId) throw new Error("场景数据没建起来,后面的核对没有意义");

  // ---------- 2 单位消耗 → 撤销 → 再撤销 ----------
  const consumed = await api(`/api/items/${unitId}/consume`, { method: "POST", body: JSON.stringify({}) });
  const afterConsume = await itemById(unitId);
  const consumeRow = await lastConsume(unitId);
  check(
    "单位消耗:数量 -1、余量不动、留下一条消耗流水",
    consumed.status === 200 && afterConsume.quantity === 4 && afterConsume.remainingPercent === 100 && Boolean(consumeRow) && !consumeRow.undoneAt,
    `status=${consumed.status} quantity=${afterConsume?.quantity} percent=${afterConsume?.remainingPercent} 流水=${consumeRow?.id ?? "无"}`,
  );

  const undone = await api(`/api/activity/${consumeRow.id}/undo`, { method: "POST", body: JSON.stringify({}) });
  const afterUndo = await itemById(unitId);
  const consumeAfterUndo = await lastConsume(unitId);
  check(
    "撤销消耗:数量精确回到原值,流水标了已撤销",
    undone.status === 200 && afterUndo.quantity === 5 && Boolean(consumeAfterUndo.undoneAt),
    `status=${undone.status} quantity=${afterUndo?.quantity} undoneAt=${consumeAfterUndo?.undoneAt}`,
  );

  const undoneTwice = await api(`/api/activity/${consumeRow.id}/undo`, { method: "POST", body: JSON.stringify({}) });
  const afterDoubleUndo = await itemById(unitId);
  check(
    "同一笔消耗不能撤销两次(否则库存会凭空多出来)",
    undoneTwice.status === 409 && afterDoubleUndo.quantity === 5,
    `第二次 status=${undoneTwice.status} quantity=${afterDoubleUndo?.quantity}`,
  );

  // ---------- 3 余量消耗 → 撤销 ----------
  const percentPatch = await api(`/api/items/${liquidId}`, { method: "PATCH", body: JSON.stringify({ remainingPercent: 60 }) });
  const afterPercent = await itemById(liquidId);
  const percentRow = await lastConsume(liquidId);
  check(
    "余量消耗:余量落到提交值,流水记下 80% → 60%",
    percentPatch.status === 200 && afterPercent.remainingPercent === 60 && percentRow?.percentBefore === 80 && percentRow?.percentAfter === 60,
    `status=${percentPatch.status} percent=${afterPercent?.remainingPercent} before=${percentRow?.percentBefore} after=${percentRow?.percentAfter}`,
  );

  const percentUndo = await api(`/api/activity/${percentRow.id}/undo`, { method: "POST", body: JSON.stringify({}) });
  const afterPercentUndo = await itemById(liquidId);
  check(
    "撤销余量消耗:余量精确回到消耗前(不会多加一瓶、也不会少退)",
    percentUndo.status === 200 && afterPercentUndo.remainingPercent === 80 && afterPercentUndo.quantity === 4,
    `status=${percentUndo.status} percent=${afterPercentUndo?.remainingPercent} quantity=${afterPercentUndo?.quantity}`,
  );

  // ---------- 4 采购入库 → 重复入库 → 撤销入库 ----------
  // 入库目标必须显式给 replenishItemId:不给的话接口只把采购项标成已购买、不入库
  // (这是设计:不知道入到哪件物品上就不该猜)。所以这里先建一件「库存 0」的目标物品。
  const stockTarget = await api("/api/items", {
    method: "POST",
    body: JSON.stringify({ name: NAME("抽纸库存"), category: "日用", type: "CONSUMABLE", unit: "包", quantity: 0, minQuantity: 0, remainingPercent: 100 }),
  });
  const stockTargetId = stockTarget.body?.id ?? stockTarget.body?.item?.id ?? null;
  if (stockTargetId) cleanup.items.push(stockTargetId);
  const stockInto = (targetId, status) => api(`/api/shopping/${shoppingId}`, {
    method: "PATCH",
    body: JSON.stringify(status === "PURCHASED" ? { status, replenishItemId: targetId } : { status }),
  });

  const stocked = await stockInto(stockTargetId, "PURCHASED");
  const shoppingAfterStock = await shoppingById(shoppingId);
  const itemAfterStock = stockTargetId ? await itemById(stockTargetId) : null;
  check(
    "采购入库:库存 +3,且三件套(时间/数量/物品)齐全",
    stocked.status === 200 && stocked.body?.stocked === true && Boolean(shoppingAfterStock?.stockedAt) && shoppingAfterStock?.stockedQuantity === 3 && shoppingAfterStock?.stockedItemId === stockTargetId && itemAfterStock?.quantity === 3,
    `status=${stocked.status} stocked=${stocked.body?.stocked} qty=${shoppingAfterStock?.stockedQuantity} itemQty=${itemAfterStock?.quantity}`,
  );

  const stockedAgain = await stockInto(stockTargetId, "PURCHASED");
  const itemAfterAgain = stockTargetId ? await itemById(stockTargetId) : null;
  check(
    "重复点「已购买」不重复加库存",
    stockedAgain.status === 200 && stockedAgain.body?.stocked === false && itemAfterAgain?.quantity === 3,
    `第二次 status=${stockedAgain.status} stocked=${stockedAgain.body?.stocked} 物品数量=${itemAfterAgain?.quantity}`,
  );

  const unstocked = await stockInto(stockTargetId, "PENDING");
  const shoppingAfterUnstock = await shoppingById(shoppingId);
  const itemAfterUnstock = stockTargetId ? await itemById(stockTargetId) : null;
  check(
    "撤销入库:库存退回原值,三件套一起清空(不留半截记账)",
    unstocked.status === 200 && itemAfterUnstock?.quantity === 0 && shoppingAfterUnstock?.stockedAt === null && shoppingAfterUnstock?.stockedQuantity === null && shoppingAfterUnstock?.stockedItemId === null,
    `status=${unstocked.status} itemQty=${itemAfterUnstock?.quantity} stockedAt=${shoppingAfterUnstock?.stockedAt} stockedQty=${shoppingAfterUnstock?.stockedQuantity} stockedItem=${shoppingAfterUnstock?.stockedItemId}`,
  );

  // ---------- 5 入库目标被扔进回收站之后再撤销入库 ----------
  // 「正确答案」不唯一(可以先拒绝,也可以照常退回),唯一不能接受的是:
  // 量被悄悄改了、而三件套还留着半截 —— 那笔账就再也对不上了。
  await stockInto(stockTargetId, "PURCHASED");
  await api(`/api/items/${stockTargetId}`, { method: "DELETE", body: JSON.stringify({}) });
  const trashed = stockTargetId ? await itemById(stockTargetId) : null;
  const unstockTrashed = await stockInto(stockTargetId, "PENDING");
  const shoppingAfterTrashUnstock = await shoppingById(shoppingId);
  const itemAfterTrashUnstock = stockTargetId ? await itemById(stockTargetId) : null;
  const tripleConsistent = (shoppingAfterTrashUnstock?.stockedAt === null) === (shoppingAfterTrashUnstock?.stockedQuantity === null)
    && (shoppingAfterTrashUnstock?.stockedAt === null) === (shoppingAfterTrashUnstock?.stockedItemId === null);
  check(
    "对回收站里的物品撤销入库:不静默改量,三件套保持一致",
    Boolean(trashed?.deletedAt) && tripleConsistent,
    `trashed=${Boolean(trashed?.deletedAt)} status=${unstockTrashed.status} stockedAt=${shoppingAfterTrashUnstock?.stockedAt} qty=${itemAfterTrashUnstock?.quantity} 三件套一致=${tripleConsistent}`,
  );

  // ---------- 6 盘点数量上界(只验「被拒」,不真的写记录) ----------
  // 为什么不用 `{total: 5, confirmed: 99}` 去验夹取:盘点接口只保留最近 20 条,
  // 写进一条就会顶掉这个库里一条**真实**历史。夹取逻辑改由恢复备份那一段验
  // (它读回来的 confirmed 必须等于 total),这里只验越界请求被拒且没落库。
  const auditLocation = NAME("盘点");
  const auditRejected = await api("/api/audits", { method: "POST", body: JSON.stringify({ total: 1_000_000_000, confirmed: 1, locationName: auditLocation }) });
  const auditLeaked = await prisma.auditRecord.count({ where: { locationName: auditLocation } });
  check(
    "接口拒绝超出范围的盘点数量,且没有顺手写进历史",
    auditRejected.status === 400 && auditLeaked === 0,
    `status=${auditRejected.status} 落库=${auditLeaked}`,
  );

  // ---------- 7 任务的状态机(顺带证明不变量不会误报) ----------
  // 由来:上一版这里有一条「状态与完成时间矛盾」的不变量,把**正常**的周期任务也算了进去 ——
  // 周期任务完成后 status 仍是 OPEN、completedAt 记录上次完成,这是设计,不是矛盾。
  // 这一节既钉住真实状态机,也证明那条 SQL 现在只抓真矛盾。
  const weekly = await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: NAME("每周任务"), dueAt: "2026-12-01", recurrence: "WEEKLY" }) });
  const weeklyId = weekly.body?.id ?? weekly.body?.task?.id ?? null;
  const oneOff = await api("/api/tasks", { method: "POST", body: JSON.stringify({ title: NAME("一次性任务"), dueAt: "2026-12-01", recurrence: "NONE" }) });
  const oneOffId = oneOff.body?.id ?? oneOff.body?.task?.id ?? null;
  await api("/api/tasks", { method: "PATCH", body: JSON.stringify({ id: weeklyId, action: "toggle" }) });
  await api("/api/tasks", { method: "PATCH", body: JSON.stringify({ id: oneOffId, action: "toggle" }) });
  const weeklyRow = weeklyId ? await prisma.householdTask.findUnique({ where: { id: weeklyId } }) : null;
  const oneOffRow = oneOffId ? await prisma.householdTask.findUnique({ where: { id: oneOffId } }) : null;
  const advancedDays = weeklyRow ? Math.round((weeklyRow.dueAt.getTime() - new Date("2026-12-01").getTime()) / 86400000) : null;
  check(
    "周期任务完成一次:状态保持待办、到期日顺延 7 天、记下完成时间",
    weeklyRow?.status === "OPEN" && advancedDays === 7 && Boolean(weeklyRow?.completedAt),
    `status=${weeklyRow?.status} 顺延=${advancedDays} 天 completedAt=${Boolean(weeklyRow?.completedAt)}`,
  );
  check(
    "一次性任务完成:状态变已完成并记下完成时间",
    oneOffRow?.status === "DONE" && Boolean(oneOffRow?.completedAt),
    `status=${oneOffRow?.status} completedAt=${Boolean(oneOffRow?.completedAt)}`,
  );

  // 上面这两个任务正是旧版不变量误报的形状。这里既确认它在**合法数据**上为 0,
  // 也确认它真的能抓到矛盾(临时插一行矛盾的,查完立刻删掉)—— 否则「为 0」也可能只是查错了。
  const taskContradictionSql = "SELECT COUNT(*) FROM HouseholdTask WHERE (status = 'DONE' AND completedAt IS NULL) OR (status <> 'DONE' AND completedAt IS NOT NULL AND nextDueAt IS NULL)";
  const countTasks = async () => Number(Object.values((await prisma.$queryRawUnsafe(taskContradictionSql))[0] ?? {})[0] ?? 0);
  const legitimate = await countTasks();
  const planted = await prisma.householdTask.create({ data: { title: NAME("故意矛盾"), dueAt: new Date("2026-12-01"), recurrence: "NONE", status: "OPEN", completedAt: new Date(), nextDueAt: null } });
  const afterPlant = await countTasks();
  await prisma.householdTask.delete({ where: { id: planted.id } });
  const afterCleanup = await countTasks();
  check(
    "任务不变量:正常数据为 0,且真能抓到矛盾(插一行矛盾的会变 1)",
    legitimate === 0 && afterPlant === legitimate + 1 && afterCleanup === 0,
    `合法数据=${legitimate} 插入矛盾后=${afterPlant} 删掉后=${afterCleanup}`,
  );

  for (const id of [weeklyId, oneOffId]) {
    if (id) await api("/api/tasks", { method: "PATCH", body: JSON.stringify({ id, action: "delete" }) });
  }

  // ---------- 8 恢复备份:外部文件里能塞进什么,库里就会出现什么 ----------
  // 备份是唯一一条「用户能塞进任意数字、我们又无法校验来源」的入口
  // (老版本导出的、手改的、下载截断的)。这里塞一组应用自己绝不会产生的值进去。
  const restoreTag = NAME("恢复");
  const nowIso = new Date().toISOString();
  const badBackup = {
    version: 1,
    exportedAt: nowIso,
    locations: [],
    items: [
      { id: "src-ok", name: `${restoreTag}-正常物品`, category: "食品", type: "CONSUMABLE", unit: "袋", quantity: 5, minQuantity: 0, remainingPercent: 80 },
      { id: "src-neg", name: `${restoreTag}-负数量`, category: "食品", type: "CONSUMABLE", unit: "袋", quantity: -3, minQuantity: 0, remainingPercent: 80 },
      { id: "src-pct", name: `${restoreTag}-越界余量`, category: "食品", type: "CONSUMABLE", unit: "袋", quantity: 1, minQuantity: 0, remainingPercent: 250 },
    ],
    shopping: [],
    priceRecords: [
      { itemName: `${restoreTag}-负价格`, category: "食品", unitPrice: -100, totalPrice: -100, quantity: -2, purchasedAt: nowIso, store: "x" },
    ],
    members: [{ name: `${restoreTag}-正常成员`, color: "#7c3aed" }, { name: "名".repeat(40) }],
    // 周期只认白名单:这里塞一个不认识的
    tasks: [{ title: `${restoreTag}-怪周期`, dueAt: new Date(Date.now() + 86400000).toISOString(), recurrence: "每周", status: "OPEN" }],
    audits: [
      { total: 1_000_000_000, confirmed: 999_999_999, finishedAt: nowIso, locationName: `${restoreTag}-巨额盘点` },
      { total: 5, confirmed: 99, finishedAt: new Date(Date.now() - 3600_000).toISOString(), locationName: `${restoreTag}-超确认盘点` },
    ],
    // 偏好:界面上「提前 1~90 天」与「每周盘点 0~6」,这里塞越界值
    preferences: [{ expiryReminderDays: -3, weeklyReviewDay: 99, lowStockReminder: false, weeklyReviewEnabled: true }],
    activities: [
      { action: "CONSUME", itemId: "src-ok", itemName: `${restoreTag}-正常物品`, detail: "余量 150% → 300%", percentBefore: 150, percentAfter: 300, createdAt: nowIso },
    ],
  };
  const restored = await api("/api/backup/restore", { method: "POST", body: JSON.stringify(badBackup) });
  const restoredItems = await prisma.item.findMany({ where: { name: { contains: restoreTag } }, select: { id: true, name: true, remainingPercent: true } });
  if (restoredItems.length) cleanup.items.push(...restoredItems.map((row) => row.id));
  const skippedReasons = JSON.stringify(restored.body?.skipped ?? {});
  check(
    "恢复备份:负数量 / 越界余量的物品被拒绝并说明原因",
    restored.status === 200 && restoredItems.length === 1 && /数量/.test(skippedReasons) && /余量|remainingPercent/.test(skippedReasons),
    `status=${restored.status} 落库物品=${restoredItems.length} skipped=${skippedReasons.slice(0, 160)}`,
  );

  const restoredAudits = await prisma.auditRecord.findMany({ where: { locationName: { contains: restoreTag } }, select: { total: true, confirmed: true, locationName: true } });
  const clampedAudit = restoredAudits.find((row) => row.locationName.includes("超确认"));
  check(
    "恢复备份:盘点的巨额与超确认数字进不了库(接口会拒绝的值,备份里也不行)",
    restoredAudits.every((row) => row.total <= 1_000_000 && row.confirmed <= row.total) && (!clampedAudit || clampedAudit.confirmed === 5),
    `落库盘点=${JSON.stringify(restoredAudits)}`,
  );

  const restoredPrices = await prisma.priceRecord.findMany({ where: { itemName: { contains: restoreTag } }, select: { unitPrice: true, totalPrice: true, quantity: true } });
  check(
    "恢复备份:负单价 / 负数量的价格记录被拒绝(否则月报支出会被拉低)",
    restoredPrices.length === 0,
    `落库价格记录=${JSON.stringify(restoredPrices)}`,
  );

  const affectedItem = restoredItems[0] ?? null;
  const restoredActivity = affectedItem
    ? await prisma.activityLog.findFirst({ where: { itemId: affectedItem.id, action: "CONSUME" }, select: { id: true, percentBefore: true, percentAfter: true } })
    : null;
  let undoOutcome = { status: 0, percent: affectedItem?.remainingPercent ?? null };
  if (restoredActivity) {
    const undoAttempt = await api(`/api/activity/${restoredActivity.id}/undo`, { method: "POST", body: JSON.stringify({}) });
    const afterAttempt = affectedItem ? await itemById(affectedItem.id) : null;
    undoOutcome = { status: undoAttempt.status, percent: afterAttempt?.remainingPercent ?? null };
  }
  check(
    "恢复备份:越界的余量标记不会让「撤销消耗」把余量写坏(记录还在,但拒绝执行)",
    Boolean(restoredActivity) && restoredActivity.percentBefore === null && undoOutcome.status === 409 && undoOutcome.percent === 80,
    `流水=${JSON.stringify(restoredActivity)} 撤销status=${undoOutcome.status} 余量=${undoOutcome.percent}`,
  );
  const restoredPrefs = await prisma.householdPreference.findUnique({ where: { id: "default" } });
  check(
    "恢复备份:越界的偏好被夹回合法范围(合法的字段保留)",
    restoredPrefs?.expiryReminderDays === 1 && restoredPrefs?.weeklyReviewDay === 6 && restoredPrefs?.lowStockReminder === false,
    `提前=${restoredPrefs?.expiryReminderDays} 星期=${restoredPrefs?.weeklyReviewDay} 低库存提醒=${restoredPrefs?.lowStockReminder}`,
  );
  const restoredTask = await prisma.householdTask.findFirst({ where: { title: { contains: restoreTag } }, select: { id: true, recurrence: true, status: true, dueAt: true } });
  const restoredMembers = await prisma.householdMember.findMany({ where: { name: { contains: restoreTag } }, select: { name: true } });
  check(
    "恢复备份:不认识的周期不会原样落库(任务保留,周期降级为一次性)",
    Boolean(restoredTask) && restoredTask.recurrence === "NONE",
    `recurrence=${JSON.stringify(restoredTask?.recurrence ?? null)}`,
  );
  // 降级之后「完成」必须真的完成(修之前:接口 200、状态仍是待办、到期日顺延 0 天)
  let completedNow = null;
  if (restoredTask) {
    await api("/api/tasks", { method: "PATCH", body: JSON.stringify({ id: restoredTask.id, action: "toggle" }) });
    completedNow = await prisma.householdTask.findUnique({ where: { id: restoredTask.id }, select: { status: true, completedAt: true } });
  }
  check(
    "恢复备份:降级成一次性的任务「完成」后真的完成",
    completedNow?.status === "DONE" && Boolean(completedNow?.completedAt),
    `status=${completedNow?.status} completedAt=${Boolean(completedNow?.completedAt)}`,
  );
  const longNameCount = await prisma.householdMember.count({ where: { name: "名".repeat(40) } });
  check(
    "恢复备份:超过 30 字的成员名被拒绝(和成员接口同一条规则)",
    restoredMembers.length === 1 && longNameCount === 0,
    `落库成员=${JSON.stringify(restoredMembers.map((row) => row.name.slice(0, 12)))} 超长名=${longNameCount}`,
  );
  await prisma.householdTask.deleteMany({ where: { title: { contains: restoreTag } } });
  await prisma.householdMember.deleteMany({ where: { name: { contains: restoreTag } } });
  await prisma.householdMember.deleteMany({ where: { name: "名".repeat(40) } });

  // 恢复成默认值,免得影响后面的检查
  await prisma.householdPreference.deleteMany({});

  await prisma.activityLog.deleteMany({ where: { itemName: { contains: restoreTag } } });
  await prisma.priceRecord.deleteMany({ where: { itemName: { contains: restoreTag } } });
  await prisma.auditRecord.deleteMany({ where: { locationName: { contains: restoreTag } } });

  // ---------- 9 全库不变量扫描 ----------
  const count = async (sql) => Number(Object.values((await prisma.$queryRawUnsafe(sql))[0] ?? {})[0] ?? 0);
  const scale = {
    items: await count("SELECT COUNT(*) FROM Item"),
    activity: await count("SELECT COUNT(*) FROM ActivityLog"),
    shopping: await count("SELECT COUNT(*) FROM ShoppingItem"),
  };
  const invariants = [
    ["物品数量为负", "SELECT COUNT(*) FROM Item WHERE quantity < 0"],
    ["余量越界(不在 0..100)", "SELECT COUNT(*) FROM Item WHERE remainingPercent IS NOT NULL AND (remainingPercent < 0 OR remainingPercent > 100)"],
    ["物品指向不存在的空间", "SELECT COUNT(*) FROM Item i LEFT JOIN Location l ON i.locationId = l.id WHERE i.locationId IS NOT NULL AND l.id IS NULL"],
    ["物品编号重复", "SELECT COUNT(*) FROM (SELECT itemCode FROM Item WHERE itemCode IS NOT NULL GROUP BY itemCode HAVING COUNT(*) > 1)"],
    ["到期日早于购入日", "SELECT COUNT(*) FROM Item WHERE expiryDate IS NOT NULL AND purchaseDate IS NOT NULL AND expiryDate < purchaseDate"],
    ["活动记录指向不存在的物品", "SELECT COUNT(*) FROM ActivityLog a LEFT JOIN Item i ON a.itemId = i.id WHERE a.itemId IS NOT NULL AND i.id IS NULL"],
    ["活动记录指向不存在的账号", "SELECT COUNT(*) FROM ActivityLog a LEFT JOIN User u ON a.userId = u.id WHERE a.userId IS NOT NULL AND u.id IS NULL"],
    ["活动记录指向不存在的成员", "SELECT COUNT(*) FROM ActivityLog a LEFT JOIN HouseholdMember m ON a.memberId = m.id WHERE a.memberId IS NOT NULL AND m.id IS NULL"],
    ["撤销比例越界", "SELECT COUNT(*) FROM ActivityLog WHERE percentBefore IS NOT NULL AND (percentBefore < 0 OR percentBefore > 100)"],
    ["采购入库三件套不一致", "SELECT COUNT(*) FROM ShoppingItem WHERE (stockedAt IS NULL) <> (stockedQuantity IS NULL)"],
    ["采购入库指向不存在的物品", "SELECT COUNT(*) FROM ShoppingItem s LEFT JOIN Item i ON s.stockedItemId = i.id WHERE s.stockedItemId IS NOT NULL AND i.id IS NULL"],
    ["采购数量为负或为 0", "SELECT COUNT(*) FROM ShoppingItem WHERE quantity <= 0"],
    ["盘点记录确认数超过总数", "SELECT COUNT(*) FROM AuditRecord WHERE confirmed > total"],
    ["盘点记录为负", "SELECT COUNT(*) FROM AuditRecord WHERE total < 0 OR confirmed < 0"],
    // 这条原来写错了(我自己 v0.1.85 埋的):把「周期任务完成一次」当成矛盾。
    // 而应用的设计是——周期任务完成后 **status 保持 OPEN**(等下一轮),completedAt 记录「上次做完」,
    // dueAt/nextDueAt 顺延到下一期。实测:完成一个「每周」任务后,旧版这条 SQL 命中 1,
    // 也就是说任何用过周期任务的家庭,这个套件都会红一次。
    // 真矛盾只有两种:说了 DONE 却没有完成时间;既不是 DONE、也没有下一期,却有完成时间。
    ["任务状态与完成时间矛盾", "SELECT COUNT(*) FROM HouseholdTask WHERE (status = 'DONE' AND completedAt IS NULL) OR (status <> 'DONE' AND completedAt IS NOT NULL AND nextDueAt IS NULL)"],
    ["创建时间在未来(超过 10 分钟)", "SELECT COUNT(*) FROM Item WHERE createdAt > datetime('now', '+10 minutes')"],
    ["已删除物品出现负库存", "SELECT COUNT(*) FROM Item WHERE deletedAt IS NOT NULL AND quantity < 0"],
    ["偏好设置越界", "SELECT COUNT(*) FROM HouseholdPreference WHERE expiryReminderDays < 1 OR expiryReminderDays > 90 OR weeklyReviewDay < 0 OR weeklyReviewDay > 6"],
    ["任务周期不在白名单", "SELECT COUNT(*) FROM HouseholdTask WHERE recurrence NOT IN ('NONE','DAILY','WEEKLY','MONTHLY','QUARTERLY','HALF_YEARLY','YEARLY')"],
  ];
  const violations = [];
  for (const [label, sql] of invariants) {
    const hits = await count(sql);
    if (hits > 0) violations.push(`${label}=${hits}`);
  }
  // 空库上「没有孤儿引用」是空转:先要求这台库确实有真实流水
  const meaningful = scale.items > 0 && scale.activity > 0;
  check(
    `全库 ${invariants.length} 条不变量为 0(在确实有数据的库上量)`,
    meaningful && violations.length === 0,
    meaningful ? violations.join("; ") : `库太空(物品 ${scale.items} / 流水 ${scale.activity}),这条会变成空转`,
  );
} catch (error) {
  check("套件自身跑完(出现异常说明场景没走通)", false, String(error).slice(0, 180));
} finally {
  // ---------- 10 清理:自己的场景数据全部删掉 ----------
  for (const id of cleanup.items) {
    await api(`/api/items/${id}`, { method: "DELETE", body: JSON.stringify({ permanent: true }) }).catch(() => undefined);
  }
  for (const id of cleanup.shopping) {
    await api(`/api/shopping/${id}`, { method: "PATCH", body: JSON.stringify({ status: "PENDING" }) }).catch(() => undefined);
    await api(`/api/shopping/${id}`, { method: "DELETE" }).catch(() => undefined);
  }
  for (const id of cleanup.locations) {
    await api(`/api/locations/${id}`, { method: "DELETE" }).catch(() => undefined);
  }
  const leftovers = {
    items: await prisma.item.count({ where: { name: { contains: TAG } } }),
    shopping: await prisma.shoppingItem.count({ where: { name: { contains: TAG } } }),
    locations: await prisma.location.count({ where: { name: { contains: TAG } } }),
  };
  check("清理干净:自己造的场景数据一件不留", leftovers.items === 0 && leftovers.shopping === 0 && leftovers.locations === 0, JSON.stringify(leftovers));
  await prisma.$disconnect();
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);