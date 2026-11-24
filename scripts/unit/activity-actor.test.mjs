// activityActorLabel 的单测 —— 历史记录里的「操作人」必须说对。
//
// 起因(实测):建探针账号 → 用它消耗 → 删号 → 记录变成 {userId:null, scanRequestId:null, user:null},
// 而界面写的是 `${record.user?.displayName || "公开扫码"}` —— 于是**有账号的人做过的事被说成「公开扫码」**
// (在这个应用里那指的是没登录的二维码扫码,记录会带 scanRequestId)。

import { test } from "node:test";
import assert from "node:assert/strict";

import { activityActorLabel } from "../../src/lib/activity-actor.ts";

test("有账号:显示账号名", () => {
  assert.equal(activityActorLabel({ userId: "u1", user: { displayName: "小明", username: "ming" } }), "小明");
});

test("账号只有用户名时用用户名,不留空", () => {
  assert.equal(activityActorLabel({ userId: "u1", user: { displayName: "  ", username: "ming" } }), "ming");
});

test("账号被删(userId 为 null、没有 scanRequestId):说「账号已删除」,不能说成「公开扫码」", () => {
  assert.equal(activityActorLabel({ userId: null, scanRequestId: null, user: null }), "账号已删除");
});

test("真·公开扫码(带 scanRequestId)才说「公开扫码」", () => {
  assert.equal(activityActorLabel({ userId: null, scanRequestId: "scan-1", user: null }), "公开扫码");
});

test("有家庭成员名时优先用它(成员还在,账号没了)", () => {
  assert.equal(activityActorLabel({ userId: null, scanRequestId: null, member: { name: "奶奶" }, user: null }), "奶奶");
});

test("空值不炸", () => {
  assert.equal(activityActorLabel(null), "未知");
  assert.equal(activityActorLabel(undefined), "未知");
  assert.equal(activityActorLabel({}), "账号已删除");
});