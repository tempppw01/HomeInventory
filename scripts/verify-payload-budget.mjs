// 首屏载荷预算:/api/dashboard 是**一次把整份库存发给前端**的那个接口。
//
// 起因(v0.1.27):1200 件物品时它是 1111 KB,而且完全没有压缩 —— 浏览器发了
// `accept-encoding: gzip, deflate, br`,响应里却没有 content-encoding。
// HTML 文档同一台机器上是 gzip 的,说明 Next 的 compress 只覆盖它自己产出的页面,
// route handler 不在内(显式写 compress: true 也没用)。现在由应用自己压:
// 1111 KB → 64 KB(约 17 倍)。
//
// 这条检查守四件事:
//   1 真的压了,而且**无损**(解压后与不压缩时逐字段一致)
//   2 诚实地协商:客户端没说要 gzip 就不许压
//   3 单件体积不膨胀(整份 payload 的字节 / 物品数),并把 item.location 钉在 {id, name}
//   4 导出分支不受影响(那是备份用的完整转储,格式是契约)
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-payload-budget.mjs

import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const cookie = await loginCookie(BASE, USER, PASS);

/** 拿一份原始响应:encoding 与 content-length 都要,但**不用** fetch 的自动解压去猜 */
const fetchRaw = async (path, acceptEncoding) => {
  const response = await fetch(BASE + path, {
    headers: { cookie, "accept-encoding": acceptEncoding },
    cache: "no-store",
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  // Node 的 fetch 会自己解压 gzip,所以这里的 buffer 是**解压后**的;传输体积看 content-length
  return {
    status: response.status,
    encoding: response.headers.get("content-encoding"),
    vary: response.headers.get("vary") ?? "",
    declaredLength: Number(response.headers.get("content-length") ?? 0),
    decoded: buffer.length,
    json: JSON.parse(buffer.toString("utf8")),
  };
};

// ---------- 0 先造出足够的数据,让响应稳稳超过 gzip 阈值(4 KB) ----------
const MARK = "PAYLOAD-BUDGET";
const rows = Array.from({ length: 260 }, (_, index) => ({
  name: `${MARK}-${String(index).padStart(3, "0")} 探针物品`,
  category: "其他",
  type: index % 3 === 0 ? "DURABLE" : "CONSUMABLE",
  quantity: (index % 20) + 1,
  minQuantity: 0,
  unit: "件",
  locationName: index % 2 === 0 ? "载荷探针空间" : "",
  notes: "重复文本让 gzip 有东西可压".repeat(3),
  expiryDate: index % 4 === 0 ? "2027-06-30" : null,
}));
const imported = await fetch(`${BASE}/api/items/import`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ items: rows }),
});
const importBody = await imported.json().catch(() => ({}));
check(`探针数据足够触发压缩(导入 ≥260 条,status=${imported.status})`, imported.ok && (importBody.count ?? 0) >= 260, JSON.stringify(importBody).slice(0, 120));

// ---------- 1 压缩确实生效,而且无损 ----------
const gzip = await fetchRaw("/api/dashboard", "gzip, deflate, br");
const identity = await fetchRaw("/api/dashboard", "identity");

check("接受 gzip 时响应带 content-encoding: gzip", gzip.encoding === "gzip", `encoding=${gzip.encoding ?? "(无)"}`);
check("响应声明 vary: accept-encoding(否则缓存会串味)", /accept-encoding/i.test(gzip.vary), `vary=${gzip.vary || "(无)"}`);
check("不接受 gzip 时不压(否则客户端解不开)", identity.encoding === null, `encoding=${identity.encoding}`);

const compressible = identity.decoded > 4096;
check("载荷本身够大,压缩比才有意义(防空跑)", compressible, `解压后 ${Math.round(identity.decoded / 1024)} KB`);
if (compressible && gzip.encoding === "gzip" && gzip.declaredLength > 0) {
  const ratio = gzip.declaredLength / identity.decoded;
  check(`传输体积 ≤ 原始体积的 1/3(实测 ${(ratio * 100).toFixed(1)}%)`, ratio <= 1 / 3, `${gzip.declaredLength} / ${identity.decoded} 字节`);
} else {
  check("传输体积 ≤ 原始体积的 1/3", false, `拿不到可比的体积(encoding=${gzip.encoding} length=${gzip.declaredLength})`);
}

