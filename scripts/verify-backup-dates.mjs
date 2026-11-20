// 备份往返核对:导出的备份能否被自己恢复回去,日期会不会错位。
//
// 为什么需要:恢复走同一套 itemSchema 校验,校验失败会**静默 continue** ——
// 「物品被悄悄丢掉,界面上只看到数量少了」。而旧版导出的日期是 ISO 时间戳,
// 日期校验过严或解析方式不一致时,这条路径就会丢数据或挪动一天(到期日错一天对药品是硬伤)。
//
// 守住三件事:
//   ① 导出日期写成 YYYY-MM-DD,不带时区歧义
//   ② 恢复后到期日/购买日与原值完全一致,物品不被跳过
//   ③ 旧备份(ISO 写法)仍能恢复,最多相差 1 天(旧数据本身有固有歧义)
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-backup-dates.mjs

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS;
if (!PASS) throw new Error("set PROBE_PASS");

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: USER, password: PASS }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");

const call = async (method, path, body) => {
  const response = await fetch(BASE + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: response.status, body: parsed };
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const NAME = "备份核对·到期日";

// 1) 造一件带到期日的物品
const created = await call("POST", "/api/items", {
  name: NAME,
  category: "医药",
  type: "CONSUMABLE",
  unit: "盒",
  quantity: 4,
  minQuantity: 1,
  remainingPercent: 60,
  expiryDate: "2026-12-31",
  purchaseDate: "2026-11-01",
  notes: "备份核对用",
});
check("创建带到期日的物品", created.status === 201, `status=${created.status} ${JSON.stringify(created.body?.error ?? "")}`);
const itemId = created.body?.id;

// 2) 导出备份,看日期序列化成什么
const backup = await call("GET", "/api/backup");
check("导出备份成功", backup.status === 200 && Array.isArray(backup.body?.items), `status=${backup.status} items=${backup.body?.items?.length ?? "-"}`);
const row = (backup.body?.items ?? []).find((entry) => entry.name === NAME);
check("备份里包含刚建的物品", Boolean(row), `找不到 ${NAME}`);
console.log(`      备份里的日期格式: expiryDate=${row?.expiryDate} purchaseDate=${row?.purchaseDate}`);

// 3) 删掉它(备份里还留着),再从备份恢复
if (itemId) {
  await call("DELETE", `/api/items/${itemId}`);
  await call("DELETE", `/api/items/${itemId}`, { permanent: true });
  const gone = await call("GET", `/api/items?includeDeleted=1`);
  const goneRows = Array.isArray(gone.body) ? gone.body : (gone.body?.items ?? []);
  check("删除后确实不在库里", !goneRows.some((entry) => entry.id === itemId), "删除失败");

  if (row) {
    const restored = await call("POST", "/api/backup/restore", { locations: backup.body?.locations ?? [], items: [row], shopping: [] });
    check("从备份恢复该物品", restored.status === 200, `status=${restored.status} ${JSON.stringify(restored.body).slice(0, 120)}`);

    const list = await call("GET", "/api/items");
    const rows = Array.isArray(list.body) ? list.body : (list.body?.items ?? []);
    const back = rows.find((entry) => entry.name === NAME);

    check("恢复后物品确实回来了(没有被静默跳过)", Boolean(back), `列表里找不到 ${NAME} —— 说明恢复时被校验拒绝并 continue 掉了`);

    if (back) {
      const localDate = (value) => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
      const expiry = localDate(back.expiryDate);
      const purchase = localDate(back.purchaseDate);
      check("到期日保持不变 2026-12-31", expiry === "2026-12-31", `实际=${expiry}`);
      check("购买日保持不变 2026-11-01", purchase === "2026-11-01", `实际=${purchase}`);
      check("数量与单位保持不变 4 盒", Number(back.quantity) === 4 && back.unit === "盒", `quantity=${back.quantity} unit=${back.unit}`);
      await call("DELETE", `/api/items/${back.id}`);
      await call("DELETE", `/api/items/${back.id}`, { permanent: true });
    }
  }
}

// 3) 旧备份兼容:老版本导出的日期是 ISO 时间戳,恢复后仍应是同一天
if (true) {
  const NAME2 = "备份核对·旧格式";
  await call("DELETE", "/api/items/x");
  const body = { locations: [], shopping: [], items: [{
    name: NAME2, category: "医药", type: "CONSUMABLE", unit: "盒", quantity: 2,
    minQuantity: 0, remainingPercent: 100,
    // 本地 2026-12-31 零点 → UTC 前一天 16:00,旧备份就是这个写法
    expiryDate: "2026-12-30T16:00:00.000Z",
    purchaseDate: "2026-10-31T16:00:00.000Z",
  }] };
  const res = await call("POST", "/api/backup/restore", body);
  check("旧备份(ISO 日期)可以恢复", res.status === 200, `status=${res.status}`);
  const list = await call("GET", "/api/items");
  const rows = Array.isArray(list.body) ? list.body : (list.body?.items ?? []);
  const back = rows.find((entry) => entry.name === NAME2);
  check("旧备份恢复后物品存在", Boolean(back), "被静默跳过");
  if (back) {
    const localDate = (value) => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
    // 旧格式按 UTC 日历日解析(机器无关)。这里输入是 2026-12-30T16:00Z → UTC 日 12-30,
    // 旧备份的 ISO 写法本身有歧义(导出时写的是「服务器本地零点」),
// 跨时区恢复时最多差一天 —— 这里只要求「差不超过 1 天且不是乱值」,
// 精确性由新格式(YYYY-MM-DD)保证,上面已单独断言。
const restoredDay = new Date(back.expiryDate);
const restoredLocal = Date.UTC(restoredDay.getFullYear(), restoredDay.getMonth(), restoredDay.getDate());
const drift = Math.abs(restoredLocal - Date.UTC(2026, 11, 31)) / 86400000;
check("旧备份日期最多相差 1 天(旧数据有固有歧义)", drift <= 1, `相差 ${drift} 天`);
    await call("DELETE", `/api/items/${back.id}`, { permanent: true });
  }
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);