#!/bin/sh
# 쌤유 글방 사용자 비밀값 숨김 저장 스크립트(서비스 계정 wesvc) — LLM API 키와 선생님 시작 코드를 화면 노출 없이 저장한다.
#
# 왜 필요한가:
#   - 터미널 기록·채팅·스크린샷에 비밀값이 남지 않도록 에코를 끄고 입력받아 형식만 검사한 뒤 secrets/app.env(600)에 기록한다.
#   - 출력에는 저장된 환경 변수 이름만 표시하고 값이나 일부 글자는 절대 출력하지 않는다(PLAN §13.2, §15.2).
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/we.sh save-secret <llm-api-key|teacher-start-code|stdict-api-key>

사용자가 직접 입력한 비밀값을 화면에 표시하지 않고
/Users/wesvc/writeessay-server/secrets/app.env(권한 600)에 저장합니다.

항목:
  llm-api-key          운영 서버용 ANTHROPIC_API_KEY (콘솔 월 한도 20달러 권장, 개발용 키와 분리)
  teacher-start-code   수업방 만들기용 TEACHER_START_CODE (정확히 숫자 8자리)
  stdict-api-key       표준국어대사전 Open API 인증 키 STDICT_API_KEY (16진수 32자리, 맞춤법 등급 보정용·선택)

옵션:
  --allow-skip         빈 줄(Enter) 입력 시 오류 대신 건너뜁니다(init-secrets 연동용).
  -h, --help           이 도움말을 보여 줍니다.
EOF
}

allow_skip=0
target=""

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help|help)
      usage
      exit 0
      ;;
    --allow-skip)
      allow_skip=1
      shift
      ;;
    llm-api-key|anthropic-api-key|teacher-start-code|start-code|stdict-api-key)
      target="$1"
      shift
      ;;
    *)
      echo "ERROR: 알 수 없는 인자: $1 (--help 참고)" >&2
      exit 1
      ;;
  esac
done

[ -n "$target" ] || { usage >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"

[ "$(id -un)" = "$WE_SERVICE_USER" ] || we_die "$WE_SERVICE_USER 계정으로 실행해야 합니다: sh ops/we.sh save-secret $target"
[ -f "$WE_ENV_FILE" ] || we_die "$WE_ENV_FILE 이 없습니다 — 먼저 sh ops/we.sh init-secrets 를 실행하세요"

case "$target" in
  llm-api-key|anthropic-api-key)
    env_key="ANTHROPIC_API_KEY"
    hint="Anthropic 콘솔에서 발급한 운영 서버 전용 API 키를 붙여넣으세요(개발·평가용 .local/dev.env 키와는 별도 키 권장)."
    ;;
  teacher-start-code|start-code)
    env_key="TEACHER_START_CODE"
    hint="선생님 시작 코드(정확히 숫자 8자리, PRD 12.3 TEACHER_START_CODE_LENGTH=8)를 입력하세요."
    ;;
  stdict-api-key)
    env_key="STDICT_API_KEY"
    hint="표준국어대사전 Open API에서 발급받은 인증 키(16진수 32자리)를 붙여넣으세요."
    ;;
esac

restore_tty() {
  if [ -t 0 ]; then
    stty echo 2>/dev/null || true
  fi
}
trap 'restore_tty' EXIT INT TERM HUP

echo "$hint"
printf "값 입력 후 Enter (화면에 표시되지 않음): "
if [ -t 0 ]; then
  stty -echo
fi
value=""
IFS= read -r value || [ -n "$value" ] || true
restore_tty
echo

# 앞뒤 공백·개행 제거
value="$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

if [ -z "$value" ]; then
  if [ "$allow_skip" = "1" ]; then
    echo "건너뜀: $env_key (나중에 sh ops/we.sh save-secret $target 으로 저장하세요)"
    exit 0
  fi
  we_die "빈 값은 저장할 수 없습니다"
fi

if [ "$env_key" = "STDICT_API_KEY" ]; then
  # 표준국어대사전 Open API 키는 16진수 32자리다(stdict.korean.go.kr 안내). 대소문자는 그대로 둔다.
  printf '%s' "$value" | grep -Eq '^[0-9A-Fa-f]{32}$' || we_die "STDICT_API_KEY는 16진수 32자리여야 합니다"
elif [ "$env_key" = "TEACHER_START_CODE" ]; then
  case "$value" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
    *) we_die "TEACHER_START_CODE는 숫자 8자리여야 합니다" ;;
  esac
else
  case "$value" in
    *[[:space:]]*|*[\'\"\`\$\\]*)
      we_die "API 키에 공백이나 따옴표·특수 이스케이프 문자가 들어갈 수 없습니다"
      ;;
  esac
fi

tmp="$WE_ENV_FILE.tmp"
umask 077
grep -v "^${env_key}=" "$WE_ENV_FILE" > "$tmp" || true
printf '%s=%s\n' "$env_key" "$value" >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$WE_ENV_FILE"
unset value

echo "저장 완료: $env_key (값은 출력하지 않음). 운영 서버가 실행 중이면 sh ops/we.sh restart 로 바로 반영합니다(수업 중 가능)."
