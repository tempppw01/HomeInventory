#!/bin/sh
# 一次跑完全部验收套件(顺序敏感:接口类先跑,UI 类后跑)。
#   PROBE_PASS=... node scripts/run-all-tests.mjs   (或 npm run test:all)
set -u
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://127.0.0.1:3001}"
export BASE_URL
FAILED=0
run() {
  label="$1"
  shift
  printf '\n=== %s ===\n' "$label"
  if "$@"; then
    :
  else
    FAILED=$((FAILED + 1))
    printf '^^^ %s 未通过\n' "$label"
  fi
}

run "单元(纯函数)" npm run --silent test:unit
run "API 契约" node scripts/api-contract-test.mjs
run "权限矩阵" node scripts/auth-matrix-test.mjs
run "备份回环" node scripts/backup-roundtrip-test.mjs
run "极端输入" node scripts/edge-input-test.mjs
run "P2 功能" node scripts/verify-p2-features.mjs
run "UI 体验" node scripts/verify-experience.mjs
run "UI 修复" node scripts/verify-entry-fixes.mjs
run "打印月报" node scripts/verify-report-page.mjs
run "窄屏布局" node scripts/verify-narrow-layout.mjs
run "布局预算" node scripts/verify-layout-budget.mjs
run "规模性能" node scripts/scale-perf-test.mjs

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  echo "全部套件通过"
else
  echo "有 $FAILED 套未通过"
fi
exit "$FAILED"