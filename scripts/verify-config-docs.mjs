// 配置一致性检查(静态):代码用到的环境变量,文档里也得有。
//
// 起因:`BACKUP_DIR`(自动备份的存放目录)在代码里用着,但 README 与两个 compose 文件里
// **都没有** —— 自托管用户想把备份放到另一块盘时无从下手。
// 这类「代码用了、文档没写」的漂移,和前一版那个「版本号写死在两处」是同一类问题。
//
// 规则:代码里 `process.env.X` 用到的变量,若属于**用户可配置**的,必须在
// README / compose 文件 / .env.example 里出现。开发与测试专用的变量走白名单,并写明理由。
//
// 用法:node scripts/verify-config-docs.mjs   (不需要起服务)

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

// 开发 / 测试 / 运行时自带的环境变量 —— 不需要写给自托管用户看
const DEV_ONLY = new Map([
  ["NODE_ENV", "运行时自带"],
  ["MODE", "构建期自带"],
  ["BASE_URL", "验收脚本用"],
  ["CHROME_PATH", "验收脚本用"],
  ["LOCALAPPDATA", "开发机路径探测"],
  ["NEXT_PUBLIC_APP_VERSION", "由 next.config 注入,用户不需设置"],
  ["OLD_TAG", "升级演练用"],
  ["DATABASE_PROVIDER", "由 DATABASE_URL 推断,但 compose 里也写了"],
  ["DATABASE_URL", "已文档化(见 README 环境变量一节)"],
  ["CI", "CI 环境自带"],
  ["SCALE_TARGET", "性能脚本用"],
  ["REQUIRE_BROWSER", "CI 用"],
  ["AI_BACKFILL_LIMIT", "补跑脚本用"],
  ["PLAYWRIGHT_CHROMIUM_EXECUTABLE", "验收脚本用"],
  ["SHOT_TAG", "截图脚本用"],
  ["SNAP_TAG", "截图脚本用"],
  ["TAG", "发布脚本用"],
  ["PROBE_USER", "验收脚本用"],
  ["PROBE_PASS", "验收脚本用"],
  ["PROBE_VIEWER_USER", "验收脚本用"],
  ["PROBE_VIEWER_PASS", "验收脚本用"],
  ["PROBE_MEMBER_USER", "验收脚本用"],
  ["PROBE_MEMBER_PASS", "验收脚本用"],
  ["READONLY_PAGE_BUDGET", "只读界面检查每次点多少个按钮(本机调试用)"],
  ["READONLY_DIALOG_BUDGET", "只读界面检查每个浮层里点多少个按钮(本机调试用)"],
  ["TZ", "单测固定时区用(UTC 日 vs 本地日的用例必须与机器时区解耦)"],
  ["BASE_OLD_URL", "升级失败体验检查里「结构旧」实例的地址(脚本专用)"],
  ["SOURCE_URL", "换机迁移检查:源实例地址(脚本专用)"],
  ["TARGET_URL", "换机迁移检查:目标空库实例地址(脚本专用)"],
  ["TARGET_USER", "换机迁移检查:目标实例账号(脚本专用)"],
  ["TARGET_PASS", "换机迁移检查:目标实例密码(脚本专用)"],
  ["PROBE_TARGET_PASS", "换机迁移检查:目标实例密码的另一种写法(脚本专用)"],
  ["ADMIN_PASSWORD", "仅初始化脚本用"],
]);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const target = path.join(dir, name);
    if (statSync(target).isDirectory()) return walk(target);
    return /\.(ts|tsx|mjs)$/.test(target) ? [target] : [];
  });

const code = [...walk("src"), ...walk("scripts")].map((file) => readFileSync(file, "utf8")).join("\n");
const used = [...new Set([...code.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)].map((match) => match[1]))].sort();

check("扫到了足够多的环境变量(防止空跑)", used.length > 15, `扫到 ${used.length} 个`);

const docs = ["README.md", "docker-compose.yml", "docker-compose.mysql.yml"]
  .map((file) => { try { return readFileSync(file, "utf8"); } catch { return ""; } })
  .join("\n");

const undocumented = used.filter((name) => !DEV_ONLY.has(name) && !docs.includes(name));
check("用户可配置的环境变量都在文档里", undocumented.length === 0, undocumented.join(", "));

// 白名单不能腐坏:条目里的变量必须仍在代码里使用(删掉变量后白名单要跟着清理)
const staleAllowlist = [...DEV_ONLY.keys()].filter((name) => !used.includes(name) && !["CI", "MODE", "NODE_ENV", "LOCALAPPDATA"].includes(name));
check("开发专用白名单没有过期条目", staleAllowlist.length === 0, staleAllowlist.join(", "));

// 反向:文档里提到的、代码完全没用的变量(可能是过时说明)
const docVars = [...new Set([...docs.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)].map((match) => match[1]))]
  .filter((name) => /^(?:OSS_|OPENAI_|DATABASE_|LOCAL_|IMAGE_|BACKUP_|MYSQL_|APP_)/.test(name));
const deadVars = docVars.filter((name) => !used.includes(name) && !["MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD", "APP_PORT"].includes(name));
check("文档里没有代码已不再使用的变量", deadVars.length === 0, deadVars.join(", "));

console.log(`      代码用到 ${used.length} 个环境变量,其中开发/测试专用 ${DEV_ONLY.size} 个`);

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);