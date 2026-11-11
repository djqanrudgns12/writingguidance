#!/bin/sh
# 쌤유 글방 운영 스크립트 공통 환경 — 경로·포트·원자적 잠금·알림·수업 시간 금지창 판정과 타 서비스 보호 장치를 모은다.
# 다른 스크립트가 `. "$(dirname "$0")/env.sh"`로 불러 쓰며, 직접 `--help`로 실행하면 설정 요약을 출력한다.
# 안전장치: 맥미니에서 함께 도는 쌤유니버스(clsvc, 4390)와 rollingthunder(rtsvc, 3000·8000·20241)의 계정·포트·터널을 절대 건드리지 않는다.
set -eu

we_env_usage() {
  cat <<'EOF'
사용법: sh ops/scripts/env.sh [--help]

글방 운영 스크립트가 공통으로 불러 쓰는 환경 설정 파일입니다.
  서비스 계정 : wesvc (clsvc·rtsvc·root 사용 금지)
  서버 루트   : /Users/wesvc/writeessay-server
  운영 포트   : 127.0.0.1:4460 (개발 4461·4462 및 타 서비스 포트 사용 금지)
  터널 메트릭 : 127.0.0.1:20242 (rollingthunder 20241과 분리)
  배포 금지창 : Asia/Seoul 월~금 08:00~16:00 (08:00~15:59)
EOF
}

if [ "$(basename "$0")" = "env.sh" ]; then
  case "${1:-}" in
    -h|--help|help|"")
      we_env_usage
      exit 0
      ;;
    *)
      echo "ERROR: env.sh는 다른 스크립트에서 source하여 사용합니다 (--help 참고)" >&2
      exit 1
      ;;
  esac
fi

WE_SERVICE_USER="${WE_SERVICE_USER:-wesvc}"
WE_HOME="${WE_HOME:-/Users/$WE_SERVICE_USER/writeessay-server}"
WE_APP="$WE_HOME/app"
WE_RELEASES="$WE_HOME/releases"
WE_DATA="$WE_HOME/data"
WE_DB_PATH="${WE_DB_PATH:-$WE_DATA/geulbang.sqlite}"
WE_SECRETS="$WE_HOME/secrets"
WE_ENV_FILE="$WE_SECRETS/app.env"
WE_CLOUDFLARED="$WE_HOME/cloudflared"
WE_LOGS="$WE_HOME/logs"
WE_STATE="$WE_HOME/state"
WE_BUNDLES="$WE_HOME/bundles"
WE_BOOTSTRAP="$WE_HOME/bootstrap"
WE_AWS_DIR="$WE_HOME/aws"

WE_PORT="${WE_PORT:-4460}"
WE_TUNNEL_METRICS_PORT="${WE_TUNNEL_METRICS_PORT:-20242}"
WE_PUBLIC_HOST="${WE_PUBLIC_HOST:-write.ssamuniverse.com}"
WE_PUBLIC_ORIGIN="${WE_PUBLIC_ORIGIN:-https://$WE_PUBLIC_HOST}"
WE_ORIGIN_HOST="${WE_ORIGIN_HOST:-origin-write.ssamuniverse.com}"
WE_TUNNEL_NAME="${WE_TUNNEL_NAME:-writeessay}"
WE_CF_DIST_ID="${WE_CF_DIST_ID:-E3TFCRGRU1HG1Q}"
# PRD 12.3 LOG_RETENTION_DAYS 기본값(7일)과 맞춘다.
WE_LOG_RETENTION_DAYS="${WE_LOG_RETENTION_DAYS:-7}"
WE_RELEASES_KEEP="${WE_RELEASES_KEEP:-5}"

export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
NODE_BIN="/opt/homebrew/opt/node@24/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || echo /opt/homebrew/bin/node)"
fi

umask 077

WE_LOCK_DIR=""
WE_TMP_DIR=""

we_die() {
  echo "ERROR: $*" >&2
  exit 1
}

# 타 서비스(쌤유니버스·rollingthunder·개발 포트) 침범을 원천 차단한다.
we_assert_safe_service() {
  case "$WE_SERVICE_USER" in
    wesvc) ;;
    clsvc|rtsvc|root|"")
      we_die "허용되지 않는 서비스 계정입니다: '$WE_SERVICE_USER' (wesvc 전용)"
      ;;
    *)
      case "$WE_SERVICE_USER" in
        *[!a-z0-9_-]*) we_die "서비스 계정 이름 형식이 잘못되었습니다: '$WE_SERVICE_USER'" ;;
      esac
      ;;
  esac

  case "$WE_PORT" in
    3000|8000|20241|4390|4317|4318|4380|4401|4461|4462|5173)
      we_die "포트 $WE_PORT 는 맥미니의 다른 서비스 또는 개발 서버가 쓰므로 건드릴 수 없습니다 (운영 포트는 4460)"
      ;;
  esac

  case "$WE_TUNNEL_METRICS_PORT" in
    20241|3000|8000|4390|4460)
      we_die "터널 메트릭 포트 $WE_TUNNEL_METRICS_PORT 는 다른 서비스와 겹칩니다 (20242 사용)"
      ;;
  esac
}

