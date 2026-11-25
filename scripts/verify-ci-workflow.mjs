// CI 工作流自检(静态)。
//
// 起因:我往 `ci.yml` 里插步骤时,**两次**把上一步的 `run:` 行挤掉/吃掉 ——
// 留下一个没有 `run` 也没有 `uses` 的步骤,整个工作流因此**无法解析**。
// 而 GitHub 的表现是「运行名变成 `.github/workflows/ci.yml`」,要过一会儿才发现,
// 白跑一整轮 CI(两次)。
//
// 所以把「工作流本身是合法的」也变成一条本地就能跑的检查:
//   · 每个步骤必须有 run 或 uses(缺一个就会让整个文件解析失败)
//   · 步骤引用的脚本必须真实存在(防删了脚本忘了改 CI)
//   · 关键作业与步骤仍在(防误删),并给出数量下限防空跑
//
// 用法:node scripts/verify-ci-workflow.mjs   (不需要起服务)

import { existsSync, readFileSync } from "node:fs";
import { load } from "js-yaml";

const FILE = ".github/workflows/ci.yml";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const raw = readFileSync(FILE, "utf8");

// ① 必须能解析
let workflow = null;
try {
  workflow = load(raw);
  check("ci.yml 能被解析", Boolean(workflow), "解析结果为空");
} catch (error) {
  check("ci.yml 能被解析", false, String(error.message).slice(0, 160));
}

if (!workflow) {
  console.log("\n0/1 通过");
  process.exit(1);
}

const jobs = workflow.jobs ?? {};
const jobNames = Object.keys(jobs);
check("作业数量正常(防止空跑)", jobNames.length >= 4, `作业:${jobNames.join(", ")}`);

// ② 每个步骤都要有 run 或 uses —— 缺了会让整个工作流失效(踩过两次)
const stepless = [];
const referencedScripts = new Set();
for (const [jobName, job] of Object.entries(jobs)) {
  for (const step of job.steps ?? []) {
    if (!step.run && !step.uses) stepless.push(`${jobName} / ${step.name ?? "(无名步骤)"}`);
    for (const match of String(step.run ?? "").matchAll(/node (scripts\/[\w./-]+\.mjs)/g)) referencedScripts.add(match[1]);
  }
}
check("每个步骤都有 run 或 uses", stepless.length === 0, stepless.join(" | "));

// ③ 步骤里引用的脚本要真实存在
const missingScripts = [...referencedScripts].filter((file) => !existsSync(file));
check("CI 引用的脚本都存在", missingScripts.length === 0, missingScripts.join(", "));

// ④ 关键作业还在
for (const name of ["static", "unit", "api", "mysql-runtime", "ui-flows", "ui-a11y", "ui-layout"]) {
  check(`作业「${name}」仍在`, Boolean(jobs[name]), `现有作业:${jobNames.join(", ")}`);
}

// ⑤ 关键检查还在(这些是我一路补的,别在改 CI 时被顺手删掉)
const allRuns = Object.values(jobs).flatMap((job) => (job.steps ?? []).map((step) => String(step.run ?? ""))).join("\n");
const critical = [
  "scripts/verify-api-guards.mjs",
  "scripts/verify-config-docs.mjs",
  "scripts/verify-image-assets.mjs",
  "scripts/verify-coverage-map.mjs",
  "scripts/verify-schema-sync.mjs",
  "scripts/verify-role-ui.mjs",
  "scripts/verify-readonly-ui.mjs",
  "scripts/verify-write-guards.mjs",
  "scripts/verify-payload-budget.mjs",
  "scripts/verify-auth-gate.mjs",
];
const dropped = critical.filter((file) => !allRuns.includes(file));
check("关键检查仍在 CI 里", dropped.length === 0, dropped.join(", "));

console.log(`      ${jobNames.length} 个作业 / ${Object.values(jobs).reduce((sum, job) => sum + (job.steps?.length ?? 0), 0)} 个步骤 / 引用 ${referencedScripts.size} 个脚本`);

// 步骤顺序也要守:登录限流检查会打满额度,后面不许再有要登录的步骤。
// 实测把 AI 检查放它后面 → 那个套件等 518 秒,api 作业从 2 分钟涨到 11 分钟。
{
  const apiJob = readFileSync(".github/workflows/ci.yml", "utf8").split(/\n  [a-z-]+:\n/).find((chunk) => chunk.includes("name: API 契约")) ?? "";
  const scriptSteps = [...apiJob.matchAll(/run: node scripts\/([\w-]+)\.mjs/g)].map((match) => match[1]);
  const lastIndex = scriptSteps.length - 1;
  check("登录限流检查必须是 api 作业的最后一个套件步骤", scriptSteps[lastIndex] === "verify-login-rate-limit", `最后一个是 ${scriptSteps[lastIndex] ?? "(没找到)"} —— 它会打满登录额度,后面的步骤会被拖成几分钟`);
}
const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);