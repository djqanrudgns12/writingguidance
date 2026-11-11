#!/bin/sh
# 쌤유 글방 맥미니 호스트 준비 스크립트(관리자 권한 1회, 재실행 안전) — 전용 계정 wesvc·서버 폴더·Time Machine 제외·로그 회전을 설정한다.
#
# 왜 필요한가:
#   - 앱이 침해되더라도 권한을 비관리자 전용 계정(wesvc) 안에 가둬 소유자 파일·키체인·타 서비스 데이터와 격리한다(PLAN §15.1).
#   - 30일 자동 삭제·무백업 약속(PRD F-24)을 지키기 위해 서버 루트를 Time Machine 백업에서 제외하고 로그를 날마다 회전·7개만 보관한다.
# 안전장치:
#   - 맥미니에서 이미 돌고 있는 쌤유니버스(clsvc, 4390)·rollingthunder(rtsvc, 3000·8000·20241)·Colima·방화벽(pf)·FileVault는 일절 건드리지 않는다.
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/we.sh setup-host
   또는: sudo sh ops/scripts/setup-host.sh

전용 서비스 계정(wesvc), sudo 위임 규칙(/etc/sudoers.d/writeessay),
서버 폴더(/Users/wesvc/writeessay-server, 권한 700), Time Machine 백업 제외,
로그 회전(/etc/newsyslog.d/writeessay.conf, 날마다 회전·7개 보관)을 준비합니다.
여러 번 다시 실행해도 기존 데이터와 비밀값을 덮어쓰지 않습니다.

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

die() { echo "ERROR: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }

[ "$(id -u)" = "0" ] || die "관리자 권한이 필요합니다: sh ops/we.sh setup-host"
owner="${SUDO_USER:-}"
[ -n "$owner" ] || die "SUDO_USER가 없습니다 — 소유자 계정에서 sudo로 실행하세요"
case "$owner" in
  root|clsvc|rtsvc|wesvc)
    die "소유자 계정에서 실행해야 합니다 (현재 SUDO_USER=$owner)"
    ;;
esac

svc="${WE_SERVICE_USER:-wesvc}"
case "$svc" in
  clsvc|rtsvc|root|"")
    die "다른 서비스 계정($svc)은 사용할 수 없습니다 (wesvc 전용)"
    ;;
esac

here="$(cd "$(dirname "$0")" && pwd -P)"
ops_root="$(cd "$here/.." && pwd -P)"
svc_home="/Users/$svc"
we_home="$svc_home/writeessay-server"
log_keep="${WE_LOG_RETENTION_DAYS:-7}"
tool_path="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

as_svc() { sudo -u "$svc" -H env PATH="$tool_path" "$@"; }

# 서비스 계정은 소유자 홈(700)을 읽을 수 없으므로 작업 디렉터리를 /로 옮긴다.
cd /

step "0. 필수 도구 확인 (기존 설치만 확인, 업그레이드·재설치 안 함)"
node_bin="/opt/homebrew/opt/node@24/bin/node"
[ -x "$node_bin" ] || node_bin="$(PATH="$tool_path" command -v node 2>/dev/null || true)"
[ -n "$node_bin" ] && [ -x "$node_bin" ] || die "Node 24가 없습니다 (/opt/homebrew/opt/node@24/bin/node)"
node_ver="$("$node_bin" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$node_ver" = "24" ] || die "Node 24가 필요합니다 (현재: $("$node_bin" -v 2>/dev/null || echo 알 수 없음))"

for tool in npm git cloudflared openssl curl plutil tmutil; do
  PATH="$tool_path" command -v "$tool" >/dev/null 2>&1 || die "필수 도구가 없습니다: $tool"
done
echo "Node $("$node_bin" -v) · cloudflared · git · tmutil 확인 완료"

step "1. 전용 서비스 계정 $svc (비관리자·로그인 불가·숨김)"
if id "$svc" >/dev/null 2>&1; then
  echo "이미 있음: $svc"
