// 一致性检查:代码里引用的 /api 路径,必须真的有对应路由文件。
//
// 为什么值得做:接口改名或写错路径时,静态检查、类型检查都发现不了 ——
// 只有真点到那个功能才会 404。这类问题在「界面说做了、数据没变」那一类里最典型。
//
// 做法:把 src/app/api/**/route.ts 收敛成路由模式(动态段 → *,catch-all → **),
// 再把 src/ 下所有以 /api/ 开头的字符串与模板字面量收敛成同样的形式,逐个比对。
//
// 运行:npm run test:unit

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  });

/** 路由文件 → 模式:/api/items/[id]/route.ts → /api/items/* ;[...path] → ** */
const routePattern = (file) =>
  file
    .replace(/^src\/app/, "")
    .replace(/\/route\.ts$/, "")
    .replace(/\/\[\.\.\.[^\]]+\]/g, "/**")
    .replace(/\/\[[^\]]+\]/g, "/*");

/** 整段字面量规范化:去掉查询串,把 ${...} 换成 *,去掉结尾斜杠 */
const normalizeReference = (raw) => {
  const withoutQuery = raw.split("?")[0].split("#")[0];
  const path = withoutQuery.replace(/\$\{[^}]*\}/g, "*");
  const trimmed = path.replace(/\/+$/, "") || "/";
  // 以 / 结尾的写法是「前缀」用法(例如 startsWith("/api/uploads/")),
  // 用一个 catch-all 段来表达,交给同一个匹配器处理。
  return withoutQuery.endsWith("/") && trimmed !== "/" ? `${trimmed}/**` : trimmed;
};

const segments = (value) => value.split("/").filter(Boolean);

/** 模式匹配:支持 * (一段) 与 ** (一段或多段) */
const matches = (reference, pattern) => {
  const ref = segments(reference);
  const pat = segments(pattern);
  const walkMatch = (ri, pi) => {
    if (pi === pat.length) return ri === ref.length;
    if (pat[pi] === "**") {
      // ** 吃掉一段或多段
      for (let skip = 1; ri + skip <= ref.length; skip += 1) {
        if (walkMatch(ri + skip, pi + 1)) return true;
      }
      return false;
    }
    if (ri >= ref.length) return false;
    if (pat[pi] !== "*" && pat[pi] !== ref[ri]) return false;
    return walkMatch(ri + 1, pi + 1);
  };
  return walkMatch(0, 0);
};

test("代码引用的 /api 路径都能找到对应路由", () => {
  const routeFiles = walk("src/app/api").filter((file) => file.endsWith("/route.ts"));
  assert.ok(routeFiles.length > 20, `路由数量异常(防止空跑):${routeFiles.length}`);
  const patterns = routeFiles.map(routePattern);

  const references = new Set();
  for (const file of [...walk("src/components"), ...walk("src/lib"), ...walk("src/app")]) {
    if (file.endsWith("/route.ts")) continue;
    const content = readFileSync(file, "utf8");
    // 只看反引号或引号整段包起来的字面量(含模板变量),避免把注释里的片段也当成引用
    for (const match of content.matchAll(/[`"'](\/api\/[^`"'\s]*)[`"']/g)) {
      const raw = match[1];
      if (!raw.startsWith("/api/")) continue;
      references.add(normalizeReference(raw));
    }
  }

  assert.ok(references.size > 10, `引用的接口数量异常(防止空跑):${references.size}`);

  const dangling = [...references]
    .filter((reference) => !patterns.some((pattern) => matches(reference, pattern)))
    .sort();

  assert.deepEqual(dangling, [], `这些引用找不到对应路由:\n${dangling.join("\n")}`);
});
