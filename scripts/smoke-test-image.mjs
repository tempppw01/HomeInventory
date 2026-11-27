// 对**已发布的镜像**做端到端冒烟:不只是「服务起来了」,而是「真的能用」。
//
// 健康检查只能证明进程活着、数据库连上了;这里再多走三步:
//   ① 初始化管理员(entrypoint 建表是否真的可用)
//   ② 登录拿到会话(会话与鉴权链路)
//   ③ 建一件物品并读回来(写入路径 + 读路径)
//
// 之所以放进发布流程:发布产物能不能用,应该由 CI 回答,而不是等用户 docker run 才发现。
//
// 用法:node scripts/smoke-test-image.mjs --base http://127.0.0.1:3199 --user smoke --pass Smoke#2026x

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const BASE = arg("base", "http://127.0.0.1:3000");
const USER = arg("user", "smoke");
const PASS = arg("pass", "Smoke#2026x");

// 每次请求都要有超时:没有超时的 fetch 既不返回也不报错,整脚本会挂死并以 exit 13 收场 ——
// 发布流程只看到「Process completed with exit code 13」,一个版本就这么被无声拦下(2026-11-28 实测)。
// 健康检查那次用更短的超时(它在重试循环里,起得慢就该重试),其余单发请求用 SMOKE_TIMEOUT_MS。
const SMOKE_TIMEOUT_MS = 15000;

const results = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const json = async (response) => {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 200) }; }
};

// ① 健康检查
{
  let health = null;
  const REQUEST_TIMEOUT_MS = 10000;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.ok) { health = await json(response); break; }
    } catch { /* 还没起来 */ }
    if ((attempt + 1) % 10 === 0) console.log(`… 健康检查还没过:已尝试 ${attempt + 1}/40 次`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  step("健康检查可用", Boolean(health), JSON.stringify(health ?? {}).slice(0, 120));
  if (!health) process.exit(1);
}

// ② 初始化管理员(容器首次启动时没有账号;已有则跳过)
{
  const response = await fetch(`${BASE}/api/auth/setup`, { signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, displayName: "冒烟测试", password: PASS }),
  });
  const body = await json(response);
  const ok = response.ok || response.status === 409;
  step("初始化管理员(或已初始化)", ok, `status=${response.status} ${JSON.stringify(body).slice(0, 100)}`);
  if (!ok) process.exit(1);
}

// ③ 登录
let cookie = "";
{
  const response = await fetch(`${BASE}/api/auth/login`, { signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const body = await json(response);
  cookie = (response.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
  step("登录成功", response.ok && Boolean(cookie), `status=${response.status} ${JSON.stringify(body).slice(0, 100)}`);
  if (!response.ok) process.exit(1);
}

// ④ 建一件物品,再读回来
{
  const name = `冒烟测试物品 ${Date.now().toString().slice(-6)}`;
  const created = await fetch(`${BASE}/api/items`, { signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name, category: "日用", type: "CONSUMABLE", unit: "件", quantity: 2 }),
  });
  const createdBody = await json(created);
  step("创建物品成功", created.status === 201 || created.status === 200, `status=${created.status} ${JSON.stringify(createdBody).slice(0, 120)}`);

  const id = createdBody?.id;
  if (id) {
    const list = await fetch(`${BASE}/api/items`, { signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS), headers: { cookie } });
    const listBody = await json(list);
    const rows = Array.isArray(listBody) ? listBody : (listBody.items ?? []);
    const found = rows.some((row) => row.id === id);
    step("刚建的物品能读回来(读写链路都通)", found, `列表条数=${rows.length} 命中=${found}`);

    // 清理:不要让冒烟数据留在发布验证里
    await fetch(`${BASE}/api/items/${id}`, { signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS), method: "DELETE", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ permanent: true }) });
  }
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);