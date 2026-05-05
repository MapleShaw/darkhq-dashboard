#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# darkhq-dashboard · cron job 运行器模板
# ─────────────────────────────────────────────────────────────
# 用途：给 OpenClaw 那端的 cron job 作为 wrapper，跑完后自动把
# 运行记录回写到 dashboard，在"日程 › 展开"里看到历史出勤。
#
# 使用：
#   ./cron-wrapper.sh <JOB_ID> <实际命令> [参数...]
#
# 例子（把它加到 crontab 里，替代直接写命令）：
#   30 15 * * * /home/openclaw/darkhq-dashboard/scripts/cron-wrapper.sh signal-radar node /home/openclaw/.openclaw/signal-radar.js
#
# 环境变量（可选）：
#   DASHBOARD_URL   默认 http://localhost:9700
#   WRAPPER_TIMEOUT 默认 5（回写 dashboard 的超时秒数，失败不影响任务本身）
#
# 依赖：bash / curl / date。最好也装 jq（没有会用最朴素的 JSON 组装，特殊字符可能出问题）。
# ─────────────────────────────────────────────────────────────

set -u

JOB_ID="${1:?用法：$0 <JOB_ID> <实际命令> [参数...]}"
shift

DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:9700}"
WRAPPER_TIMEOUT="${WRAPPER_TIMEOUT:-5}"

START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
T0=$(date +%s%N 2>/dev/null || date +%s000000000)

# 运行实际命令，抓 stdout + stderr，保留退出码
OUTPUT="$("$@" 2>&1)"
EXIT_CODE=$?

T1=$(date +%s%N 2>/dev/null || date +%s000000000)
DURATION_MS=$(( (T1 - T0) / 1000000 ))

if [ "$EXIT_CODE" -eq 0 ]; then
  STATUS="success"
else
  STATUS="failed"
fi

# 截断 output，避免过长的 stdout 塞爆 dashboard（保留头尾各 2KB）
OUTPUT_LEN=${#OUTPUT}
if [ "$OUTPUT_LEN" -gt 4096 ]; then
  HEAD="${OUTPUT:0:2048}"
  TAIL="${OUTPUT: -2048}"
  OUTPUT="${HEAD}

...（中间 $((OUTPUT_LEN - 4096)) 字节已省略）...

${TAIL}"
fi

# 组装 JSON payload
if command -v jq >/dev/null 2>&1; then
  PAYLOAD=$(jq -n \
    --arg s "$STATUS" \
    --arg o "$OUTPUT" \
    --arg st "$START_ISO" \
    --argjson d "$DURATION_MS" \
    '{status:$s, output:$o, startedAt:$st, durationMs:$d}')
else
  # 朴素实现：只做最基本的转义（可能对含反斜杠/特殊字符的输出不完美）
  ESCAPED=$(printf '%s' "$OUTPUT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1])' 2>/dev/null || printf '%s' "$OUTPUT" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\r/\\r/g' | awk '{printf "%s\\n", $0}' ORS='')
  PAYLOAD=$(printf '{"status":"%s","output":"%s","startedAt":"%s","durationMs":%s}' \
    "$STATUS" "$ESCAPED" "$START_ISO" "$DURATION_MS")
fi

# 回写，超时 + 失败静默（不影响任务本身）
curl -sS -m "$WRAPPER_TIMEOUT" \
  -X POST "$DASHBOARD_URL/api/cron/${JOB_ID}/runs" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" > /dev/null 2>&1 || true

# 还原任务真实退出码
exit $EXIT_CODE