we_assert_safe_service

we_cleanup_all() {
  if [ -n "${WE_TMP_DIR:-}" ] && [ -d "$WE_TMP_DIR" ]; then
    rm -rf "$WE_TMP_DIR"
  fi
  if [ -n "${WE_LOCK_DIR:-}" ] && [ -d "$WE_LOCK_DIR" ]; then
    rm -rf "$WE_LOCK_DIR"
  fi
}

we_register_exit_trap() {
  trap 'we_cleanup_all' EXIT
  trap 'exit 130' INT TERM HUP
}

we_mktemp_dir() {
  WE_TMP_DIR="$(mktemp -d)"
  we_register_exit_trap
}

# 원자적 디렉터리 잠금(mkdir). 이미 죽은 PID나 180분 넘은 묵은 잠금은 회수한다.
we_lock() {
  lock_target="$WE_STATE/$1.lock"
  mkdir -p "$WE_STATE"
  if ! mkdir "$lock_target" 2>/dev/null; then
    holder="$(cat "$lock_target/pid" 2>/dev/null || true)"
    fresh="$(find "$lock_target" -maxdepth 0 -mmin -180 2>/dev/null || true)"
    if [ -n "$holder" ] && [ -n "$fresh" ] && kill -0 "$holder" 2>/dev/null; then
      # rotate-key가 같은 PID로 restart를 exec할 때만 기존 잠금을 이어받아 교체·재시작을 한 작업으로 지킨다.
      if [ "$holder" = "$$" ]; then
        WE_LOCK_DIR="$lock_target"
        we_register_exit_trap
        return 0
      fi
      return 1
    fi
    rm -rf "$lock_target"
    mkdir "$lock_target" 2>/dev/null || return 1
  fi
  echo "$$" > "$lock_target/pid"
  WE_LOCK_DIR="$lock_target"
  we_register_exit_trap
  return 0
}

# 한국 시각(Asia/Seoul) 기준 평일(월~금) 08:00~15:59(08:00 이상 16:00 미만)이면 0(금지창)을 돌려준다(PLAN §15.2, §15.4).
we_is_school_hours() {
  kst_now="${WE_TEST_KST_DOW_HOUR:-$(TZ=Asia/Seoul date '+%u:%H')}"
  case "$kst_now" in
    [1-5]:08|[1-5]:09|[1-5]:1[0-5])
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

we_current_release() {
  cat "$WE_STATE/current-release" 2>/dev/null || true
}

we_previous_release() {
  cat "$WE_STATE/previous-release" 2>/dev/null || true
}

# wesvc 계정의 글방 운영 서버 프로세스(4460)에만 SIGTERM을 보내 launchd(KeepAlive)가 다시 띄우게 한다.
# 쌤유니버스(clsvc), rollingthunder(rtsvc), 개발 서버(소유자 4461), 터널(cloudflared 20242)은 계정과 명령줄이 모두 달라 건드리지 않는다.
we_restart_server() {
  [ "$(id -un)" = "$WE_SERVICE_USER" ] || we_die "서버 재시작은 $WE_SERVICE_USER 계정에서만 실행할 수 있습니다"
  pkill -TERM -u "$WE_SERVICE_USER" -f "env-file=$WE_ENV_FILE.*apps/server/dist/index\\.js" 2>/dev/null || true
}

# SNS 운영 알림 발송(aws/setup-ops.sh 설정 후 동작). 미설정·전송 실패가 배포/복구를 막지 않도록 기록만 남긴다.
we_notify() {
  subject="$1"
  body="$2"
  topic="$(cat "$WE_AWS_DIR/alerts-topic" 2>/dev/null || true)"
  creds="$WE_SECRETS/aws-macmini-credentials"
  if [ -z "$topic" ] || [ ! -s "$creds" ]; then
    echo "알림 미설정(aws/setup-ops.sh 전): $subject" >&2
    return 0
  fi
  AWS_SHARED_CREDENTIALS_FILE="$creds" AWS_CONFIG_FILE=/dev/null \
    aws sns publish --region us-east-1 --topic-arn "$topic" --subject "$subject" --message "$body" >/dev/null 2>&1 \
    || echo "알림 메일 전송 실패: $subject" >&2
}
