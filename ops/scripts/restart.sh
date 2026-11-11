#!/bin/sh
# 쌤유 글방 앱 서버만 다시 시작하는 스크립트(서비스 계정 wesvc) — 릴리스·DB·터널은 그대로 두고 서버 프로세스만 새로 띄운다.
#
# 왜 필요한가:
#   - 수업 중 운영 API 키 교체(save-secret 뒤 반영)나 멈춘 서버 복구는 배포(수업 시간 금지)·되돌리기 없이 해야 한다.
#   - 열린 글은 SIGTERM을 받은 서버가 끝내기 순서(PLAN §7.1-6)로 저장한 뒤 내려가고, launchd(KeepAlive)가 다시 띄운다.
# 안전장치:
#   - 되돌리기처럼 수업 중 장애 복구용이라 시간대 금지창을 두지 않는다(PLAN §15.4 예외와 같은 이유).
#   - 배포·되돌리기와 같은 잠금을 잡아 동시에 돌지 않는다.
#   - 맥미니의 다른 서비스·포트(쌤유니버스·rollingthunder·개발 서버 4461·터널)는 건드리지 않는다(we_restart_server 참고).
set -eu

usage() {
  cat <<'USAGE'
사용법:
  sh ops/we.sh restart
  sudo -u wesvc -H sh ops/scripts/restart.sh

운영 서버(4460)만 다시 시작하고 지금 릴리스로 healthcheck를 확인합니다. 릴리스·DB·터널은 바꾸지 않습니다.
USAGE
}

case "${1:-}" in
  -h|--help|help) usage; exit 0 ;;
  "") ;;
  *) echo "ERROR: 알 수 없는 인자: $1 (--help 참고)" >&2; exit 1 ;;
esac

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"

[ "$(id -un)" = "$WE_SERVICE_USER" ] || we_die "$WE_SERVICE_USER 계정으로 실행해야 합니다: sh ops/we.sh restart"
[ -f /Library/LaunchDaemons/com.ssamwrite.server.plist ] || we_die "앱 서버 데몬이 등록되어 있지 않습니다: sh ops/we.sh install-daemons server"

we_lock deploy || { echo "ERROR: 배포 또는 되돌리기가 진행 중입니다" >&2; exit 75; }

release="$(we_current_release)"
[ -n "$release" ] || we_die "지금 릴리스 기록(state/current-release)이 없습니다"
current_link="$(readlink "$WE_APP" 2>/dev/null || true)"
hc_script="$current_link/ops/scripts/healthcheck.mjs"
[ -f "$hc_script" ] || hc_script="$here/healthcheck.mjs"

local_flag=""
if [ ! -f /Library/LaunchDaemons/com.ssamwrite.tunnel.plist ] || [ -f "$WE_STATE/public-off" ]; then
  local_flag="--local-only"
fi

echo "앱 서버 다시 시작: $release (릴리스·DB·터널은 그대로)"
we_restart_server

ok=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  sleep 2
  # local_flag는 비어 있거나 옵션 하나라 따옴표 없이 펼친다.
  # shellcheck disable=SC2086
  if "$NODE_BIN" "$hc_script" $local_flag --expect-release "$release" --quiet 2>/dev/null; then
    ok=1
    break
  fi
  attempt=$((attempt + 1))
done

if [ "$ok" != "1" ]; then
  echo "ERROR: 다시 시작한 서버 상태 확인 실패:" >&2
  # shellcheck disable=SC2086
  "$NODE_BIN" "$hc_script" $local_flag --expect-release "$release" >&2 || true
  we_notify "[Writeessay] restart FAILED" "server restart health check failed on $release"
  exit 1
fi

echo "다시 시작 완료 및 상태 확인 통과: $release"