else
  sysadminctl -addUser "$svc" -fullName "Writeessay Service" -shell /bin/zsh \
    -home "$svc_home" -password "$(openssl rand -base64 33)" >/dev/null 2>&1 || die "계정 생성 실패: $svc"
  createhomedir -c -u "$svc" >/dev/null 2>&1 || true
  echo "계정 생성 완료: $svc"
fi
dscl . -create "/Users/$svc" IsHidden 1
if dseditgroup -o checkmember -m "$svc" admin >/dev/null 2>&1; then
  die "$svc 계정이 admin 그룹에 속해 있습니다 — 보안을 위해 중단합니다"
fi
[ -d "$svc_home" ] || mkdir -p "$svc_home"
chown "$svc":staff "$svc_home"
chmod 700 "$svc_home"

step "2. sudo 위임 규칙 ($owner -> $svc 전용, root 아님)"
sudoers="/etc/sudoers.d/writeessay"
printf '# writeessay: 소유자가 전용 서비스 계정(%s)으로만 운영 명령 실행 (root 아님)\n%s ALL=(%s) NOPASSWD: ALL\n' \
  "$svc" "$owner" "$svc" > "$sudoers.tmp"
visudo -cf "$sudoers.tmp" >/dev/null || { rm -f "$sudoers.tmp"; die "sudoers 문법 검증 실패"; }
chown root:wheel "$sudoers.tmp"
chmod 440 "$sudoers.tmp"
mv "$sudoers.tmp" "$sudoers"
echo "등록 완료: $sudoers"

step "3. 서버 폴더 $we_home (권한 700, 타 계정 접근 차단)"
for sub in "" data secrets cloudflared logs state releases bundles aws bootstrap; do
  as_svc mkdir -p "$we_home/$sub"
done
as_svc chmod 700 \
  "$we_home" \
  "$we_home/data" \
  "$we_home/secrets" \
  "$we_home/cloudflared" \
  "$we_home/logs" \
  "$we_home/state" \
  "$we_home/releases" \
  "$we_home/bundles" \
  "$we_home/aws" \
  "$we_home/bootstrap"

# 첫 배포 전에 쓸 운영 스크립트·터널 틀 사본을 bootstrap에 넣어 둔다(배포 뒤에는 app/ops/scripts 우선).
rm -rf "$we_home/bootstrap/scripts" "$we_home/bootstrap/cloudflared"
cp -R "$ops_root/scripts" "$we_home/bootstrap/scripts"
cp -R "$ops_root/cloudflared" "$we_home/bootstrap/cloudflared"
chown -R "$svc":staff "$we_home/bootstrap"
chmod -R u=rwX,go= "$we_home/bootstrap"
echo "폴더 및 bootstrap 스크립트 준비 완료"

step "4. Time Machine 백업 제외 (PRD F-24 30일 삭제·무백업 보장)"
tmutil addexclusion -p "$we_home"
tm_status="$(tmutil isexcluded "$we_home")"
echo "$tm_status"
case "$tm_status" in
  *"[Excluded]"*) ;;
  *) die "Time Machine 제외 확인 실패: $tm_status" ;;
esac

step "5. 로그 회전 (/etc/newsyslog.d/writeessay.conf — 날마다 회전·${log_keep}개 보관·10MB 상한)"
cat > /etc/newsyslog.d/writeessay.conf.tmp <<EOF
# writeessay 운영 로그 회전: 날마다(24시간) 및 10MB 도달 시 회전, 최대 ${log_keep}개 보관(PLAN §7.6, §15.2)
# logfilename                                     [owner:group] mode count size(KB) when flags
$we_home/logs/*.log                               $svc:staff    600  $log_keep 10240 24   GNZ
EOF
chown root:wheel /etc/newsyslog.d/writeessay.conf.tmp
chmod 644 /etc/newsyslog.d/writeessay.conf.tmp
mv /etc/newsyslog.d/writeessay.conf.tmp /etc/newsyslog.d/writeessay.conf
echo "등록 완료: /etc/newsyslog.d/writeessay.conf"

step "완료"
echo "다음 단계: sh ops/we.sh init-secrets"
