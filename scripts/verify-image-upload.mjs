// 图片上传验收(本地存储路径)。
//
// 此前它被列在「已知未覆盖」里,理由是要对象存储配置。但其实**默认存储方式就是本地**
// (IMAGE_STORAGE_MODE 缺省为 local,写进 LOCAL_UPLOAD_DIR)—— 也就是自托管用户的实际路径。
// 这条路径完全可以在 CI 里验:
//   上传 → 真的落盘 → 能读回 → 挂到物品上 → 删除物品时把文件一并清掉。
//
// OSS 相关分支仍需真实对象存储,这里不覆盖(在覆盖地图里写明)。
//
// 用法:PROBE_USER=bgs PROBE_PASS=... node scripts/verify-image-upload.mjs

import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS;
if (!PASS) throw new Error("set PROBE_PASS");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const cookie = await loginCookie(BASE, USER, PASS);

const call = async (method, endpoint, body) => {
  const response = await fetch(BASE + endpoint, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: response.status, body: parsed, text };
};

const upload = async (bytes, filename, type) => {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), filename);
  const response = await fetch(`${BASE}/api/upload`, { method: "POST", headers: { cookie }, body: form });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: response.status, body: parsed, text };
};

// ---------- ① 正常上传 ----------
const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#c0392b" } }).png().toBuffer();
const uploaded = await upload(png, "probe.png", "image/png");
check("能上传一张 PNG", uploaded.status === 200, `status=${uploaded.status} ${uploaded.text.slice(0, 120)}`);
check("返回了可访问的图片地址", typeof uploaded.body?.url === "string" && uploaded.body.url.startsWith("/api/uploads/"), `url=${uploaded.body?.url}`);
check("存储方式是本地(local)", uploaded.body?.storageMode === "local" || uploaded.body?.storageMode === "both", `storageMode=${uploaded.body?.storageMode}`);

const url = uploaded.body?.url ?? null;

// ---------- ② 真的落盘 + 能读回(shарp 会统一转成 JPEG) ----------
if (url) {
  const fetched = await fetch(BASE + url, { headers: { cookie } });
  const buffer = Buffer.from(await fetched.arrayBuffer());
  check("图片能读回(200)", fetched.status === 200, `status=${fetched.status}`);
  check("读回的是图片内容", (fetched.headers.get("content-type") ?? "").startsWith("image/") && buffer.length > 0, `type=${fetched.headers.get("content-type")} bytes=${buffer.length}`);

  // 落盘位置:URL 里的对象名对应 LOCAL_UPLOAD_DIR 下的文件
  const localDir = process.env.LOCAL_UPLOAD_DIR;
  if (localDir) {
    const objectName = url.replace("/api/uploads/", "");
    const filePath = path.join(localDir, objectName);
    check("文件确实写进了本地目录", existsSync(filePath), `期望路径=${filePath}`);
  } else {
    console.log("      跳过「文件确实写进了本地目录」:未设置 LOCAL_UPLOAD_DIR,无法定位落盘位置");
  }
}

// ---------- ③ 拒得住的输入 ----------
{
  const tooBig = Buffer.alloc(6 * 1024 * 1024, 1);
  const big = await upload(tooBig, "big.png", "image/png");
  check("超过 5MB 被拒且提示可读", big.status === 400 && /5MB|压缩/.test(big.body?.error ?? ""), `status=${big.status} error=${big.body?.error}`);

  const wrongType = await upload(Buffer.from("not an image"), "note.txt", "text/plain");
  check("非图片类型被拒且提示可读", wrongType.status === 400 && /JPG|PNG|WebP|GIF/.test(wrongType.body?.error ?? ""), `status=${wrongType.status} error=${wrongType.body?.error}`);
}

// ---------- ④ 挂到物品上,删除物品时把图片一并清掉 ----------
if (url) {
  const created = await call("POST", "/api/items", {
    name: "图片上传验收物品",
    category: "日用",
    type: "DURABLE",
    unit: "个",
    quantity: 1,
    imageUrl: url,
  });
  check("能把图片挂到物品上", created.status === 201 || created.status === 200, `status=${created.status}`);
  const itemId = created.body?.id;

  if (itemId) {
    const readBack = await call("GET", `/api/items/${itemId}`);
    check("物品读回时带着图片地址", readBack.body?.imageUrl === url, `imageUrl=${readBack.body?.imageUrl}`);

    // 删除(软删 → 永久删除),图片应当被清理,不留孤儿文件
    await call("DELETE", `/api/items/${itemId}`, {});
    await call("DELETE", `/api/items/${itemId}`, { permanent: true });
    await new Promise((resolve) => setTimeout(resolve, 600));

    const afterDelete = await fetch(BASE + url, { headers: { cookie } });
    check("删除物品后图片文件被清理(不留孤儿)", afterDelete.status === 404, `status=${afterDelete.status}`);
  }
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);