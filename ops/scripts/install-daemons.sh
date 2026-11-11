#!/bin/sh
# 쌤유 글방 launchd 시스템 데몬 설치·제거 스크립트(관리자 권한) — com.ssamwrite.{server,tunnel,watch} 세 항목만 다룬다.
#
# 왜 필요한가:
#   - FileVault 잠금 해제 직후 GUI 로그인 없이 서비스 계정(wesvc)으로 앱 서버(4460)·터널(20242)·하트비트를 기동한다(PLAN §15.2).
# 안전장치:
#   - 라벨 접두사를 com.ssamwrite.*로 고정해 쌤유니버스(com.ssamuniverse.*)·rollingthunder(net.rollinthunder.*) 데몬을 절대 건드리지 않는다.
set -eu

usage() {
  cat <<'EOF'
사용법:
  sh ops/we.sh install-daemons <server|tunnel|watch ...>
  sh ops/we.sh install-daemons --remove <server|tunnel|watch ...>

launchd 시스템 데몬(/Library/LaunchDaemons/com.ssamwrite.<항목>.plist)을 등록하거나 제거합니다.

항목:
  server    글방 Node 24 운영 서버 (127.0.0.1:4460, Interactive, ExitTimeOut 30)
  tunnel    전용 cloudflared 터널 (메트릭 127.0.0.1:20242, Interactive, public-off 스위치 연동)
  watch     5분 주기 전체 경로 하트비트 (StartInterval 300 -> heartbeat.sh)

옵션:
  --remove      지정한 com.ssamwrite.<항목> 데몬을 내리고 plist를 삭제합니다.
  -h, --help    이 도움말을 보여 줍니다.
EOF
}

case "${1:-}" in
  -h|--help|help|"")
    usage
    [ $# -eq 0 ] && exit 1 || exit 0
    ;;
esac

die() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "관리자 권한이 필요합니다: sh ops/we.sh install-daemons $*"
svc="${WE_SERVICE_USER:-wesvc}"
case "$svc" in
  clsvc|rtsvc|root|"")
    die "허용되지 않는 서비스 계정입니다: $svc (wesvc 전용)"
    ;;
esac
id "$svc" >/dev/null 2>&1 || die "서비스 계정 $svc 가 없습니다 — 먼저 sh ops/we.sh setup-host 를 실행하세요"

we_home="/Users/$svc/writeessay-server"
src="$(cd "$(dirname "$0")/../launchd" && pwd -P)"

remove=0
if [ "${1:-}" = "--remove" ]; then
  remove=1
  shift
fi
[ $# -gt 0 ] || die "대상 항목을 지정하세요: server | tunnel | watch"

# 먼저 모든 인자가 허용된 세 이름 안에 있는지 검증한다.
for name in "$@"; do
  case "$name" in
    server|tunnel|watch) ;;
    *) die "알 수 없는 데몬 항목입니다: '$name' (허용: server tunnel watch)" ;;
  esac
done

for name in "$@"; do
  label="com.ssamwrite.$name"
  plist="/Library/LaunchDaemons/$label.plist"
  template="$src/$label.plist"
  [ -f "$template" ] || die "템플릿 파일이 없습니다: $template"

  if [ "$remove" = "1" ]; then
    launchctl bootout system "$plist" >/dev/null 2>&1 || true
    rm -f "$plist"
    echo "제거 완료: $label"
    continue
  fi

  # 크래시 루프를 막기 위해 필수 선행 파일이 준비되었는지 먼저 확인한다.
  if [ "$name" = "server" ]; then
    [ -s "$we_home/secrets/app.env" ] || die "$we_home/secrets/app.env 가 없습니다 — 먼저 init-secrets 를 실행하세요"
    [ -f "$we_home/app/apps/server/dist/index.js" ] || die "배포된 앱($we_home/app)이 없습니다 — 먼저 sh ops/we.sh deploy --init 을 실행하세요"
  fi
  if [ "$name" = "tunnel" ]; then
    [ -s "$we_home/cloudflared/config.yml" ] || die "$we_home/cloudflared/config.yml 이 없습니다 — 먼저 sh ops/we.sh tunnel-create 를 실행하세요"
  fi

  sed "s/__WE_USER__/$svc/g" "$template" > "$plist.tmp"
  chown root:wheel "$plist.tmp"
  chmod 644 "$plist.tmp"
  plutil -lint "$plist.tmp" >/dev/null

  launchctl bootout system "$plist" >/dev/null 2>&1 || true
  mv "$plist.tmp" "$plist"
  launchctl bootstrap system "$plist"
  echo "설치 완료: $label ($svc)"
done

launchctl list | grep 'com\.ssamwrite\.' || true
