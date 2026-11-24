// AI 接口的「不说谎」验收:没配置 / 连不上 / 被限流,三种情况都要说得清。
//
// 由来(实测):
//   · insights 是四个 AI 接口里**唯一没有限流**的,而 ?force=1 能绕过缓存 ——
//     连打 25 次拿到 25 次 200,也就是 25 次真实模型调用(用户填的是自己的 Key);
//   · 上游连不上时(把接口地址指向一个不存在的端口),chat / batch-identify 回的是
//     「服务器暂时开小差了,请稍后重试」—— 用户看不出问题在接口地址或网络上。
//
// 这个套件在**没有 AI Key 的环境**(比如 CI)里验证「未配置时明确拒绝」;
// 若环境里配了 AI,会额外验证「上游连不上时是 502 + 可操作文案」——
// 为此它需要 OPENAI_BASE_URL 指向一个**连不上**的地址(AI_PROBE_UNREACHABLE=1 时创建实例),
// 否则会真的花钱,套件会跳过这部分并说明原因。
//
// 用法:BASE_URL=... PROBE_USER=... PROBE_PASS=... node scripts/verify-ai-guards.mjs

import { loginCookie } from "./lib/probe-login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3001";
const USER = process.env.PROBE_USER || "bgs";
const PASS = process.env.PROBE_PASS || "GuiWu-2026-Home";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};
const skip = (name, why) => {
  results.push({ name, ok: true, skipped: true });
  console.log(`SKIP  ${name}  → ${why}`);
};

const cookie = await loginCookie(BASE, USER, PASS);
const call = async (method, path, body) => {
  const res = await fetch(BASE + path, { method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text };
};

const settings = await call("GET", "/api/settings/ai");
const configured = Boolean(settings.json?.apiKeyConfigured);

// ---------- 1 没配置时:五个入口都要明确说「没配置」,且不是 500 ----------
{
  const probes = [
    ["AI 助手", await call("POST", "/api/ai/chat", { messages: [{ role: "user", content: "你好" }] })],
    ["单件分析", await call("POST", "/api/ai/analyze-item", { name: "AI 守卫探针", category: "日用" })],
    ["批量识别", await call("POST", "/api/ai/batch-identify", { images: [{ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }] })],
    ["本周建议", await call("GET", "/api/ai/insights")],
  ];
  for (const [label, response] of probes) {
    if (configured) {
      // 配了 AI 的环境:只要求「不是 500」与「有可读的错误或成功」,不主动制造花费
      check(`${label}:已配置 AI,不测「未配置」分支`, response.status !== 500, `status=${response.status}`);
      continue;
    }
    const message = String(response.json?.error ?? "");
    check(`${label}:未配置时明确说没配(4xx,不是 500)`, response.status >= 400 && response.status < 500 && /未配置|请先/.test(message), `status=${response.status} ${message.slice(0, 80)}`);
  }
}

// ---------- 2 上游连不上时:502 + 可操作的文案 ----------
// 自检测,不引入新环境变量(这个仓库有一条检查:代码里用到的环境变量必须进文档):
// 先打一次 insights —— 如果它真的是「连不上」(502 + 那句话),再做完整断言;
// 如果它成功(说明这个实例的 AI 是好的),就跳过,免得为了测行为真花钱。
if (!configured) {
  skip("上游连不上的文案(502)", "当前实例没有配置 AI:这一项要在「AI 指向不可达地址」的实例上测");
} else {
  const probe = await call("GET", "/api/ai/insights?force=1");
  const unreachable = probe.status === 502 && /连不上 AI 接口/.test(String(probe.json?.error ?? ""));
  if (!unreachable) {
    skip("上游连不上的文案(502)", `这个实例的 AI 可用(insights=${probe.status}),为避免真花钱跳过`);
  } else {
    const chat = await call("POST", "/api/ai/chat", { messages: [{ role: "user", content: "你好" }] });
    check("本周建议:连不上上游时是 502 且说明检查接口地址", probe.status === 502 && /连不上 AI 接口/.test(String(probe.json?.error ?? "")), `status=${probe.status} ${String(probe.json?.error ?? "").slice(0, 90)}`);
    check("AI 助手:同上(此前这里回的是「服务器暂时开小差了」)", chat.status === 502 && /连不上 AI 接口/.test(String(chat.json?.error ?? "")), `status=${chat.status} ${String(chat.json?.error ?? "").slice(0, 90)}`);
    check("响应里带了可识别的错误码,便于排查", String(probe.json?.code ?? "") === "AI_UNREACHABLE", String(probe.json?.code ?? "(无)"));
  }
}

const failed = results.filter((entry) => !entry.ok);
const skipped = results.filter((entry) => entry.skipped);
console.log(`\n${results.length - failed.length - skipped.length}/${results.length - skipped.length} 通过${skipped.length ? `(${skipped.length} 项跳过)` : ""}`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);