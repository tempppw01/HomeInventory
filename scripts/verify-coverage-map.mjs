// 覆盖地图不许说假话。
//
// 由来:这张表是「哪些行为有断言守着」的唯一索引,但我每轮都在手改它 —— 这次一量就是两处漂移:
//   · 地图少了 4 个真在 CI 静态作业里跑的断言套件;
//   · 地图写「单测 300 条」,实际已经 308 条。
// 文档说假话比没文档更糟:维护者会以为某块有覆盖,于是不敢/不去补。
//
// 这里把三条变成可执行的规则:
//   1 package.json 的 test:* 与 ci.yml 里跑到的**断言套件**,覆盖地图里必须都有一行;
//   2 地图里不许有「两处都没跑」的幽灵行;
//   3 地图上写的单测条数,必须等于 scripts/unit/*.test.mjs 里的 test() 声明数。
//
// 3 个脚本是**辅助工具**而不是断言套件(建账号 / 造种子 / 性能报告),显式豁免。

import { existsSync, readdirSync, readFileSync } from "node:fs";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
};

/** 辅助脚本:不是断言套件,不该要求它们出现在「覆盖」表里 */
const HELPER_SCRIPTS = new Set(["make-probe-accounts", "seed-ci-fixtures", "scale-perf-test"]);

const nameOf = (command) => {
  const match = /scripts\/([\w-]+)\.mjs/.exec(command);
  return match ? match[1] : null;
};

// ---------- 1 收集三处清单 ----------
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const inPackage = new Set();
for (const [key, value] of Object.entries(pkg.scripts)) {
  if (!key.startsWith("test:")) continue;
  for (const part of String(value).split(/&&|\|\||;/)) {
    const name = nameOf(part);
    if (name) inPackage.add(name);
  }
}

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const inCi = new Set();
for (const match of ci.matchAll(/node scripts\/([\w-]+)\.mjs/g)) inCi.add(match[1]);

const map = readFileSync("docs/verification.md", "utf8");
const rows = new Map();
for (const match of map.matchAll(/^\| `([\w-]+)` \|([^|]*)\|([^|]*)\|/gm)) {
  rows.set(match[1], { description: match[2].trim(), count: match[3].trim() });
}

check("三处清单都读到了(防止空跑)", inPackage.size > 20 && inCi.size > 20 && rows.size > 20, `package=${inPackage.size} ci=${inCi.size} map=${rows.size}`);

// ---------- 2 每个断言套件都要在表里 ----------
const suites = [...new Set([...inPackage, ...inCi])].filter((name) => !HELPER_SCRIPTS.has(name)).sort();
const missing = suites.filter((name) => !rows.has(name));
check("CI / npm 里跑的断言套件,覆盖地图里都有", missing.length === 0, `缺:${missing.join(", ")}`);

// ---------- 3 不许有幽灵行 ----------
// 单元测试行(item-forecast / interactive-nesting 这类)不是 CI 里的 .mjs 套件,
// 它们对应 scripts/unit/*.test.mjs —— 该豁免,不然会把正常的表结构判成幽灵行。
const isUnitRow = (name) => existsSync(`scripts/unit/${name}.test.mjs`);
const phantom = [...rows.keys()].filter((name) => !inPackage.has(name) && !inCi.has(name) && !HELPER_SCRIPTS.has(name) && !isUnitRow(name));
check("覆盖地图里没有「两处都没跑」的幽灵行", phantom.length === 0, `幽灵:${phantom.join(", ")}`);

// ---------- 4 表里的条目要真的存在、条数是正整数 ----------
const missingFiles = [...rows.keys()].filter((name) => name.startsWith("verify-") && !existsSync(`scripts/${name}.mjs`) && !existsSync(`scripts/${name}.test.mjs`));
check("表里提到 verify-* 的脚本都真实存在", missingFiles.length === 0, missingFiles.join(", "));

// 只对 verify-* 的行要求「条数是正整数」:单元测试行是 3 列格式,没有条数列
const badCounts = [...rows.entries()].filter(([name, row]) => name.startsWith("verify-") && (!/^\d+$/.test(row.count) || Number(row.count) <= 0));
check("每行的检查条数都是正整数", badCounts.length === 0, badCounts.map(([name, row]) => `${name}=${row.count}`).join(", "));

// ---------- 5 单测条数不许说假话 ----------
const declared = readdirSync("scripts/unit")
  .filter((file) => file.endsWith(".test.mjs"))
  .reduce((sum, file) => sum + [...readFileSync(`scripts/unit/${file}`, "utf8").matchAll(/^\s*test\(/gm)].length, 0);
const claimedMatch = /\*\*(\d+) 条\*\*\(最近一次全绿\)/.exec(map);
check("地图上写了单测条数", Boolean(claimedMatch), "没找到「N 条(最近一次全绿)」");
if (claimedMatch) {
  const claimed = Number(claimedMatch[1]);
  check(`地图写的单测条数(${claimed})与实际声明数(${declared})一致`, claimed === declared, `差 ${declared - claimed} 条 —— 加了用例要同步这张表`);
}

// ---------- 6 反向自检 ----------
check("确实扫到了单元测试文件", declared > 100, `只数到 ${declared} 个 test() 声明`);

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) for (const entry of failed) console.log(`[${entry.name}] ${entry.detail}`);
process.exit(failed.length ? 1 : 0);