#!/bin/sh
# 쌤유 글방 릴리스 되돌리기 스크립트(서비스 계정 wesvc) — 이전 릴리스로 심볼릭 링크를 되돌리고 재시작·상태 확인을 수행한다.
#
# 왜 필요한가:
#   - 배포 직후 실패나 운영 중 회귀 발견 시 가장 빠르게 검증된 직전 릴리스로 앱 코드를 되돌린다(PLAN §15.4).
#   - DB(data/geulbang.sqlite)는 절대 되돌리지 않는다(앞으로만 가는 마이그레이션 + 배포 사전 호환 검사로 안전 보장).
# 안전장치:
#   - 수업 중 장애 복구에도 쓸 수 있도록 시간대 금지창을 두지 않는다(PLAN §15.4 예외).
#   - 맥미니의 다른 서비스·포트(4460 외 쌤유니버스·rollingthunder·터널 20241/20242)는 건드리지 않는다.
set -eu

usage() {
  cat <<'EOF'
사용법:
  sh ops/we.sh rollback [릴리스SHA또는경로]
  sudo -u wesvc -H sh ops/scripts/rollback.sh [릴리스SHA또는경로]

app 심볼릭 링크를 이전 릴리스로 되돌리고 운영 서버(4460)를 재시작한 뒤 healthcheck를 확인합니다.
규칙(PLAN §15.4): SQLite DB는 되돌리지 않습니다.

인자·옵션:
  릴리스SHA또는경로   되돌릴 대상 (생략 시 state/previous-release 또는 직전 빌드 완료 릴리스 자동 선택)
  --from-deploy       deploy.sh 내부 자동 롤백 호출용(이미 잡은 deploy 잠금을 재사용)
  -h, --help          이 도움말을 보여 줍니다.
EOF
}

from_deploy=0
requested=""

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help|help)
      usage
      exit 0
      ;;
    --from-deploy)
      from_deploy=1
      shift
      ;;
    --*)
      echo "ERROR: 알 수 없는 옵션: $1 (--help 참고)" >&2
      exit 1
      ;;
    *)
      [ -z "$requested" ] || { echo "ERROR: 대상 인자가 두 번 지정되었습니다: $1" >&2; exit 1; }
      requested="$1"
      shift
      ;;
  esac
done

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"

[ "$(id -un)" = "$WE_SERVICE_USER" ] || we_die "$WE_SERVICE_USER 계정으로 실행해야 합니다: sh ops/we.sh rollback"

if [ "$from_deploy" != "1" ]; then
  we_lock deploy || { echo "ERROR: 다른 배포 또는 되돌리기가 진행 중입니다" >&2; exit 75; }
fi

current_link="$(readlink "$WE_APP" 2>/dev/null || true)"
target_dir=""

if [ -n "$requested" ]; then
  case "$requested" in
    /*) target_dir="$requested" ;;
    releases/*) target_dir="$WE_HOME/$requested" ;;
    *) target_dir="$WE_RELEASES/$requested" ;;
  esac
else
  recorded_prev="$(we_previous_release)"
  if [ -n "$recorded_prev" ] && [ -d "$recorded_prev" ] && [ "$recorded_prev" != "$current_link" ]; then
    target_dir="$recorded_prev"
  else
    for cand in $(ls -1t "$WE_RELEASES" 2>/dev/null); do
      cand_dir="$WE_RELEASES/$cand"
      if [ "$cand_dir" != "$current_link" ] && [ -f "$cand_dir/.we-build-ok" ]; then
        target_dir="$cand_dir"
        break
      fi
    done
  fi
fi

[ -n "$target_dir" ] && [ -d "$target_dir" ] || we_die "되돌릴 이전 릴리스를 찾지 못했습니다"
[ -f "$target_dir/.we-build-ok" ] || we_die "빌드 완료 표시(.we-build-ok)가 없는 릴리스로는 되돌릴 수 없습니다: $target_dir"
[ -f "$target_dir/apps/server/dist/index.js" ] || we_die "서버 실행 파일이 없습니다: $target_dir/apps/server/dist/index.js"

target_sha="$(basename "$target_dir")"
echo "되돌리기 시작: ${current_link:-(없음)} -> $target_dir (DB는 되돌리지 않음, PLAN §15.4)"

printf 'RELEASE_ID=releases/%s\n' "$target_sha" > "$WE_STATE/release.env.tmp"
chmod 600 "$WE_STATE/release.env.tmp"
mv "$WE_STATE/release.env.tmp" "$WE_STATE/release.env"

ln -sfn "$target_dir" "$WE_APP"

server_plist="/Library/LaunchDaemons/com.ssamwrite.server.plist"
tunnel_plist="/Library/LaunchDaemons/com.ssamwrite.tunnel.plist"

if [ ! -f "$server_plist" ]; then
  printf 'releases/%s\n' "$target_sha" > "$WE_STATE/current-release"
  echo "링크 복귀 완료: releases/$target_sha (launchd 데몬은 아직 등록되지 않음)"
  exit 0
fi

we_restart_server

hc_script="$target_dir/ops/scripts/healthcheck.mjs"
[ -f "$hc_script" ] || hc_script="$here/healthcheck.mjs"

local_flag=""
if [ ! -f "$tunnel_plist" ] || [ -f "$WE_STATE/public-off" ]; then
  local_flag="--local-only"
fi

ok=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  sleep 2
  if [ -n "$local_flag" ]; then
    if "$NODE_BIN" "$hc_script" --local-only --expect-release "releases/$target_sha" --quiet 2>/dev/null; then
      ok=1
      break
    fi
  else
    if "$NODE_BIN" "$hc_script" --expect-release "releases/$target_sha" --quiet 2>/dev/null; then
      ok=1
      break
    fi
  fi
  attempt=$((attempt + 1))
done

if [ "$ok" != "1" ]; then
  echo "ERROR: 되돌린 릴리스(releases/$target_sha) 상태 확인 실패:" >&2
  if [ -n "$local_flag" ]; then
    "$NODE_BIN" "$hc_script" --local-only --expect-release "releases/$target_sha" >&2 || true
  else
    "$NODE_BIN" "$hc_script" --expect-release "releases/$target_sha" >&2 || true
  fi
  exit 1
fi

printf 'releases/%s\n' "$target_sha" > "$WE_STATE/current-release"
if [ "$from_deploy" != "1" ]; then
  we_notify "[Writeessay] rollback OK $target_sha" "rolled back to releases/$target_sha"
fi
echo "되돌리기 완료 및 상태 확인 통과: releases/$target_sha"
