// 「探针账号只许建在探针库里」这道闸的单测:
//   npm run test:unit
//
// 守的是一件具体的事(2026-11-28 只读实测):家庭库 data/home-inventory.db 里真的躺着
// leadcheck(ADMIN)/viewcheck/rcvlead 三个账号,口令明写在仓库的 make-probe-accounts 里,
// 而且用 scrypt 复核过、三个都能登录。脚本当时对 DATABASE_URL 指向谁毫无判断。
//
// 所以这里钉住两件事:探针库要放行(否则 CI 全红),家庭库/正式库要拦住(否则再犯一次)。
import { test } from "node:test";
import assert from "node:assert/strict";

import { probeAccountTargetDecision, redactDatabaseUrl } from "../lib/probe-account-guard.mjs";

const decide = (url, override) => probeAccountTargetDecision(url, override);

test("探针库放行:CI 的 ci.db / 本机的 probeNNNN.db / empty.db / hygiene.db", () => {
  for (const url of [
    "file:../data/ci.db",
    "file:../data/probe0132.db",
    "file:../data/empty.db",
    "file:../data/hygiene.db",
    "mysql://root:rootpw@127.0.0.1:3306/ci",
  ]) {
    assert.equal(decide(url, undefined).allowed, true, url);
  }
});

test("家庭库/正式库拦住 —— 就是当初出事的那个:data/home-inventory.db", () => {
  const decision = decide("file:../data/home-inventory.db", undefined);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /home-inventory\.db/);
});

test("MySQL 的正式库名(homeinventory)也拦住 —— CI 的 MySQL 作业靠显式开关放行", () => {
  assert.equal(decide("mysql://root:rootpw@127.0.0.1:3306/homeinventory", undefined).allowed, false);
  assert.equal(decide("mysql://root:rootpw@127.0.0.1:3306/homeinventory", "1").allowed, true);
});

test("名字里只是碰巧有字母片段的不算探针库(latest.db / mytest.db 不放行)", () => {
  assert.equal(decide("file:../data/latest.db", undefined).allowed, false, "latest 里的 test 不算");
  assert.equal(decide("file:../data/mytest.db", undefined).allowed, false, "mytest 里的 test 不算");
});

test("没设 DATABASE_URL 时拦住(不知道往哪建,不能瞎建)", () => {
  assert.equal(decide(undefined, undefined).allowed, false);
  assert.equal(decide("", undefined).allowed, false);
  assert.equal(decide("   ", undefined).allowed, false);
});

test("显式开关只认 \"1\",别的值不算数(免得 ALLOW_PROBE_ACCOUNTS=false 反被当同意)", () => {
  assert.equal(decide("file:../data/home-inventory.db", "1").allowed, true);
  for (const value of ["0", "true", "yes", "", undefined]) {
    assert.equal(decide("file:../data/home-inventory.db", value).allowed, false, `override=${String(value)}`);
  }
});

test("拒绝信息里的连接串要抹掉口令(它会进 CI 日志)", () => {
  assert.equal(redactDatabaseUrl("mysql://root:rootpw@127.0.0.1:3306/homeinventory"), "mysql://root:***@127.0.0.1:3306/homeinventory");
  assert.equal(redactDatabaseUrl("file:../data/ci.db"), "file:../data/ci.db", "没有口令的连接串原样保留");
  const decision = decide("mysql://root:rootpw@127.0.0.1:3306/homeinventory", undefined);
  assert.equal(decision.reason.includes("rootpw"), false, "拒绝信息里不许出现口令");
});
