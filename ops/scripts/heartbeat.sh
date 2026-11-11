#!/bin/sh
# 쌤유 글방 5분 주기 하트비트 스크립트(launchd: com.ssamwrite.watch) — ①~④ 전체 경로가 성공할 때만 EndToEndOK=1을 보낸다.
#
# 왜 필요한가:
#   - 맥미니 전원·회선·터널·CloudFront·원본 잠금·앱 서버(4460)·SQLite 중 하나라도 멈추면 신호가 0이 되거나 끊기고,
#     15분(3회 연속) 뒤 CloudWatch 알람(we-heartbeat-missing)이 메일을 보낸다(PLAN §15.2, §15.5).
# 안전장치:
#   - 지표 이름 공간을 Writeessay로 분리해 쌤유니버스(Classlearning)·rollingthunder(RollingThunder) 감시와 섞이지 않는다.
#   - 로그 보관 기한(WE_LOG_RETENTION_DAYS=7)을 넘긴 일회성 배포·빌드 로그도 함께 지워 개인정보 잔류를 막는다(PLAN §7.6).
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/we.sh heartbeat
   또는: sh ops/scripts/heartbeat.sh

전체 운영 경로(① 로컬 /internal/health ② 공개 /api/health ③ 공개 wss 101 ④ 원본 직접 접근 403)를 점검하고,
모두 통과했을 때만 AWS CloudWatch(us-east-1, Namespace: Writeessay)에 EndToEndOK=1 지표를 보냅니다.
AWS 자격 증명이 아직 없으면(aws/setup-ops.sh 전) 로컬 점검 결과만 기록하고 종료합니다.

옵션:
  -h, --help    이 도움말을 보여 줍니다.
EOF
}

case "${1:-}" in
  -h|--help|help)
    usage
    exit 0
    ;;
esac

[ $# -eq 0 ] || { echo "ERROR: 알 수 없는 인자: $* (--help 참고)" >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"

# 7일(LOG_RETENTION_DAYS) 지난 일회성 배포·빌드 로그 정리
if [ -d "$WE_LOGS" ]; then
  find "$WE_LOGS" -maxdepth 1 -type f \( -name 'deploy-*.log' -o -name 'build-*.log' \) \
    -mtime +"$WE_LOG_RETENTION_DAYS" -delete 2>/dev/null || true
fi

ok=0
if [ -f "$WE_STATE/public-off" ]; then
  echo "$(date '+%F %T') 공개 연결 스위치 꺼짐(state/public-off) — EndToEndOK=0" >&2
else
  if "$NODE_BIN" "$here/healthcheck.mjs" --quiet; then
    ok=1
  else
    echo "$(date '+%F %T') 전체 경로 상태 확인 실패 — EndToEndOK=0" >&2
  fi
fi

creds="$WE_SECRETS/aws-macmini-credentials"
if [ ! -s "$creds" ]; then
  echo "$(date '+%F %T') AWS 감시 자격 증명 없음(aws/setup-ops.sh 전) — EndToEndOK=$ok"
  exit 0
fi

AWS_SHARED_CREDENTIALS_FILE="$creds" AWS_CONFIG_FILE=/dev/null \
  aws cloudwatch put-metric-data \
  --region us-east-1 \
  --namespace Writeessay \
  --metric-data "MetricName=EndToEndOK,Value=$ok,Unit=Count" \
  || echo "$(date '+%F %T') CloudWatch 지표 전송 실패" >&2
