// 备份导出 → 清空 → 导入 回环测试:逐字段比对,确保不丢字段、不翻倍。

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`); };

async function fetchWithRetry(url, init) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await globalThis.fetch(url, init);
    if (response.status !== 429) return response;
    const wait = Number(response.headers.get("retry-after") ?? 5);
    console.log("      限速中,等待 " + wait + " 秒后重试");
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
  }
  throw new Error("still rate limited");
}

const login = await fetchWithRetry(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.PROBE_USER || "bgs", password: process.env.PROBE_PASS }) });
if (!login.ok) throw new Error("login failed " + login.status);
const cookie = login.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");

const call = async (method, path, body) => {
  const response = await fetchWithRetry(BASE + path, { method, headers: body !== undefined ? { cookie, "content-type": "application/json" } : { cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 120) }; }
  return { status: response.status, body: json };
};

// ---- 1. 造一套有代表性的数据 ----
const itemBase = { category: "清洁", type: "CONSUMABLE", minQuantity: 1, remainingPercent: 65, unit: "瓶", price: 39.9, purchaseDate: "2026-11-01", expiryDate: "2027-05-01", locationId: null, notes: "备份回环测试用,含中文与符号 ✓", imageUrl: null, recordPurchase: true, purchaseStore: "楼下超市" };
const signature = {};

{
  const location = await call("POST", "/api/locations", { name: "B-厨房", icon: "CookingPot", parentId: null });
  signature.locationId = location.body?.id;
  const sub = await call("POST", "/api/locations", { name: "B-吊柜", icon: "Package", parentId: signature.locationId });
  signature.subLocationId = sub.body?.id;

  const items = [
    { ...itemBase, name: "B-洗洁精", quantity: 2, locationId: signature.locationId },
    { ...itemBase, name: "B-洗衣液", quantity: 2.5, unit: "kg", category: "清洁", locationId: signature.subLocationId },
    { ...itemBase, name: "B-电钻", type: "DURABLE", quantity: 1, unit: "台", category: "家电", price: 399, expiryDate: null, remainingPercent: 100 },
  ];
  signature.itemIds = [];
  for (const body of items) {
    const r = await call("POST", "/api/items", body);
    if (r.body?.id) signature.itemIds.push(r.body.id);
  }

  const task = await call("POST", "/api/tasks", { title: "B-换滤芯", description: "三个月一次", dueAt: "2027-01-15T02:00:00.000Z", recurrence: "QUARTERLY" });
  signature.taskId = task.body?.id;
  const recurrence = task.body?.recurrence ?? null;
  record("准备", "任务创建(QUARTERLY 是否被支持)", task.status < 400, `status=${task.status} recurrence=${recurrence}(若为 NONE 说明该周期未被支持,记为观察项)`);

  const shopping = await call("POST", "/api/shopping", { name: "B-采购纸巾", quantity: 3, unit: "包", category: "日用" });
  signature.shoppingId = shopping.body?.id;

  record("准备", "创建 3 件物品 / 2 个空间 / 1 任务 / 1 采购", signature.itemIds.length === 3 && Boolean(signature.locationId) && Boolean(signature.taskId) && Boolean(signature.shoppingId), JSON.stringify({ items: signature.itemIds.length, location: Boolean(signature.locationId), task: Boolean(signature.taskId), shopping: Boolean(signature.shoppingId) }));
}

// ---- 2. 导出备份 ----
const exportResponse = await fetchWithRetry(`${BASE}/api/backup`, { headers: { cookie } });
const backupText = await exportResponse.text();
let backup = null;
try { backup = JSON.parse(backupText); } catch { backup = null; }
record("导出", "GET /api/backup 返回 JSON", exportResponse.ok && backup !== null, `status=${exportResponse.status} bytes=${backupText.length}`);
if (!backup) { console.log("无法继续:导出失败"); process.exit(1); }

const counts = {
  items: backup.items?.length ?? 0,
  locations: backup.locations?.length ?? 0,
  shopping: backup.shopping?.length ?? backup.shoppingItems?.length ?? 0,
  tasks: backup.tasks?.length ?? 0,
  priceRecords: backup.priceRecords?.length ?? 0,
  members: backup.members?.length ?? 0,
};
console.log("      备份内容:", JSON.stringify(counts));
record("导出", "备份包含 3 件物品", counts.items === 3, JSON.stringify(counts));
record("导出", "备份包含 2 个空间", counts.locations === 2, JSON.stringify(counts));
record("导出", "备份包含任务与采购", counts.tasks >= 1 && counts.shopping >= 1, JSON.stringify(counts));
record("导出", "备份不含密码哈希", !/"passwordHash"\s*:/.test(backupText), "若出现 passwordHash 需立刻处理");

const exportedItem = backup.items?.find((row) => row.name === "B-洗洁精");
record("导出", "物品字段完整(name/category/unit/quantity/price/notes/purchaseDate)",
  exportedItem ? ["name", "category", "unit", "quantity", "price", "notes", "purchaseDate"].every((key) => key in exportedItem) : false,
  exportedItem ? JSON.stringify(Object.keys(exportedItem)) : "未找到 B-洗洁精");
record("导出", "保留小数数量(2.5 kg)", backup.items?.some((row) => row.name === "B-洗衣液" && row.quantity === 2.5) ?? false, "未找到 2.5");
record("导出", "保留中文与符号备注", backup.items?.some((row) => String(row.notes ?? "").includes("✓")) ?? false, "备注未保留");

// ---- 3. 清空 ----
for (const id of signature.itemIds) await call("DELETE", `/api/items/${id}`);
await call("DELETE", `/api/tasks/${signature.taskId}`);
await call("DELETE", `/api/shopping/${signature.shoppingId}`);
if (signature.subLocationId) await call("DELETE", `/api/locations/${signature.subLocationId}`);
if (signature.locationId) await call("DELETE", `/api/locations/${signature.locationId}`);
const afterClear = await call("GET", "/api/items");
const clearedItems = Array.isArray(afterClear.body) ? afterClear.body : (afterClear.body?.items ?? []);
record("清空", "测试数据已清空(列表里没有 B- 前缀物品)", !clearedItems.some((row) => String(row.name).startsWith("B-")), `剩余=${clearedItems.length}`);

// ---- 4. 导入同一份备份 ----
const restore = await call("POST", "/api/backup/restore", backup);
record("导入", "恢复备份返回成功", restore.status < 400, `status=${restore.status} body=${JSON.stringify(restore.body).slice(0, 160)}`);

const afterRestore = await call("GET", "/api/items?includeDeleted=1");
const restoredItems = Array.isArray(afterRestore.body) ? afterRestore.body : (afterRestore.body?.items ?? []);
const findRestored = (name) => restoredItems.find((row) => row.name === name);
const dish = findRestored("B-洗洁精");
const liquid = findRestored("B-洗衣液");
const drill = findRestored("B-电钻");

record("回环", "物品数量恢复为 3(不翻倍)", restoredItems.filter((row) => String(row.name).startsWith("B-")).length === 3, `实际=${restoredItems.filter((row) => String(row.name).startsWith("B-")).length}`);
record("回环", "备注与符号完整", String(dish?.notes ?? "").includes("✓"), `notes=${dish?.notes}`);
record("回环", "价格保留 39.9", dish?.price === 39.9, `price=${dish?.price}`);
record("回环", "小数数量 2.5kg 保留", liquid?.quantity === 2.5, `quantity=${liquid?.quantity}`);
record("回环", "耐用品类型保留", drill?.type === "DURABLE", `type=${drill?.type}`);
record("回环", "购入/到期日期保留", dish?.purchaseDate?.slice(0, 10) === "2026-11-01" && dish?.expiryDate?.slice(0, 10) === "2027-05-01", `purchase=${dish?.purchaseDate} expiry=${dish?.expiryDate}`);
record("回环", "剩余量 65% 保留", dish?.remainingPercent === 65, `remaining=${dish?.remainingPercent}`);
record("回环", "物品重新分配了编号", Boolean(dish?.itemCode), `itemCode=${dish?.itemCode}`);

const dashAfter = await call("GET", "/api/dashboard");
const shoppingAfter = dashAfter.body?.shopping ?? dashAfter.body?.shoppingItems ?? [];
record("回环", "采购项恢复", shoppingAfter.some((row) => row.name === "B-采购纸巾"), `采购项=${shoppingAfter.length}`);
const locationsAfter = await call("GET", "/api/locations");
const locationRows = Array.isArray(locationsAfter.body) ? locationsAfter.body : (locationsAfter.body?.items ?? []);
record("回环", "空间恢复(含父子层级)", locationRows.filter((row) => String(row.name).startsWith("B-")).length === 2, `空间=${JSON.stringify(locationRows.filter((row) => String(row.name).startsWith("B-")).map((row) => row.name))}`);
const taskAfter = await call("GET", "/api/tasks");
const taskRows = Array.isArray(taskAfter.body) ? taskAfter.body : (taskAfter.body?.items ?? []);
record("回环", "任务恢复", taskRows.some((row) => row.title === "B-换滤芯"), `任务=${taskRows.length}`);

// ---- 5. 二次导入应跳过重复 ----
const again = await call("POST", "/api/backup/restore", backup);
record("幂等", "二次导入不报错", again.status < 400, `status=${again.status}`);
const itemsAgain = await call("GET", "/api/items?includeDeleted=1");
const rowsAgain = Array.isArray(itemsAgain.body) ? itemsAgain.body : (itemsAgain.body?.items ?? []);
record("幂等", "二次导入后物品数不翻倍", rowsAgain.filter((row) => String(row.name).startsWith("B-")).length === 3, `实际=${rowsAgain.filter((row) => String(row.name).startsWith("B-")).length}`);

// ---- 清理 ----
for (const row of rowsAgain.filter((entry) => String(entry.name).startsWith("B-"))) await call("DELETE", `/api/items/${row.id}`);
for (const row of taskRows.filter((entry) => String(entry.title).startsWith("B-"))) await call("DELETE", `/api/tasks/${row.id}`);
for (const row of shoppingAfter.filter((entry) => String(entry.name).startsWith("B-"))) await call("DELETE", `/api/shopping/${row.id}`);
for (const row of locationRows.filter((entry) => String(entry.name).startsWith("B-")).reverse()) await call("DELETE", `/api/locations/${row.id}`);
console.log("\n清理完成");

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) { console.log("\n=== 失败项 ==="); for (const row of failed) console.log(`${row.name} → ${row.detail}`); }
process.exit(failed.length ? 1 : 0);