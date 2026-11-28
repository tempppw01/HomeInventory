// 发版"版本号三处对齐"的单测:
//   npm run test:unit
//
// 起因(2026-11-28 实测):本地 3001 跑着的构建界面显示 0.1.125,而 package.json 已经是 0.1.126 ——
// 顺序错了(先构建、后改版本号),版本号在构建期被写进前端包,于是界面和真实版本对不上,
// 而且界面上看不出任何异常。发版这套动作是手写的、重复了很多次,靠"我记得"是不牢的。
//
// 这里钉住三件事在同一版里同时成立:
//   1 package.json 的版本号
//   2 CHANGELOG.md 里最新的那一节
//   3 .github/release-notes/v<版本>.md 存在、且不是空壳
// 少任何一处,这个版本就是"改了一半" —— 单测直接红。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, root), "utf8");

const pkg = JSON.parse(read("package.json"));
const changelog = read("CHANGELOG.md");

/** CHANGELOG 里最新的那一节标题,例如 "v0.1.126"。 */
function newestChangelogVersion(text) {
  const match = text.match(/^##\s*\[v?(\d+\.\d+\.\d+)\]/m);
  return match ? match[1] : null;
}

test("package.json 的版本号是合法语义化版本", () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, `package.json 版本号异常:${pkg.version}`);
});

test("CHANGELOG 最新一节就是 package.json 的版本(不能只改一处)", () => {
  const newest = newestChangelogVersion(changelog);
  assert.ok(newest, "CHANGELOG 里找不到形如 ## [v0.1.126] 的版本小节");
  assert.equal(newest, pkg.version, `CHANGELOG 最新一节是 ${newest},package.json 是 ${pkg.version}`);
});

test("CHANGELOG 最新一节里有实际内容(不是只写了个标题)", () => {
  const newest = newestChangelogVersion(changelog);
  const section = changelog.split(new RegExp(`^##\\s*\\[v?${newest.replace(/\./g, "\\.")}\\]`, "m"))[1] ?? "";
  const body = section.split(/^##\s/m)[0];
  assert.ok(body.replace(/\s+/g, "").length > 120, `v${newest} 这一节只有 ${body.trim().length} 个字符,像是没写完`);
});

test("这个版本有自己的发版说明文件,而且不是空壳", () => {
  const path = new URL(`.github/release-notes/v${pkg.version}.md`, root);
  assert.ok(existsSync(path), `.github/release-notes/v${pkg.version}.md 不存在(发版说明漏了)`);
  const body = readFileSync(path, "utf8");
  assert.ok(body.replace(/\s+/g, "").length > 120, `v${pkg.version}.md 只有 ${statSync(path).size} 字节,像是占位文件`);
});

test("发版说明文件里写的就是这一版(标题或正文提到版本号,避免复制上一版忘记改)", () => {
  const body = read(`.github/release-notes/v${pkg.version}.md`);
  assert.ok(body.includes(pkg.version), `v${pkg.version}.md 正文里没有出现版本号 ${pkg.version}`);
});
