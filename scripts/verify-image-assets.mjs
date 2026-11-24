// 镜像里的启动脚本,不许引用「镜像里没有的东西」。
//
// 由来(v0.1.41 的真实事故):脚本为了用本地日,写了 `import ... from "@/lib/local-date"`。
// 本地一切正常,但运行镜像只复制 scripts/、prisma/、public/ 与 .next —— 没有 src/、没有 tsconfig.json。
// 容器启动时 entrypoint 会跑这个脚本,于是别名解析失败 → 抛错 → `set -eu` 让容器退出 →
// /api/health 永远不通 → docker-publish 的冒烟测试红了两跑,那一版因此没有发布。
//
// 这个校验把那条边界变成可执行的规则:
//   1 docker/entrypoint.sh 里跑到的脚本,它们的**相对导入**必须全部落在 scripts/ 或 prisma/ 内;
//   2 这些文件里不许出现 `@/` 别名(镜像里没有 tsconfig,解析不了);
//   3 裸包名只能是 node: 内置模块或 package.json 里声明过的依赖;
//   4 Dockerfile 的 runner 阶段必须仍然复制 scripts/ 与 prisma/(否则上面三条的前提就没了)。
//
// 不需要起服务、不需要浏览器,放进 CI 的静态作业即可秒级拦住同类事故。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

const ROOT = process.cwd();
const ENTRYPOINT = "docker/entrypoint.sh";
const DOCKERFILE = "Dockerfile";
/** 运行镜像里能拿到的项目目录(见 Dockerfile 的 runner 阶段 COPY) */
const AVAILABLE_DIRS = ["scripts", "prisma", "public"];
const ALLOWED_BARE = new Set();
{
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) ALLOWED_BARE.add(name);
}

// ---------- 1 找出 entrypoint 在容器里跑的脚本 ----------
const entrypoint = readFileSync(ENTRYPOINT, "utf8");
const entryFiles = [...entrypoint.matchAll(/\/app\/((?:scripts|prisma)\/[\w./-]+\.ts)/g)].map((match) => match[1]);
check("entrypoint 里能解析出要跑的脚本", entryFiles.length > 0, `解析到 ${entryFiles.length} 个`);
check("这些脚本在仓库里都存在", entryFiles.every((file) => existsSync(file)), entryFiles.filter((file) => !existsSync(file)).join(", "));
console.log(`      容器启动时会跑:${[...new Set(entryFiles)].join("、")}`);

// ---------- 2 顺着相对导入走一遍 ----------
const isRelative = (spec) => spec.startsWith("./") || spec.startsWith("../");
const candidates = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`, join(base, "index.ts"), join(base, "index.tsx")];
const resolveRelative = (spec, fromFile) => {
  const base = resolve(dirname(fromFile), spec);
  return candidates(base).find((path) => existsSync(path)) ?? null;
};
/** 这个文件是否落在镜像里能拿到的目录内 */
const inAvailableDir = (file) => AVAILABLE_DIRS.some((dir) => relative(join(ROOT, dir), file).split(sep)[0] !== "..");

const importSpecs = (file) => {
  const code = readFileSync(file, "utf8");
  const specs = [];
  const patterns = [
    /(?:^|\n)\s*import\s+[^;]*?from\s+["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s+["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s+[^;]*?from\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) for (const match of code.matchAll(pattern)) specs.push(match[1]);
  return specs;
};

const visited = new Set();
const outside = [];
const aliasUsers = [];
const unknownPackages = [];
const queue = [...new Set(entryFiles)];
while (queue.length) {
  const file = resolve(queue.shift());
  if (visited.has(file)) continue;
  visited.add(file);
  if (!inAvailableDir(file)) outside.push(relative(ROOT, file));
  for (const spec of importSpecs(file)) {
    if (isRelative(spec)) {
      const target = resolveRelative(spec, file);
      if (target) queue.push(target);
      continue;
    }
    if (spec.startsWith("@/")) { aliasUsers.push(`${relative(ROOT, file)} → ${spec}`); continue; }
    if (spec.startsWith("node:")) continue;
    const packageName = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (!ALLOWED_BARE.has(packageName)) unknownPackages.push(`${relative(ROOT, file)} → ${spec}`);
  }
}

check("启动脚本的相对导入全在镜像会复制的目录里(scripts/ 或 prisma/)", outside.length === 0, `越界:${outside.join(", ")}`);
check("启动脚本里没有 @/ 别名(镜像里没有 tsconfig,解析不了)", aliasUsers.length === 0, aliasUsers.join(", "));
check("启动脚本引用的包都在 package.json 里(镜像才装得上)", unknownPackages.length === 0, unknownPackages.join(", "));
console.log(`      共检查 ${visited.size} 个文件`);

// ---------- 3 Dockerfile 的前提还在 ----------
const dockerfile = readFileSync(DOCKERFILE, "utf8");
const runnerStage = dockerfile.slice(dockerfile.indexOf("AS runner"));
check("runner 阶段仍然复制 scripts/", /COPY --from=builder \/app\/scripts \.\/scripts/.test(runnerStage), "Dockerfile 的 COPY 少了 scripts");
check("runner 阶段仍然复制 prisma/", /COPY --from=builder \/app\/prisma \.\/prisma/.test(runnerStage), "Dockerfile 的 COPY 少了 prisma");
check("MySQL 变体 schema 也在镜像里(entrypoint 会复制它)", /COPY --from=builder \/app\/prisma \.\/prisma/.test(runnerStage) && existsSync("prisma/schema.mysql.prisma"), "缺 prisma/schema.mysql.prisma");

// ---------- 4 反向自检:确保这套校验真的在扫东西 ----------
const entrypointScripts = readdirSync("scripts").filter((file) => file.endsWith(".ts"));
check("扫到了足够多的脚本(防止空跑)", entrypointScripts.length >= 3 && visited.size >= entryFiles.length, `仓库里有 ${entrypointScripts.length} 个 .ts 脚本`);

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);