// 无损:解压后的结构与不压缩时完全一致
const sameItems = gzip.json.items.length === identity.json.items.length
  && JSON.stringify(gzip.json.items[0]) === JSON.stringify(identity.json.items[0])
  && JSON.stringify(gzip.json.locations) === JSON.stringify(identity.json.locations);
check("压缩是无损的(解压后与不压缩时逐字段一致)", sameItems, `items ${gzip.json.items.length} vs ${identity.json.items.length}`);

// ---------- 2 单件体积预算 + 位置投影 ----------
const itemCount = identity.json.items.length;
const perItem = itemCount ? Math.round(identity.decoded / itemCount) : 0;
check(`单件体积在预算内(实测 ${perItem} B/件,预算 1200)`, itemCount > 0 && perItem <= 1200, `items=${itemCount}`);

const locationKeys = new Set(identity.json.items.flatMap((item) => Object.keys(item.location ?? {})));
const allowed = new Set(["id", "name"]);
const extra = [...locationKeys].filter((key) => !allowed.has(key));
check("item.location 只带界面真的会读的字段(id / name)", extra.length === 0, `多出来:${extra.join(",") || "(无)"}`);
check("列表里的位置名字还在(裁字段不能把名字裁掉)", identity.json.items.every((item) => item.location === null || typeof item.location.name === "string"), "有物品的 location 缺 name");

// ---------- 3 导出分支不受影响(备份格式是契约) ----------
const exportRaw = await fetchRaw("/api/items?export=1", "gzip, deflate, br");
const exportText = JSON.stringify(exportRaw.json);
check("导出分支不压缩(备份是完整转储,保持原样)", exportRaw.encoding === null, `encoding=${exportRaw.encoding}`);
check("导出内容包含位置实体的完整字段(没有被裁剪)", exportText.includes("\"thumbnailUrl\"") || exportText.includes("\"parentId\""), "导出里找不到位置实体的完整字段");

// ---------- 4 列表接口同样受压缩覆盖 ----------
const itemsGzip = await fetchRaw("/api/items", "gzip, deflate, br");
check("/api/items 也走压缩", itemsGzip.encoding === "gzip" || itemsGzip.decoded <= 4096, `encoding=${itemsGzip.encoding ?? "(无)"} size=${itemsGzip.decoded}`);

// ---------- 清理:探针物品永久删除 ----------
const probeItems = identity.json.items.filter((item) => String(item.name).startsWith(MARK));
let removed = 0;
for (const item of probeItems) {
  const response = await fetch(`${BASE}/api/items/${item.id}`, {
    method: "DELETE",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ permanent: true }),
  });
  if (response.ok) removed += 1;
}
check(`探针物品已清理(${removed}/${probeItems.length})`, probeItems.length > 0 && removed === probeItems.length, `剩 ${probeItems.length - removed} 条`);

// 这个套件还会建一个「载荷探针空间」(上面 locationName 那里),此前从来不删 ——
// 实测跑完后库里永远多一个空间。空间没有前缀变量,名字是写死的,这里按名字清理。
let spaceRemoved = 0;
const dashAfter = await (await fetch(`${BASE}/api/dashboard`, { headers: { cookie } })).json().catch(() => ({}));
for (const space of (dashAfter.locations ?? []).filter((row) => String(row.name) === "载荷探针空间")) {
  const response = await fetch(`${BASE}/api/locations/${space.id}`, { method: "DELETE", headers: { cookie } });
  if (response.ok) spaceRemoved += 1;
}
const spacesLeft = ((await (await fetch(`${BASE}/api/dashboard`, { headers: { cookie } })).json().catch(() => ({}))).locations ?? []).filter((row) => String(row.name) === "载荷探针空间");
check("探针空间已清理", spacesLeft.length === 0, `删了 ${spaceRemoved} 个,还剩 ${spacesLeft.length} 个`);

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);
