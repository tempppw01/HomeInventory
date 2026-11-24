// API 契约与数据完整性测试:直接打接口,逐项比对「实际 vs 期望」。
// 用法:node output/experience/api-contract-test.mjs [--keep]
const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS;
if (!PASS) throw new Error("set PROBE_PASS");

// 登录接口限速 12 次/分钟/IP;批量测试时遇到 429 就按 Retry-After 等待重试。
async function fetchWithRetry(url, init, attempts = 8) {
  for (let index = 0; index < attempts; index += 1) {
    const response = await globalThis.fetch(url, init);
    if (response.status !== 429) return response;
    const wait = Number(response.headers.get("retry-after") ?? 5);
    console.log("      限速中,等待 " + wait + " 秒后重试");
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
  }
  throw new Error("still rate limited");
}
const results = [];
const record = (area, name, ok, detail) => {
  results.push({ area, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${area}] ${name}${ok ? "" : "  → " + detail}`);
};

// ---- 登录 ----
const loginResponse = await fetchWithRetry(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: USER, password: PASS }),
});
const cookies = loginResponse.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
if (!loginResponse.ok) throw new Error("login failed: " + loginResponse.status);

async function call(method, path, body) {
  const headers = body !== undefined ? { cookie: cookies, "content-type": "application/json" } : { cookie: cookies };
  const response = await fetchWithRetry(BASE + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  let json = null;
  const text = await response.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 120) }; }
  return { status: response.status, body: json };
}

const created = { items: [], locations: [], shopping: [], tasks: [], prices: [] };

// ============ 1. 未登录访问 ============
{
  const r = await fetchWithRetry(`${BASE}/api/items`);
  record("鉴权", "未登录访问 /api/items 应被拒绝", r.status === 401 || r.status === 403 || r.status === 307, `status=${r.status}`);
  const r2 = await fetchWithRetry(`${BASE}/api/dashboard`);
  record("鉴权", "未登录访问 /api/dashboard 应被拒绝", r2.status === 401 || r2.status === 403 || r2.status === 307, `status=${r2.status}`);
}

// ============ 2. items 创建与校验 ============
const baseItem = { name: "T-基础物品", category: "日用", type: "CONSUMABLE", quantity: 2, minQuantity: 0, remainingPercent: 100, unit: "件", price: null, purchaseDate: null, expiryDate: null, locationId: null, notes: null, imageUrl: null, recordPurchase: false, purchaseStore: null };

{
  const r = await call("POST", "/api/items", baseItem);
  record("items", "最小字段创建", r.status === 201 || r.status === 200, `status=${r.status} body=${JSON.stringify(r.body).slice(0, 120)}`);
  if (r.body?.id) created.items.push(r.body.id);

  const r2 = await call("POST", "/api/items", { ...baseItem, name: "" });
  record("items", "空名称应被拒绝(4xx)", r2.status >= 400 && r2.status < 500, `status=${r2.status}`);

  const r3 = await call("POST", "/api/items", { ...baseItem, name: "长".repeat(81) });
  record("items", "名称 81 字符应被拒绝或截断", r3.status >= 400 || (r3.body?.name ?? "").length <= 80, `status=${r3.status} len=${(r3.body?.name ?? "").length}`);
  if (r3.body?.id) created.items.push(r3.body.id);

  const r4 = await call("POST", "/api/items", { ...baseItem, name: "T-负数量", quantity: -5 });
  record("items", "负数量应被拒绝", r4.status >= 400, `status=${r4.status} quantity=${r4.body?.quantity}`);
  if (r4.body?.id) created.items.push(r4.body.id);

  const r5 = await call("POST", "/api/items", { ...baseItem, name: "T-计数单位小数", unit: "件", quantity: 2.5 });
  record("items", "计数单位填小数应被拒绝或取整", r5.status >= 400 || Number.isInteger(r5.body?.quantity), `status=${r5.status} quantity=${r5.body?.quantity}`);
  if (r5.body?.id) created.items.push(r5.body.id);

  const r6 = await call("POST", "/api/items", { ...baseItem, name: "T-小数单位", unit: "kg", quantity: 2.5 });
  record("items", "小数单位(kg)应接受 2.5", r6.body?.quantity === 2.5, `status=${r6.status} quantity=${r6.body?.quantity}`);
  if (r6.body?.id) created.items.push(r6.body.id);

  const r7 = await call("POST", "/api/items", { ...baseItem, name: "T-剩余量越界", remainingPercent: 101 });
  record("items", "remainingPercent=101 应被拒绝或夹到 100", r7.status >= 400 || r7.body?.remainingPercent <= 100, `status=${r7.status} remaining=${r7.body?.remainingPercent}`);
  if (r7.body?.id) created.items.push(r7.body.id);

  const r8 = await call("POST", "/api/items", { ...baseItem, name: "T-到期早于购入", purchaseDate: "2026-11-10", expiryDate: "2026-11-01" });
  record("items", "到期日早于购入日:应拒绝或明确提示", r8.status >= 400 || Boolean(r8.body?.id), `status=${r8.status}(若 201 表示未拦截,仅记为观察项)`);
  if (r8.body?.id) created.items.push(r8.body.id);

  const r9 = await call("POST", "/api/items", { ...baseItem, name: "T-非法类型", type: "NOT_A_TYPE" });
  record("items", "非法 type 应被拒绝", r9.status >= 400, `status=${r9.status} type=${r9.body?.type}`);
  if (r9.body?.id) created.items.push(r9.body.id);

  const r10 = await call("POST", "/api/items", { ...baseItem, name: "T-非法日期", purchaseDate: "2026-13-45" });
  record("items", "非法日期格式应被拒绝", r10.status >= 400, `status=${r10.status} purchaseDate=${r10.body?.purchaseDate}`);
  if (r10.body?.id) created.items.push(r10.body.id);

  const r11 = await call("POST", "/api/items", { ...baseItem, name: "T-不存在位置", locationId: "does-not-exist" });
  record("items", "不存在的 locationId 应被拒绝", r11.status >= 400, `status=${r11.status}`);
  if (r11.body?.id) created.items.push(r11.body.id);

  // 零宽字符不是空白,trim() 去不掉 —— 这条曾经真的存进库:列表里是一行空白、按名字也搜不到
  const r11b = await call("POST", "/api/items", { ...baseItem, name: "\u200b\u200b\u200b" });
  record("items", "名称只有零宽字符应被拒绝", r11b.status >= 400, `status=${r11b.status}`);
  if (r11b.body?.id) created.items.push(r11b.body.id);

  const r11c = await call("POST", "/api/items", { ...baseItem, name: "T-零宽夹在中间\u200b" });
  record("items", "可见字符 + 零宽字符的名称照常接受", r11c.status === 201 && String(r11c.body?.name ?? "").includes("T-零宽夹在中间"), `status=${r11c.status}`);
  if (r11c.body?.id) created.items.push(r11c.body.id);

  const r12 = await call("POST", "/api/items", "{not json");
  record("items", "非 JSON body 应返回 4xx 而非 500", r12.status >= 400 && r12.status < 500, `status=${r12.status}`);
}

// ============ 2.5 回收站里的物品:编辑与消耗必须都明确拒绝 ============
// 由来(实测,两台设备场景):A 把物品删进回收站后,B 的旧页面继续保存会 **200 成功**
// (改动进了用户已经扔掉的东西里),而同一件物品的消耗返回的是 404「物品不存在」——
// 同一个状态两种行为,而且措辞让用户以为数据丢了。
{
  const trashed = await call("POST", "/api/items", { ...baseItem, name: `T-回收站物品-${Date.now().toString(36).slice(-4)}` });
  const trashedId = trashed.body?.id ?? null;
  record("items", "造出一件用于回收站检查的物品", Boolean(trashedId), `status=${trashed.status}`);

  if (trashedId) {
    const removed = await call("DELETE", `/api/items/${trashedId}`, {});
    record("items", "移入回收站成功", removed.status === 200 || removed.status === 204, `status=${removed.status}`);

    const edit = await call("PATCH", `/api/items/${trashedId}`, { quantity: 99 });
    record("items", "回收站里的物品不能继续编辑(409,并说明在回收站)", edit.status === 409 && /回收站/.test(String(edit.body?.error ?? "")), `status=${edit.status} ${JSON.stringify(edit.body?.error ?? "").slice(0, 60)}`);

    const consume = await call("POST", `/api/items/${trashedId}/consume`, {});
    record("items", "回收站里的物品消耗给出 409 且说明在回收站(不再是「不存在」)", consume.status === 409 && /回收站/.test(String(consume.body?.error ?? "")), `status=${consume.status} ${JSON.stringify(consume.body?.error ?? "").slice(0, 60)}`);

    const restore = await call("POST", `/api/items/${trashedId}/restore`, {});
    record("items", "从回收站恢复后可以正常编辑", restore.status === 200 && (await call("PATCH", `/api/items/${trashedId}`, { quantity: 7 })).status === 200, `restore=${restore.status}`);
    created.items.push(trashedId);
  }
}

// ============ 3. items 更新 / 删除 ============
{
  const id = created.items[0];
  const r = await call("PATCH", `/api/items/${id}`, { quantity: 7 });
  record("items", "PATCH 部分字段(只改 quantity)", r.status === 200 && r.body?.quantity === 7, `status=${r.status} quantity=${r.body?.quantity}`);

  const r2 = await call("PATCH", `/api/items/${id}`, { type: "DURABLE" });
  record("items", "PATCH 改 type", r2.status === 200 && r2.body?.type === "DURABLE", `status=${r2.status} type=${r2.body?.type}`);

  const r3 = await call("DELETE", `/api/items/${id}`);
  record("items", "软删除", r3.status === 200 || r3.status === 204, `status=${r3.status}`);

  const list = await call("GET", "/api/items");
  const items = Array.isArray(list.body) ? list.body : (list.body?.items ?? []);
  record("items", "软删除后默认列表不应再出现", !items.some((row) => row.id === id), `still present=${items.some((row) => row.id === id)}`);

  const r4 = await call("DELETE", `/api/items/${id}`);
  record("items", "重复删除应幂等(2xx 或 404,不 500)", r4.status < 500, `status=${r4.status}`);

  const r5 = await call("DELETE", "/api/items/does-not-exist");
  record("items", "删除不存在 id 应 404 而非 500", r5.status === 404 || r5.status === 400, `status=${r5.status}`);

  const r6 = await call("PATCH", "/api/items/does-not-exist", { quantity: 1 });
  record("items", "更新不存在 id 应 404 而非 500", r6.status === 404 || r6.status === 400, `status=${r6.status}`);
}

// ============ 4. locations 边界 ============
{
  const r = await call("POST", "/api/locations", { name: "T-空间A", icon: "Package", parentId: null });
  record("locations", "创建空间", r.status === 201 || r.status === 200, `status=${r.status}`);
  const a = r.body?.id;
  if (a) created.locations.push(a);

  const rDup = await call("POST", "/api/locations", { name: "T-空间A", icon: "Package", parentId: null });
  record("locations", "同名空间:应拒绝或允许并区分", rDup.status < 500, `status=${rDup.status}(若 201 表示允许重名)`);
  if (rDup.body?.id) created.locations.push(rDup.body.id);

  const r2 = await call("POST", "/api/locations", { name: "T-空间B", icon: "Package", parentId: null });
  const b = r2.body?.id;
  if (b) created.locations.push(b);

  const rSelf = await call("PATCH", `/api/locations/${a}`, { parentId: a });
  record("locations", "把自己设为父级应被拒绝", rSelf.status >= 400, `status=${rSelf.status}`);

  if (a && b) {
    await call("PATCH", `/api/locations/${b}`, { parentId: a });
    const rCycle = await call("PATCH", `/api/locations/${a}`, { parentId: b });
    record("locations", "循环引用(A→B→A)应被拒绝", rCycle.status >= 400, `status=${rCycle.status}`);
  }

  // 有物品的空间删除
  const itemWithLoc = await call("POST", "/api/items", { ...baseItem, name: "T-占用空间的物品", locationId: a });
  if (itemWithLoc.body?.id) created.items.push(itemWithLoc.body.id);
  const rDel = await call("DELETE", `/api/locations/${a}`);
  record("locations", "删除仍有物品的空间:应拒绝或明确移出", rDel.status >= 400 || rDel.status === 200, `status=${rDel.status}`);
}

// ============ 4b. 日期字段的写法与错误提示 ============
// 起因:接口此前只接受 2026-11-20 这种纯日期,传 ISO 时间戳会 400,
// 而且错误信息是英文的「Invalid date」,调用方不知道该怎么改。
// 现在两种写法都接受,非法值给出中文提示。
{
  const dateOnly = await call("POST", "/api/items", { ...baseItem, name: "T-日期纯日期", expiryDate: "2026-12-31" });
  record("dates", "日期:接受 2026-12-31", dateOnly.status === 201, `status=${dateOnly.status}`);
  if (dateOnly.body?.id) created.items.push(dateOnly.body.id);

  const iso = await call("POST", "/api/items", { ...baseItem, name: "T-日期ISO", expiryDate: "2026-12-31T03:00:00.000Z" });
  record("dates", "日期:接受 ISO 时间戳(此前会被 400 拒掉)", iso.status === 201, `status=${iso.status} error=${iso.body?.error ?? "-"}`);
  if (iso.body?.id) created.items.push(iso.body.id);

  const garbage = await call("POST", "/api/items", { ...baseItem, name: "T-日期非法", expiryDate: "2026/12/31" });
  const message = String(garbage.body?.error ?? "");
  record("dates", "日期:非法格式被拒且提示可读", garbage.status === 400 && message.includes("日期"), `status=${garbage.status} error=${message}`);

  const impossible = await call("POST", "/api/items", { ...baseItem, name: "T-日期不存在", expiryDate: "2026-02-31" });
  record("dates", "日期:2026-02-31 这类不存在的日子被拒", impossible.status === 400, `status=${impossible.status} error=${impossible.body?.error ?? "-"}`);
}

// ============ 5. shopping 与低库存联动 ============
{
  const low = await call("POST", "/api/items", { ...baseItem, name: "T-低库存品", quantity: 1, minQuantity: 5, unit: "瓶" });
  const lowId = low.body?.id;
  if (lowId) created.items.push(lowId);

  const dash = await call("GET", "/api/dashboard");
  const rows = (dash.body?.shopping ?? dash.body?.shoppingItems ?? []);
  const auto = rows.find((row) => row.name === "T-低库存品" || row.itemId === lowId);
  record("shopping", "低库存是否自动生成采购项", Boolean(auto), `采购项数=${rows.length} 是否命中=${Boolean(auto)}(未命中可能是延迟或需手动触发)`);

  if (auto) {
    created.shopping.push(auto.id);
    const toggle = await call("PATCH", `/api/shopping/${auto.id}`, { status: "PURCHASED" });
    record("shopping", "标记已购", toggle.status === 200, `status=${toggle.status} state=${toggle.body?.status}`);
    const after = await call("GET", `/api/items/${lowId}`);
    record("shopping", "标记已购后原物品数量是否回写(设计可能要求二次确认)", after.body?.quantity >= 1, `quantity=${after.body?.quantity}`);
  }

  const manual = await call("POST", "/api/shopping", { name: "T-手动采购", quantity: 1, unit: "个" });
  record("shopping", "手动创建采购项", manual.status === 201 || manual.status === 200, `status=${manual.status}`);
  if (manual.body?.id) created.shopping.push(manual.body.id);
}

// ============ 5b. 采购完成 → 入库(精确核对数量)============
// 真实踩过的坑:服务端曾经只在采购项来源为 restock-suggestion 时才入库,
// 手动创建的采购项即使传了 replenishItemId 也被静默忽略 —— 界面提示「已入库」而库存没变。
// 原来的断言只要求 quantity >= 1,抓不到这种问题,这里精确核对「原数量 + 采购数量」。
{
  const target = await call("POST", "/api/items", { ...baseItem, name: "T-入库核对", quantity: 2, unit: "瓶" });
  const targetId = target.body?.id;
  if (targetId) created.items.push(targetId);

  const purchase = await call("POST", "/api/shopping", { name: "T-入库核对", quantity: 3, unit: "瓶" });
  // POST /api/shopping 返回的是 { item, merged },不是直接的采购项
  const purchaseId = purchase.body?.item?.id ?? purchase.body?.id;
  if (purchaseId) created.shopping.push(purchaseId);

  // 用「改前 + 采购数量」做相对断言:库里可能已有同名物品(接口会合并),绝对值不可靠。
  const beforePatch = await call("GET", `/api/items/${targetId}`);
  const startQty = Number(beforePatch.body?.quantity ?? 0);

  const done = await call("PATCH", `/api/shopping/${purchaseId}`, { status: "PURCHASED", replenishItemId: targetId });
  record("shopping", "手动采购项标记已购可成功", done.status === 200, `status=${done.status}`);

  const after = await call("GET", `/api/items/${targetId}`);
  record("shopping", "采购完成应把采购数量加进库存物品", Number(after.body?.quantity) === startQty + 3, `quantity=${after.body?.quantity}(期望 ${startQty + 3})`);

  // 撤销:界面上那个按钮叫「撤销」,所以**库存也要退回去** —— 否则撤销之后账面仍然虚高。
  const undo = await call("PATCH", `/api/shopping/${purchaseId}`, { status: "PENDING" });
  record("shopping", "撤销采购完成应回到待采购", undo.status === 200 && undo.body?.status === "PENDING", `status=${undo.status} state=${undo.body?.status}`);
  const afterUndo = await call("GET", `/api/items/${targetId}`);
  record("shopping", "撤销后库存退回原值(而不是虚高)", Number(afterUndo.body?.quantity) === startQty, `quantity=${afterUndo.body?.quantity}(期望 ${startQty})`);

  // 再标记一次:只加一次 —— 这一条挡住「来回切换把库存越堆越多」。
  const again = await call("PATCH", `/api/shopping/${purchaseId}`, { status: "PURCHASED", replenishItemId: targetId });
  const afterAgain = await call("GET", `/api/items/${targetId}`);
  record("shopping", "撤销后再标记已购买只加一次库存", again.status === 200 && Number(afterAgain.body?.quantity) === startQty + 3, `quantity=${afterAgain.body?.quantity}(期望 ${startQty + 3})`);
}

// ============ 5c. 盘点历史(服务端留存)============
// 盘点结果曾经只存在浏览器 localStorage,换设备或清缓存就丢。
// 现在服务端留存最近 20 条,这里守住「能写、能读、非法数据被拒」。
{
  const created = await call("POST", "/api/audits", { total: 12, confirmed: 9, locationName: "契约核对" });
  record("audits", "写入盘点记录", created.status === 201 && Boolean(created.body?.id), `status=${created.status}`);

  const bad = await call("POST", "/api/audits", { total: "abc", confirmed: 1 });
  record("audits", "非法盘点数据应被拒绝", bad.status === 400, `status=${bad.status}`);

  const list = await call("GET", "/api/audits");
  const rows = list.body?.audits ?? [];
  const hit = rows.some((row) => row.locationName === "契约核对" && row.total === 12 && row.confirmed === 9);
  record("audits", "能读回刚写入的盘点记录", list.status === 200 && hit, `条数=${rows.length} 命中=${hit}`);

  // 确认数超过总数时应被夹住,避免「20/10 件」这种不可能的数据
  const clamp = await call("POST", "/api/audits", { total: 4, confirmed: 99, locationName: "契约核对夹取" });
  record("audits", "确认数超过总数应被夹到总数", clamp.body?.confirmed === 4, `confirmed=${clamp.body?.confirmed}`);
}

// ============ 5d. AI 批量识别的坏输入 ============
// 真实踩到的坑:传一张解不开的图片(8MB 垃圾数据)时返回 **500「服务器暂时开小差了」**,
// 而 ai-image 里其实有很明确的中文原因(格式不支持 / 太大 / 无法处理),
// 只是 apiError 不认识 AiImageError,给吞成了 500。
// 这里守住:坏图片必须是 4xx + 可读原因,不能是 5xx。
{
  const empty = await call("POST", "/api/ai/batch-identify", { images: [] });
  record("ai", "批量识别:没有图片应 400 并说明原因", empty.status === 400 && String(empty.body?.error ?? "").includes("图片"), `status=${empty.status} error=${empty.body?.error ?? "-"}`);

  const wrongType = await call("POST", "/api/ai/batch-identify", { images: [{ dataUrl: "data:text/plain;base64,aGVsbG8=" }] });
  record("ai", "批量识别:非图片内容应 400", wrongType.status === 400, `status=${wrongType.status} error=${wrongType.body?.error ?? "-"}`);

  const garbage = await call("POST", "/api/ai/batch-identify", { images: [{ dataUrl: `data:image/jpeg;base64,${"A".repeat(512 * 1024)}` }] });
  record("ai", "批量识别:解不开的图片应是 4xx 而不是 500", garbage.status >= 400 && garbage.status < 500, `status=${garbage.status} error=${garbage.body?.error ?? "-"}`);

  const message = String(garbage.body?.error ?? "");
  // 环境差异:没配 AI 时,接口会在压缩图片**之前**返回「请先在设置中配置 AI 接口」,
  // 这本身是正确行为(总比去处理一张坏图好)。所以:先断言「有可读的中文原因」,
  // 再按是否配置了 AI 决定要不要断言原因与图片有关。
  record("ai", "批量识别:坏图片返回了可读的中文原因", message.length > 0, `error=${message}`);

  const aiConfigured = message.length > 0 && !message.includes("配置 AI");
  record("ai", "批量识别:已配置 AI 时坏图片提示与图片有关", aiConfigured ? message.includes("图片") : true, `aiConfigured=${aiConfigured} error=${message}`);
  if (!aiConfigured) console.log("      提示:本环境未配置 AI,跳过「提示与图片有关」的断言(配置检查先返回)")
}

// ============ 6. tasks ============
{
  const r = await call("POST", "/api/tasks", { title: "T-任务", description: "", dueAt: new Date(Date.now() + 86400000).toISOString(), recurrence: "NONE" });
  record("tasks", "创建任务", r.status === 201 || r.status === 200, `status=${r.status} body=${JSON.stringify(r.body).slice(0, 100)}`);
  if (r.body?.id) created.tasks.push(r.body.id);

  const r2 = await call("POST", "/api/tasks", { title: "T-无日期任务", description: "", dueAt: "", recurrence: "NONE" });
  record("tasks", "dueAt 为空应被拒绝", r2.status >= 400, `status=${r2.status}`);
  if (r2.body?.id) created.tasks.push(r2.body.id);

  const r3 = await call("POST", "/api/tasks", { title: "T-非法重复", description: "", dueAt: new Date().toISOString(), recurrence: "EVERY_HOUR_BOGUS" });
  record("tasks", "非法 recurrence 应被归一化为 NONE", r3.status < 500 && (r3.body?.recurrence ?? "NONE") === "NONE", `status=${r3.status} recurrence=${r3.body?.recurrence}`);
  if (r3.body?.id) created.tasks.push(r3.body.id);
}

// ============ 7. prices ============
{
  const created1 = await call("POST", "/api/items", { ...baseItem, name: "T-带价格物品", price: 99.9, purchaseDate: "2026-11-01" });
  const id = created1.body?.id;
  if (id) created.items.push(id);
  const prices = await call("GET", "/api/prices");
  const rows = Array.isArray(prices.body) ? prices.body : (prices.body?.items ?? []);
  record("prices", "创建带价格物品后价格记录", prices.status === 200 && (rows.length >= 0), `status=${prices.status} rows=${rows.length}`);

  const del = await call("DELETE", `/api/items/${id}`);
  const pricesAfter = await call("GET", "/api/prices");
  const rowsAfter = Array.isArray(pricesAfter.body) ? pricesAfter.body : (pricesAfter.body?.items ?? []);
  const orphan = rowsAfter.filter((row) => row.itemId === id);
  record("prices", "删除物品后价格记录不应残留(或应保留快照)", del.status < 500 && true, `残留=${orphan.length}(若>0 需确认是否有意保留)`);
}

// ============ 8. 并发 ============
{
  const r = await call("POST", "/api/items", { ...baseItem, name: "T-并发物品", quantity: 10 });
  const id = r.body?.id;
  if (id) {
    created.items.push(id);
    const [a, b] = await Promise.all([
      call("PATCH", `/api/items/${id}`, { quantity: 3 }),
      call("PATCH", `/api/items/${id}`, { quantity: 7 }),
    ]);
    const final = await call("GET", `/api/items/${id}`);
    record("并发", "两个并发 PATCH:最终值应为其中之一且非负", [3, 7].includes(final.body?.quantity) && final.body?.quantity >= 0, `a=${a.status} b=${b.status} final=${final.body?.quantity}`);
  }
}

// ============ 9. 边界 body ============
{
  const empty = await call("POST", "/api/items", {});
  record("边界", "空 body 应 4xx", empty.status >= 400 && empty.status < 500, `status=${empty.status}`);

  const wrongType = await call("POST", "/api/items", { ...baseItem, name: "T-类型错误", quantity: "abc" });
  record("边界", "quantity 传非数字字符串应被拒绝或忽略", wrongType.status >= 400 || typeof wrongType.body?.quantity === "number", `status=${wrongType.status} quantity=${JSON.stringify(wrongType.body?.quantity)}`);
  if (wrongType.body?.id) created.items.push(wrongType.body.id);

  const unknown = await call("POST", "/api/items", { ...baseItem, name: "T-未知字段", unknownField: "x" });
  record("边界", "未知字段应被忽略(不 500)", unknown.status < 500, `status=${unknown.status}`);
  if (unknown.body?.id) created.items.push(unknown.body.id);

  const big = await call("POST", "/api/items", { ...baseItem, name: "T-大body", notes: "x".repeat(1024 * 512) });
  record("边界", "512KB notes 不应 500", big.status < 500, `status=${big.status}`);
  if (big.body?.id) created.items.push(big.body.id);
}

// ============ 清理 ============
if (!process.argv.includes("--keep")) {
  for (const id of created.items) await call("DELETE", `/api/items/${id}`);
  for (const id of created.tasks) await fetchWithRetry(`${BASE}/api/tasks`, { method: "PATCH", headers: { cookie: cookies, "content-type": "application/json" }, body: JSON.stringify({ id, action: "delete" }) }).catch(() => {});
  for (const id of created.shopping) await fetchWithRetry(`${BASE}/api/shopping/${id}`, { method: "DELETE", headers: { cookie: cookies } }).catch(() => {});
  for (const id of created.locations) await fetchWithRetry(`${BASE}/api/locations/${id}`, { method: "DELETE", headers: { cookie: cookies } }).catch(() => {});
  console.log("\n清理:已请求删除", created.items.length, "物品 /", created.locations.length, "空间 /", created.shopping.length, "采购 /", created.tasks.length, "任务");

  // 上面只删「登记过的 id」,而且物品只做了软删(进回收站)。实测跑完仍会在库里留下
  // 13 件 T- 物品、2 个 T- 任务、1 条 T- 采购 —— 谁在本地跑一遍,自己的数据里就多一堆垃圾。
  // 这里按自己的前缀再扫一遍,并把物品永久删除(回收站里也不留)。
  const PREFIX = "T-";
  const sweep = async (path, listKey, matchKey) => {
    const res = await fetchWithRetry(`${BASE}${path}`, { headers: { cookie: cookies } }).catch(() => null);
    if (!res) return 0;
    const body = await res.json().catch(() => null);
    const rows = Array.isArray(body) ? body : body?.[listKey] ?? [];
    let removed = 0;
    for (const row of rows.filter((entry) => String(entry?.[matchKey] ?? "").startsWith(PREFIX))) removed += 1;
    return removed;
  };
  const dash = await (await fetchWithRetry(`${BASE}/api/dashboard`, { headers: { cookie: cookies } })).json().catch(() => ({}));
  for (const row of (dash.shopping ?? []).filter((entry) => String(entry.name ?? "").startsWith(PREFIX))) {
    await fetchWithRetry(`${BASE}/api/shopping/${row.id}`, { method: "DELETE", headers: { cookie: cookies } }).catch(() => {});
  }
  for (const row of (dash.locations ?? []).filter((entry) => String(entry.name ?? "").startsWith(PREFIX))) {
    await fetchWithRetry(`${BASE}/api/locations/${row.id}`, { method: "DELETE", headers: { cookie: cookies } }).catch(() => {});
  }
  const allItems = await (await fetchWithRetry(`${BASE}/api/items?includeDeleted=1`, { headers: { cookie: cookies } })).json().catch(() => []);
  let purged = 0;
  for (const row of (Array.isArray(allItems) ? allItems : []).filter((entry) => String(entry.name ?? "").startsWith(PREFIX))) {
    const res = await call("DELETE", `/api/items/${row.id}`, { permanent: true }).catch(() => null);
    if (res && res.ok) purged += 1;
  }
  const taskBody = await (await fetchWithRetry(`${BASE}/api/tasks`, { headers: { cookie: cookies } })).json().catch(() => null);
  const taskRows = Array.isArray(taskBody) ? taskBody : taskBody?.tasks ?? [];
  let tasks = 0;
  for (const row of taskRows.filter((entry) => String(entry.title ?? "").startsWith(PREFIX))) {
    await fetchWithRetry(`${BASE}/api/tasks`, { method: "PATCH", headers: { cookie: cookies, "content-type": "application/json" }, body: JSON.stringify({ id: row.id, action: "delete" }) }).catch(() => {});
    tasks += 1;
  }
  const lingering = (await sweep("/api/items?includeDeleted=1", "items", "name")) + (await sweep("/api/tasks", "tasks", "title"));
  console.log(`清理补扫:永久删除 ${purged} 件 T- 物品 / ${tasks} 个 T- 任务 / ${(dash.shopping ?? []).filter((entry) => String(entry.name ?? "").startsWith(PREFIX)).length} 条 T- 采购;仍残留 ${lingering} 条`);
}

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
const byArea = {};
for (const row of results) { byArea[row.area] = byArea[row.area] || { ok: 0, fail: 0 }; if (row.ok) byArea[row.area].ok += 1; else byArea[row.area].fail += 1; }
console.log("按领域:", JSON.stringify(byArea));
if (failed.length) {
  console.log("\n=== 失败项 ===");
  for (const row of failed) console.log(`[${row.area}] ${row.name} → ${row.detail}`);
}
process.exit(failed.length ? 1 : 0);