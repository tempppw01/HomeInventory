// spaceDeletePrompt 的单测 —— 删空间前到底跟用户说了什么。
//
// 起因:接口对「空间里还有物品」返回 409,而界面弹的是「确定删除空间“X”?」——
// 用户点了确定才发现删不掉。而且删父空间会把下级空间置为顶级,这条后果从来没被说出来过。
// 文案抽成纯函数之后,这两件事就能在 CI 里被钉住,不依赖浏览器(空间卡片的右键菜单在自动化里
// 不稳定,实测三次都没打开 —— 与其写一条绿的假检查,不如把逻辑抽出来直接测)。

import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
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

test("有下级空间 + 本级也有物品:说清挡住删除的是本级的这几件", () => {
  // 2026-11-27 补:空间卡上的「N 件」现在**含下级空间**,而挡住删除的是直接放在本层的物品
  // (服务端按 locationId = 本空间 数)。不提这句,用户会觉得「卡片明明写 2 件,怎么只说 1 件」。
  const prompt = spaceDeletePrompt("厨房", 1, 1);
  assert.ok(prompt);
  assert.equal(prompt.blocked, true);
  assert.match(prompt.message, /还有 1 件物品/, "挡删除的件数按本层算");
  assert.match(prompt.message, /下级空间里的物品不算在这 1 件里/, "把卡片多出来的那部分说清楚");
  assert.match(prompt.message, /1 个下级空间会变成顶级空间/);

  // 没有下级时不该出现这段解释
  assert.doesNotMatch(spaceDeletePrompt("抽屉", 2, 0)?.message ?? "", /下级空间/);
});

test("空间里只剩「已用完」的物品时,提示语不许说「请先移动」这件做不到的事", () => {
  // 2026-11-28 探针库实测:空间里只有一件已用完(库存 0 件)的物品时,导轨与卡片都写 0 件 /
  // 「还没放东西」,删除却回「还有 1 件物品,请先移动」—— 而那件东西在物品页、搜索、回收站里
  // 都找不到,界面上没有任何入口移动或删掉它。说清它是什么、为什么动不了,比给一句空指示强。
  const onlyUsedUp = spaceDeletePrompt("书房", 1, 0, 1);
  assert.match(onlyUsedUp.message, /其中 1 件已经用完/);
  assert.match(onlyUsedUp.message, /不显示在物品页和搜索里/);
  assert.match(onlyUsedUp.message, /暂时删不掉/);
  const mixed = spaceDeletePrompt("书房", 3, 0, 2);
  assert.match(mixed.message, /还有 3 件物品/);
  assert.match(mixed.message, /其中 2 件已经用完/);
  // 没有已用完的物品时,提示语与以前一样 —— 不多一句废话。
  const plain = spaceDeletePrompt("书房", 2, 0, 0);
  assert.match(plain.message, /还有 2 件物品/);
  assert.doesNotMatch(plain.message, /已经用完/);
});

test("源码级守卫:删空间的调用方要把「已用完」的件数传进来", () => {
  const source = readFileSync(new URL("../../src/components/views/locations-view.tsx", import.meta.url), "utf8");
  const at = source.indexOf("spaceDeletePrompt(");
  assert.ok(at > 0, "没找到 spaceDeletePrompt 的调用");
  assert.match(source.slice(at, at + 300), /usedUpCount/, "调用时必须传已用完的件数,否则提示语又会说「请先移动」");
});