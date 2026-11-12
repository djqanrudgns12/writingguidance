#!/bin/sh
# 쌤유 글방 전용 Cloudflare 터널 생성·설정 스크립트(소유자 계정 실행) — writeessay 터널을 만들고 자격 증명·config.yml을 wesvc에 넘긴다.
#
# 왜 필요한가:
#   - 공유기 인바운드 포트를 열지 않고 맥이 밖으로만 연결하는 전용 암호화 통로를 준비한다(PLAN §2.1, §15.2).
# 안전장치:
#   - 소유자 인증서 보관소를 ~/.writeessay-admin/cloudflared로 분리해 rollingthunder(~/.cloudflared)와
#     쌤유니버스(~/.classlearning-admin/cloudflared)의 Cloudflare 설정·터널(20241 등)을 절대 건드리지 않는다.
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/we.sh tunnel-create [--domain <도메인>]

소유자 계정에서 Cloudflare에 로그인해 전용 터널 'writeessay'를 만들고,
'origin-write.<도메인>'(기본: ssamuniverse.com) DNS를 연결한 뒤,
터널 자격 증명 JSON과 config.yml을 서비스 계정(wesvc)의
/Users/wesvc/writeessay-server/cloudflared/(권한 600)에 저장하고 ingress 규칙을 검증합니다.

옵션:
  --domain <도메인>   상위 도메인 이름 (기본: ssamuniverse.com -> origin-write.ssamuniverse.com)
  -h, --help          이 도움말을 보여 줍니다.
EOF
}

domain="ssamuniverse.com"
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help|help)
      usage
      exit 0
      ;;
    --domain)
      [ $# -ge 2 ] || { echo "ERROR: --domain 뒤에 도메인을 주세요" >&2; exit 1; }
      domain="$2"
      shift 2
      ;;
    *)
      echo "ERROR: 알 수 없는 인자: $1 (--help 참고)" >&2
      exit 1
      ;;
  esac
done

case "$domain" in
  *[!a-z0-9.-]*|"")
    echo "ERROR: 올바른 도메인 형식이 아닙니다: $domain" >&2
    exit 1
    ;;
esac

here="$(cd "$(dirname "$0")" && pwd -P)"
ops_root="$(cd "$here/.." && pwd -P)"
. "$here/env.sh"

[ "$(id -u)" != "0" ] || we_die "root가 아닌 소유자 계정에서 실행하세요: sh ops/we.sh tunnel-create"
[ "$(id -un)" != "$WE_SERVICE_USER" ] || we_die "소유자 계정에서 실행하세요: sh ops/we.sh tunnel-create"
id "$WE_SERVICE_USER" >/dev/null 2>&1 || we_die "서비스 계정($WE_SERVICE_USER)이 없습니다 — 먼저 sh ops/we.sh setup-host 를 실행하세요"

cf_bin="/opt/homebrew/bin/cloudflared"
[ -x "$cf_bin" ] || cf_bin="$(command -v cloudflared 2>/dev/null || true)"
[ -n "$cf_bin" ] && [ -x "$cf_bin" ] || we_die "cloudflared가 설치되어 있지 않습니다"

template="$ops_root/cloudflared/config.template.yml"
[ -f "$template" ] || we_die "터널 설정 틀이 없습니다: $template"

admin_dir="$HOME/.writeessay-admin"
cf_home="$admin_dir/cloudflared"
mkdir -p "$cf_home"
chmod 700 "$admin_dir" "$cf_home"

cf() { HOME="$cf_home" "$cf_bin" "$@"; }
as_svc() { (cd / && sudo -u "$WE_SERVICE_USER" -H "$@"); }

if [ ! -s "$cf_home/.cloudflared/cert.pem" ]; then
  echo "브라우저가 열리면 Cloudflare에 로그인하고 도메인 목록에서 '$domain'을 골라 Authorize를 누르세요."
  cf tunnel login
fi

if ! cf tunnel info "$WE_TUNNEL_NAME" >/dev/null 2>&1; then
  echo "전용 터널 생성: $WE_TUNNEL_NAME"
  cf tunnel create "$WE_TUNNEL_NAME" >/dev/null
