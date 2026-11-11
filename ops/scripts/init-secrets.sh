#!/bin/sh
# 쌤유 글방 운영 비밀값 초기화 스크립트(서비스 계정 wesvc) — 무작위 암호화·HMAC 키를 만들고 사용자 비밀값 입력을 안내한다.
#
# 왜 필요한가:
#   - 서버 설정(apps/server/src/config.ts, PLAN §13.2)이 요구하는 32바이트 base64 키들을 안전하게 생성해 secrets/app.env(600)에 저장한다.
#   - 이미 존재하는 키는 절대 덮어쓰지 않아 살아 있는 수업방의 PIN 검증·복호화가 깨지지 않게 지킨다.
#   - 사람이 정하는 값(ANTHROPIC_API_KEY, TEACHER_START_CODE)은 숨김 입력으로만 받으며 화면·로그에 비밀값을 절대 출력하지 않는다.
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/we.sh init-secrets [--no-prompt]

/Users/wesvc/writeessay-server/secrets/app.env(권한 600)를 준비하고,
아직 없는 내부 대칭키(PIN_HMAC_KEY, PIN_ENC_KEY, ID_HMAC_KEY, PERSONAL_HMAC_KEY)를
무작위 32바이트(base64)로 생성합니다. 이미 있는 키는 바꾸지 않습니다.

대화형 터미널에서는 아직 비어 있는 사용자 입력 항목(ANTHROPIC_API_KEY, TEACHER_START_CODE)도
화면에 표시되지 않는 숨김 입력으로 차례로 묻습니다(Enter만 치면 건너뛰고 나중에 save-secret으로 입력 가능).

옵션:
  --no-prompt   무작위 내부 키만 생성하고 대화형 입력 프롬프트는 건너뜁니다.
  -h, --help    이 도움말을 보여 줍니다.
EOF
}

no_prompt=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help|help)
      usage
      exit 0
      ;;
    --no-prompt)
      no_prompt=1
      shift
      ;;
    *)
      echo "ERROR: 알 수 없는 인자: $1 (--help 참고)" >&2
      exit 1
      ;;
  esac
done

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"

[ "$(id -un)" = "$WE_SERVICE_USER" ] || we_die "$WE_SERVICE_USER 계정으로 실행해야 합니다: sh ops/we.sh init-secrets"

mkdir -p "$WE_SECRETS"
chmod 700 "$WE_SECRETS"
touch "$WE_ENV_FILE"
chmod 600 "$WE_ENV_FILE"

added=""
add_if_missing() {
  key_name="$1"
  key_val="$2"
  if grep -q "^${key_name}=." "$WE_ENV_FILE"; then
    return 0
  fi
  grep -v "^${key_name}=" "$WE_ENV_FILE" > "$WE_ENV_FILE.tmp" || true
  printf '%s=%s\n' "$key_name" "$key_val" >> "$WE_ENV_FILE.tmp"
  chmod 600 "$WE_ENV_FILE.tmp"
  mv "$WE_ENV_FILE.tmp" "$WE_ENV_FILE"
  added="$added $key_name"
}

# apps/server/src/config.ts의 base64Key(32) 규격: 정확히 32바이트 무작위 값을 base64 인코딩한다.
for key in PIN_HMAC_KEY PIN_ENC_KEY ID_HMAC_KEY PERSONAL_HMAC_KEY; do
  add_if_missing "$key" "$(openssl rand -base64 32 | tr -d '\n')"
done

echo "파일 확인: $WE_ENV_FILE (권한 600, 값은 출력하지 않음)"
echo "새로 생성한 내부 키:${added:- 없음(모두 이미 존재)}"

# 대화형 터미널이면 아직 없는 외부 비밀값을 사용자가 직접 넣도록 묻는다(빈 줄이면 건너뜀).
if [ "$no_prompt" = "0" ] && [ -t 0 ] && [ -t 1 ]; then
  if ! grep -q '^ANTHROPIC_API_KEY=.' "$WE_ENV_FILE"; then
    echo
    echo "[입력 1/2] 운영 서버용 Anthropic API 키가 아직 없습니다 (나중에 넣으려면 그냥 Enter)."
    sh "$here/save-secret.sh" --allow-skip llm-api-key
  fi
  if ! grep -q '^TEACHER_START_CODE=.' "$WE_ENV_FILE"; then
    echo
    echo "[입력 2/2] 선생님 시작 코드(숫자 8자리)가 아직 없습니다 (나중에 넣으려면 그냥 Enter)."
    sh "$here/save-secret.sh" --allow-skip teacher-start-code
  fi
fi

present_keys="$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$WE_ENV_FILE" | tr '\n' ' ')"
missing=""
for req in PIN_HMAC_KEY PIN_ENC_KEY ID_HMAC_KEY ANTHROPIC_API_KEY TEACHER_START_CODE; do
  grep -q "^${req}=." "$WE_ENV_FILE" || missing="$missing $req"
done

echo "현재 등록된 키 이름: ${present_keys:-없음}"
if [ -n "$missing" ]; then
  echo "아직 입력이 필요한 키 이름:$missing"
  echo "  -> sh ops/we.sh save-secret llm-api-key"
  echo "  -> sh ops/we.sh save-secret teacher-start-code"
fi
