#!/bin/sh
# 쌤유 글방 공개 연결(터널) 스위치 스크립트(서비스 계정 wesvc) — 급할 때 외부 유입만 즉시 끊거나 다시 연다.
#
# 왜 필요한가:
#   - 공격 의심이나 긴급 점검 시 맥 안의 글방 서버(4460)·SQLite 데이터는 그대로 둔 채 외부 터널 입구만 안전하게 닫는다(PLAN §15.2, §15.5).
# 안전장치:
#   - 오직 wesvc 소유의 전용 터널(config.yml · 메트릭 127.0.0.1:20242)만 제어하며,
#     rollingthunder 터널(20241)·쌤유니버스 터널·로컬 앱 서버(4460)는 건드리지 않는다.
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/we.sh public <on|off|status>

글방 전용 Cloudflare 터널(com.ssamwrite.tunnel)의 외부 연결을 켜거나 끕니다.
맥 안의 앱 서버(127.0.0.1:4460)와 SQLite 데이터, 다른 서비스는 그대로 유지됩니다.

명령:
  off       state/public-off 파일을 만들고 전용 터널을 멈춥니다(launchd가 다시 띄우지 않음).
  on        state/public-off 파일을 지워 launchd가 전용 터널을 다시 기동하게 합니다.
  status    현재 스위치 상태와 터널 메트릭(127.0.0.1:20242/ready) 응답을 확인합니다.

옵션:
  -h, --help    이 도움말을 보여 줍니다.
EOF
}

case "${1:-}" in
  -h|--help|help|"")
    usage
    [ $# -eq 0 ] && exit 1 || exit 0
    ;;
esac

action="$1"
shift
[ $# -eq 0 ] || { echo "ERROR: 알 수 없는 추가 인자: $* (--help 참고)" >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"

[ "$(id -un)" = "$WE_SERVICE_USER" ] || we_die "$WE_SERVICE_USER 계정으로 실행해야 합니다: sh ops/we.sh public $action"
mkdir -p "$WE_STATE"

stop_we_tunnel_only() {
  pkill -TERM -u "$WE_SERVICE_USER" -f "cloudflared.*--config $WE_CLOUDFLARED/config\\.yml.*127\\.0\\.0\\.1:$WE_TUNNEL_METRICS_PORT" 2>/dev/null || true
}

case "$action" in
  off)
    touch "$WE_STATE/public-off"
    stop_we_tunnel_only
    echo "공개 연결을 껐습니다(외부 접속 차단, 맥 안 서버 4460과 데이터는 유지)."
    ;;
  on)
    [ -s "$WE_CLOUDFLARED/config.yml" ] || we_die "$WE_CLOUDFLARED/config.yml 이 없습니다 — 먼저 sh ops/we.sh tunnel-create 를 실행하세요"
    rm -f "$WE_STATE/public-off"
    ready=0
    i=0
    while [ "$i" -lt 15 ]; do
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$WE_TUNNEL_METRICS_PORT/ready" || echo 000)"
      if [ "$code" = "200" ]; then
        ready=1
        break
      fi
      sleep 1
      i=$((i + 1))
    done
    if [ "$ready" = "1" ]; then
      echo "공개 연결을 켰습니다 (127.0.0.1:$WE_TUNNEL_METRICS_PORT/ready HTTP 200)."
    else
      echo "state/public-off 를 해제했습니다. 터널 데몬이 아직 미설치면 sh ops/we.sh install-daemons tunnel 을 실행하세요."
    fi
    ;;
  status)
    sw="켜짐"
    [ -f "$WE_STATE/public-off" ] && sw="꺼짐 (state/public-off)"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$WE_TUNNEL_METRICS_PORT/ready" || echo 000)"
    echo "스위치: $sw · 터널 메트릭(127.0.0.1:$WE_TUNNEL_METRICS_PORT/ready): HTTP $code"
    ;;
  *)
    we_die "알 수 없는 명령: '$action' (on | off | status)"
    ;;
esac