else
  echo "전용 터널 확인: $WE_TUNNEL_NAME (이미 있음)"
fi

tunnel_id="$(cf tunnel list --output json | "$NODE_BIN" -e '
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", c => (raw += c));
  process.stdin.on("end", () => {
    const name = process.argv[1];
    const items = JSON.parse(raw || "[]");
    // 지우지 않은 터널도 deleted_at에 0001-01-01T00:00:00Z(빈 시각)가 들어 온다(2026-11-12 실제 응답).
    const alive = t => !t.deleted_at || String(t.deleted_at).startsWith("0001-01-01");
    const found = items.find(t => t && t.name === name && alive(t));
    if (!found || !found.id) process.exit(1);
    process.stdout.write(String(found.id));
  });
' "$WE_TUNNEL_NAME")" || we_die "터널 '$WE_TUNNEL_NAME'의 ID를 조회하지 못했습니다"

case "$tunnel_id" in
  *[!0-9a-fA-F-]*|"")
    we_die "터널 ID 형식이 올바르지 않습니다: $tunnel_id"
    ;;
esac

cred_src="$cf_home/.cloudflared/$tunnel_id.json"
[ -s "$cred_src" ] || we_die "자격 증명 파일이 없습니다: $cred_src (이 맥에서 만든 터널인지 확인하세요)"

origin_host="origin-write.$domain"
public_host="write.$domain"

if cf tunnel route dns "$WE_TUNNEL_NAME" "$origin_host"; then
  echo "DNS 연결 완료: $origin_host -> 터널 $WE_TUNNEL_NAME (프록시 켬)"
else
  echo "주의: $origin_host DNS 레코드가 이미 있거나 자동 등록되지 않았습니다 — Cloudflare DNS에서 $tunnel_id.cfargotunnel.com을 가리키는지 확인하세요." >&2
fi

cred_dest="$WE_CLOUDFLARED/$tunnel_id.json"
cfg_dest="$WE_CLOUDFLARED/config.yml"

# 자격 증명 JSON은 화면이나 명령줄에 노출하지 않고 표준 입력으로만 wesvc에 전달한다.
as_svc sh -c 'umask 077; mkdir -p "$1"; cat > "$2.tmp" && chmod 600 "$2.tmp" && mv "$2.tmp" "$2"' \
  sh "$WE_CLOUDFLARED" "$cred_dest" < "$cred_src"

sed \
  -e "s/__TUNNEL_ID__/$tunnel_id/g" \
  -e "s/__WE_USER__/$WE_SERVICE_USER/g" \
  -e "s/origin-write\\.ssamuniverse\\.com/$origin_host/g" \
  -e "s/write\\.ssamuniverse\\.com/$public_host/g" \
  "$template" | as_svc sh -c 'umask 077; cat > "$1.tmp" && chmod 600 "$1.tmp" && mv "$1.tmp" "$1"' sh "$cfg_dest"

echo "터널 설정 파일 검증 중 (ingress validate)..."
as_svc "$cf_bin" tunnel --config "$cfg_dest" ingress validate

internal_rule="$(as_svc "$cf_bin" tunnel --config "$cfg_dest" ingress rule "https://$origin_host/internal/health" 2>&1 || true)"
case "$internal_rule" in
  *"http_status:404"*) ;;
  *) we_die "/internal/* 차단 규칙 검증 실패: $internal_rule" ;;
esac

app_rule="$(as_svc "$cf_bin" tunnel --config "$cfg_dest" ingress rule "https://$origin_host/api/health" 2>&1 || true)"
case "$app_rule" in
  *"http://127.0.0.1:4460"*) ;;
  *) we_die "앱 라우팅 규칙 검증 실패: $app_rule" ;;
esac

echo "완료: 터널 '$WE_TUNNEL_NAME' ($tunnel_id) 설정 저장 및 검증 통과 (자격 증명 값은 출력하지 않음)"
echo "다음 단계: sh ops/we.sh install-daemons tunnel"
