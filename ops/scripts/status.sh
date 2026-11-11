#!/bin/sh
# 쌤유 글방 운영 상태 요약 스크립트(서비스 계정 wesvc) — 값만 읽고 아무것도 바꾸지 않는다.
#
# 왜 필요한가:
#   - 릴리스·Time Machine 제외·맥 안 상태(4460)·터널(20242)·공개 경로(CloudFront ICN, wss, 원본 403)·감시 설정을 한눈에 확인한다(PLAN §15.2, §15.5).
# 안전장치:
#   - 비밀값 파일 내용은 절대 읽거나 출력하지 않으며, 다른 서비스·포트는 조회하거나 건드리지 않는다.
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/we.sh status

글방 운영 서버(127.0.0.1:4460), 전용 터널(127.0.0.1:20242), 공개 경로(write.ssamuniverse.com),
서버 볼륨 여유 공간, 보관 릴리스 목록, Time Machine 백업 제외 여부, AWS 감시 설정 유무를 읽기 전용으로 확인합니다.

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

echo "-- 릴리스 및 호스트 상태"
cur_rel="$(we_current_release)"
prev_rel="$(we_previous_release)"
app_link="$(readlink "$WE_APP" 2>/dev/null || echo 없음)"
last_dep="$(cat "$WE_STATE/last-deploy" 2>/dev/null || echo 없음)"
pub_switch="켜짐"
[ -f "$WE_STATE/public-off" ] && pub_switch="꺼짐 (state/public-off)"
school_win="허용 시간"
if we_is_school_hours; then
  school_win="수업 시간 배포 금지창 (Asia/Seoul 평일 08:00~16:00)"
fi

echo "현재 릴리스 : ${cur_rel:-없음} (링크: $app_link)"
echo "이전 릴리스 : ${prev_rel:-없음}"
echo "마지막 배포 : $last_dep"
auto_state="$(cat "$WE_STATE/autodeploy-status" 2>/dev/null || echo '기록 없음')"
[ ! -e "$WE_HOME/AUTO_DEPLOY_PAUSED" ] || auto_state="일시정지 중 — $auto_state"
echo "자동 배포   : $auto_state"
echo "공개 연결   : $pub_switch"
echo "현재 시간대 : $school_win ($(TZ=Asia/Seoul date '+%F %T KST'))"

echo
echo "-- 서버 볼륨 여유 공간 ($WE_HOME)"
df -h "$WE_HOME" || echo "[FAIL] 서버 볼륨 공간을 확인하지 못했습니다"

echo
echo "-- 보관 중인 릴리스 (rollback 대상은 .we-build-ok가 있는 릴리스)"
if [ -d "$WE_RELEASES" ]; then
  ls -lt "$WE_RELEASES"
else
  echo "아직 보관된 릴리스 폴더가 없습니다"
fi

tm_out="$(tmutil isexcluded "$WE_HOME" 2>/dev/null || echo 확인불가)"
case "$tm_out" in
  *"[Excluded]"*) echo "[OK]   Time Machine 백업 제외 ($WE_HOME)" ;;
  *) echo "[FAIL] Time Machine 백업 제외 미확인: $tm_out" ;;
esac

echo
echo "-- 터널 메트릭 (127.0.0.1:$WE_TUNNEL_METRICS_PORT)"
tun_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$WE_TUNNEL_METRICS_PORT/ready" || echo 000)"
if [ "$tun_code" = "200" ]; then
  echo "[OK]   전용 터널 준비 완료 (HTTP 200)"
else
  echo "[FAIL] 전용 터널 미응답 (HTTP $tun_code, 기대 200)"
fi

echo
echo "-- 맥 안 및 공개 경로 점검 (healthcheck)"
"$NODE_BIN" "$here/healthcheck.mjs" || true

echo
echo "-- 감시 및 비밀값 파일 유무 (값 출력 없음)"
echo "운영 비밀값 파일 : $( [ -s "$WE_ENV_FILE" ] && echo 있음 || echo '없음 -> sh ops/we.sh init-secrets' )"
echo "터널 설정 파일   : $( [ -s "$WE_CLOUDFLARED/config.yml" ] && echo 있음 || echo '없음 -> sh ops/we.sh tunnel-create' )"
echo "CloudWatch 자격  : $( [ -s "$WE_SECRETS/aws-macmini-credentials" ] && echo 있음 || echo '없음 -> sh ops/aws/setup-ops.sh' )"
echo "SNS 알림 주제    : $( [ -s "$WE_AWS_DIR/alerts-topic" ] && echo 있음 || echo '없음 -> sh ops/aws/setup-ops.sh' )"
