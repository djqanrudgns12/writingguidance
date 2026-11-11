#!/bin/sh
# 내부 대칭키를 값 노출 없이 회전하고 같은 배포 잠금 아래 앱 서버만 재시작한다.
# 닫힌 수업방도 만료 전에는 PIN으로 다시 열 수 있으므로 상태와 무관하게 만료 전 방 전체를 보호한다.
set +x
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/we.sh rotate-key <ID_HMAC_KEY|PIN_HMAC_KEY|PIN_ENC_KEY|PERSONAL_HMAC_KEY>

init-secrets와 같은 32바이트 무작위 base64 키로 해당 항목만 교체한 뒤 restart로 상태를 확인합니다.
PIN 키 둘은 운영 DB를 읽기 전용으로 확인해 만료 전 수업방(닫힌 방 포함)이 0개일 때만 허용합니다.
PERSONAL_HMAC_KEY는 보관 중인 개인 모드 자료가 없을 때만 허용합니다.
DB 없음·조회 실패는 교체를 거부하며 비밀값은 출력하지 않습니다.
교체 중에는 새 수업방을 만들지 말고 runbook 2.6의 점검 창 절차를 지키세요.
EOF
}

case "${1:-}" in
  -h|--help|help) usage; exit 0 ;;
esac
[ $# -eq 1 ] || { usage >&2; exit 1; }
key_name="$1"
case "$key_name" in
  ID_HMAC_KEY|PIN_HMAC_KEY|PIN_ENC_KEY|PERSONAL_HMAC_KEY) ;;
  *) echo "ERROR: 허용되지 않는 내부 키 이름입니다 (--help 참고)" >&2; exit 1 ;;
esac

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"

[ "$(id -un)" = "$WE_SERVICE_USER" ] || we_die "$WE_SERVICE_USER 계정으로 실행해야 합니다: sh ops/we.sh rotate-key"
[ -s "$WE_ENV_FILE" ] || we_die "운영 비밀값 파일이 없습니다 — 먼저 init-secrets를 실행하세요"
[ -f /Library/LaunchDaemons/com.ssamwrite.server.plist ] || we_die "앱 서버 데몬이 등록되어 있지 않아 교체 후 재시작할 수 없습니다"
[ -n "$(we_current_release)" ] || we_die "현재 릴리스 기록이 없어 교체 후 상태를 확인할 수 없습니다"
we_lock deploy || { echo "ERROR: 배포·되돌리기·재시작·키 교체 중입니다" >&2; exit 75; }

case "$key_name" in
  PIN_HMAC_KEY|PIN_ENC_KEY|PERSONAL_HMAC_KEY)
    [ -f "$WE_DB_PATH" ] || we_die "운영 DB가 없어 교체 조건을 확인할 수 없습니다"
    command -v sqlite3 >/dev/null 2>&1 || we_die "읽기 전용 확인에 필요한 sqlite3가 없습니다"
    if [ "$key_name" = "PERSONAL_HMAC_KEY" ]; then
      query='SELECT COUNT(*) FROM participants WHERE room_id IS NULL;'
      subject="보관 중인 개인 모드 자료"
    else
      # expires_at은 밀리초다. 초 단위 현재 시각은 최대 1초 더 보수적으로 만료를 판정한다.
      query="SELECT COUNT(*) FROM rooms WHERE expires_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000;"
      subject="만료 전 수업방(닫힌 방 포함)"
    fi
    count="$(sqlite3 -readonly "$WE_DB_PATH" "PRAGMA query_only = ON; $query" 2>/dev/null)" \
      || we_die "운영 DB 읽기 전용 조회 실패 — 키를 교체하지 않았습니다"
    case "$count" in
      0) ;;
      ''|*[!0-9]*) we_die "교체 조건 조회 결과가 올바르지 않습니다 — 키를 교체하지 않았습니다" ;;
      *) we_die "$subject ${count}개가 남아 있어 $key_name 교체를 거부합니다" ;;
    esac
    ;;
esac

# 임시 비밀값도 secrets 밖에 남기지 않고 다른 항목은 그대로 원자적으로 교체한다.
WE_TMP_DIR="$(mktemp -d "$WE_SECRETS/.rotate-key.XXXXXX")"
tmp="$WE_TMP_DIR/app.env"
awk -v key="$key_name" 'index($0, key "=") != 1 { print }' "$WE_ENV_FILE" > "$tmp"
key_value="$(openssl rand -base64 32)" || we_die "새 키 생성 실패 — 기존 키는 유지됩니다"
[ -n "$key_value" ] || we_die "새 키 생성 결과가 비어 있습니다 — 기존 키는 유지됩니다"
printf '%s=%s\n' "$key_name" "$key_value" >> "$tmp"
unset key_value
chmod 600 "$tmp"
mv "$tmp" "$WE_ENV_FILE"
rmdir "$WE_TMP_DIR"
WE_TMP_DIR=""

echo "교체 완료: $key_name (값은 출력하지 않음). 앱 서버 재시작 및 상태 확인을 이어갑니다."
# exec는 PID를 유지하므로 restart의 we_lock이 같은 잠금을 이어받고 종료 시 해제한다.
exec sh "$here/restart.sh"
