// spaceDeletePrompt 的单测 —— 删空间前到底跟用户说了什么。
//
// 起因:接口对「空间里还有物品」返回 409,而界面弹的是「确定删除空间“X”?」——
// 用户点了确定才发现删不掉。而且删父空间会把下级空间置为顶级,这条后果从来没被说出来过。
// 文案抽成纯函数之后,这两件事就能在 CI 里被钉住,不依赖浏览器(空间卡片的右键菜单在自动化里
// 不稳定,实测三次都没打开 —— 与其写一条绿的假检查,不如把逻辑抽出来直接测)。

import { test } from "node:test";
import assert from "node:assert/strict";

import { spaceDeletePrompt } from "../../src/lib/space-summary.ts";

test("里面有物品:不说「确定吗」,直接说明还有几件、不能直接删", () => {
  const prompt = spaceDeletePrompt("厨房吊柜", 3, 0);
  assert.ok(prompt);
  assert.equal(prompt.blocked, true);
  assert.match(prompt.message, /3 件物品/, "要说清件数");
  assert.match(prompt.message, /不能直接删除/);
  assert.doesNotMatch(prompt.message, /确定删除/, "这时不该再问「确定删除」");
  assert.match(prompt.message, /厨房吊柜/, "要说清是哪个空间");
  assert.equal(prompt.confirmLabel, "知道了", "这时唯一的动作是「知道了」,不该给一个删不掉的确认按钮");
});

test("空空间 + 有下级空间:把「下级会变成顶级」这条后果说出来", () => {
  const prompt = spaceDeletePrompt("厨房", 0, 2);
  assert.ok(prompt);
  assert.equal(prompt.blocked, false);
  assert.match(prompt.message, /确定删除空间“厨房”/);
  assert.match(prompt.message, /2 个下级空间/, "下级空间数量要说");
  assert.match(prompt.message, /顶级空间/, "说清它们会变成什么");
  assert.match(prompt.message, /不会删掉/, "别让人以为下级空间会跟着消失");
});

test("空空间且没有下级:只说「物品不受影响」,不要提下级空间", () => {
  const prompt = spaceDeletePrompt("阳台", 0, 0);
  assert.ok(prompt);
  assert.equal(prompt.blocked, false);
  assert.doesNotMatch(prompt.message, /下级空间/);
  assert.match(prompt.message, /不受影响/);
});

test("只有一件物品时也说「1 件」(不是「1 件物品(s)」这种机器话)", () => {
  const prompt = spaceDeletePrompt("抽屉", 1, 0);
  assert.ok(prompt);
  assert.match(prompt.message, /还有 1 件物品/);
});