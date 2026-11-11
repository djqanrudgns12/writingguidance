#!/bin/sh
# 쌤유 글방 운영 단일 진입점 스크립트 — 소유자 계정에서 모든 운영 작업을 권한에 맞춰 안전하게 위임 실행한다.
#
# 왜 필요한가:
#   - 관리자 권한(setup-host, install-daemons), 소유자 전용 비밀 관리(origin-secret, tunnel-create, git bundle 생성),
#     서비스 계정(wesvc) 실행(init-secrets, deploy, rollback, status, public 등)을 cl.sh처럼 명령 하나로 묶는다(PLAN §15.2).
# 안전장치:
#   - 무거운 배포 빌드는 resource-guard(--profile build)로 감싸 맥미니 자원을 보호한다(AGENTS.md §4, PLAN §15.4).
#   - 맥미니의 다른 서비스(쌤유니버스 4390, rollingthunder 3000·8000·20241)는 절대 건드리지 않는다.
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/we.sh <명령> [인자...]

쌤유 글방 맥미니 자체 호스팅 운영 명령 입구입니다(저장소 루트에서 소유자 계정으로 실행).

관리자 권한(내부에서 sudo 호출):
  setup-host                        전용 계정 wesvc · 폴더(700) · Time Machine 제외 · 로그 회전 준비
  install-daemons <항목...>         launchd 등록: server | tunnel | watch (제거: --remove <항목...>)

소유자 계정 직접 실행(관리용 비밀은 서비스 계정에 두지 않음):
  origin-secret [--rotate]          원본 잠금 값(64자) 생성·복사, 회전 시 이전 값은 .prev로 보존(화면 미출력)
  tunnel-create [--domain <도메인>] 전용 터널 writeessay 생성 · DNS 연결 · wesvc 자격 증명 저장 · 검증
  emergency <status|on|off> [옵션]  CloudFront WAF 공격 대응 모드 조회·전환(AWS 소유자 로그인 필요)

번들 생성 후 서비스 계정(wesvc)으로 위임 실행:
  deploy [ref] [--init] [--bundle <파일>]
                                    HEAD·브랜치·태그·커밋 해시를 번들로 배포(평일 08~16시 KST 거부)

서비스 계정(wesvc)으로 실행(sudo 규칙으로 비밀번호 없이, root 아님):
  init-secrets [--no-prompt]        내부 대칭키 4종 무작위 생성 + 사용자 비밀값 숨김 입력 안내
  save-secret <이름>                llm-api-key | teacher-start-code 숨김 입력 저장(출력에 값 금지)
  rotate-key <키 이름>              내부 대칭키 회전 후 restart(PIN 키는 만료 전 수업방 0개일 때만)
  db-check                          운영 DB 읽기 전용 integrity_check · quick_check(자동 복구 없음)
  rollback [릴리스]                 이전 릴리스로 링크 복귀 + 재시작 + 상태 확인(DB는 되돌리지 않음)
  restart                           앱 서버(4460)만 다시 시작 + 상태 확인(릴리스·DB·터널 그대로, 수업 중 가능)
  healthcheck [옵션]                ① 로컬 /internal/health ② 공개 API ③ 공개 wss ④ 원본 403 확인
  heartbeat                         5분 감시 1회 수동 실행(전체 성공 시에만 EndToEndOK=1)
  status                            릴리스 목록·서버 볼륨 공간·터널·공개 경로·감시 설정 보기
  public <on|off|status>            외부 터널 연결만 켜기·끄기(맥 안 서버 4460과 데이터는 유지)
  logs [server|tunnel|watch|deploy|build] [--follow|-f]
                                    최근 운영 로그 확인, --follow로 계속 추적(Ctrl+C 종료)

옵션:
  -h, --help, help                  이 도움말을 보여 줍니다.
EOF
}

here="$(cd "$(dirname "$0")" && pwd -P)"
repo_root="$(cd "$here/.." && pwd -P)"
svc="${WE_SERVICE_USER:-wesvc}"
case "$svc" in
  clsvc|rtsvc|root|"")
    echo "ERROR: 허용되지 않는 서비스 계정입니다: $svc (wesvc 전용)" >&2
    exit 1
    ;;
esac

we_home="/Users/$svc/writeessay-server"
admin_dir="$HOME/.writeessay-admin"
node_bin="/opt/homebrew/opt/node@24/bin/node"
[ -x "$node_bin" ] || node_bin="$(command -v node 2>/dev/null || echo /opt/homebrew/bin/node)"
rg_bin="/Users/bodyking/.local/bin/resource-guard"

cmd="${1:-help}"
[ $# -gt 0 ] && shift

die() { echo "ERROR: $*" >&2; exit 1; }
as_svc() { (cd / && sudo -u "$svc" -H "$@"); }
need_svc() { id "$svc" >/dev/null 2>&1 || die "서비스 계정($svc)이 없습니다 — 먼저: sh ops/we.sh setup-host"; }

svc_scripts_dir() {
  if as_svc test -f "$we_home/app/ops/scripts/$1"; then
    echo "$we_home/app/ops/scripts"
  elif as_svc test -f "$we_home/bootstrap/scripts/$1"; then
    echo "$we_home/bootstrap/scripts"
  else
    die "서버에 $1 스크립트가 없습니다 — sh ops/we.sh setup-host 를 다시 실행하세요"
  fi
}

case "$cmd" in
  help|-h|--help)
    usage
    ;;
  setup-host|install-daemons)
    for arg in "$@"; do
      case "$arg" in
        -h|--help|help)
          exec sh "$here/scripts/$cmd.sh" --help
          ;;
      esac
    done
    [ "$(id -u)" != "0" ] || die "sudo 없이 소유자 계정에서 실행하세요(내부에서 sudo를 부릅니다)"
    exec sudo sh "$here/scripts/$cmd.sh" "$@"
    ;;
  origin-secret)
    if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
      echo "사용법: sh ops/we.sh origin-secret [--rotate]"
      echo "CloudFront 원본 머리(x-we-origin-auth)와 Cloudflare WAF 잠금 규칙에 넣을 64자 비밀값을 클립보드에만 복사합니다."
      echo "--rotate: 새 값을 생성하고 이전 값은 cloudfront-origin-secret.prev(600)에 보존합니다. .prev가 이미 있으면 거부합니다."
      echo "회전 순서: Cloudflare WAF에 이전·새 값 모두 허용 -> CloudFront 원본 머리 갱신 -> Deployed 대기 -> Cloudflare에서 이전 값 제거."
      printf '%s\n' "이전 값 복사: tr -d '\\n' < ~/.writeessay-admin/cloudfront-origin-secret.prev | pbcopy (화면 출력 금지)"
      echo "완료 후 healthcheck를 확인하고 .prev를 수동 파기하세요. 전파 중에는 --rotate를 다시 실행하지 마세요(runbook 2.6)."
      exit 0
    fi
    rotate=0
    if [ "${1:-}" = "--rotate" ]; then
      rotate=1
      shift
    fi
    [ $# -eq 0 ] || die "알 수 없는 인자: $*"
    command -v pbcopy >/dev/null 2>&1 || die "pbcopy가 없습니다(맥미니 소유자 터미널에서 실행하세요)"
    umask 077
    mkdir -p "$admin_dir"
    chmod 700 "$admin_dir"
    secret_file="$admin_dir/cloudfront-origin-secret"
    origin_lock="$admin_dir/origin-secret.lock"
    mkdir "$origin_lock" 2>/dev/null || die "다른 origin-secret 작업이 진행 중입니다(중단된 작업이면 잠금을 수동 확인하세요)"
    origin_tmp=""
    cleanup_origin() {
      if [ -n "$origin_tmp" ]; then rm -f "$origin_tmp"; fi
      rmdir "$origin_lock"
    }
    trap 'cleanup_origin' EXIT
    trap 'exit 130' INT TERM HUP
    if [ "$rotate" = "1" ]; then
      [ -s "$secret_file" ] || die "이전 원본 잠금 값이 없습니다 — 먼저 origin-secret으로 초기화하세요"
      [ ! -e "$secret_file.prev" ] && [ ! -L "$secret_file.prev" ] \
        || die ".prev가 이미 있습니다 — 진행 중인 회전을 마치고 이전 값 파기 여부를 확인하세요"
    fi
    if [ "$rotate" = "1" ] || [ ! -s "$secret_file" ]; then
      origin_tmp="$(mktemp "$admin_dir/.origin-secret.XXXXXX")"
      openssl rand -hex 32 > "$origin_tmp"
      chmod 600 "$origin_tmp"
      if [ "$rotate" = "1" ]; then
        cp "$secret_file" "$secret_file.prev"
        chmod 600 "$secret_file.prev"
      fi
      mv "$origin_tmp" "$secret_file"
      origin_tmp=""
    fi
    chmod 600 "$secret_file"
    tr -d '\n' < "$secret_file" | pbcopy
    echo "원본 잠금 값을 클립보드에 복사했습니다(64자, 화면에 표시하지 않음). 보관 위치: $secret_file"
    echo "사용처: ① CloudFront 원본 사용자 지정 헤더 x-we-origin-auth (aws/setup-ops.sh 자동 읽음) ② Cloudflare WAF 규칙 we-origin-lock"
    if [ "$rotate" = "1" ]; then
      echo "이전 값 보존: $secret_file.prev (600). Cloudflare 양쪽 값 허용 -> CloudFront 갱신·Deployed 대기 -> Cloudflare 이전 값 제거(runbook 2.6)."
    fi
    ;;
  tunnel-create)
    exec sh "$here/scripts/tunnel-create.sh" "$@"
    ;;
  emergency)
    exec sh "$here/cloudfront/emergency.sh" "$@"
    ;;
  deploy)
    for arg in "$@"; do
      case "$arg" in
        -h|--help|help)
          exec sh "$here/scripts/deploy.sh" --help
          ;;
      esac
    done
    need_svc
    [ "$(id -u)" != "0" ] || die "root가 아닌 소유자 계정에서 실행하세요: sh ops/we.sh deploy"

    # 평일 08:00~16:00 KST 금지창을 번들 생성 전에도 먼저 차단한다(deploy.sh 안에서도 다시 차단).
    kst_now="$(TZ=Asia/Seoul date '+%u:%H')"
    case "$kst_now" in
      [1-5]:08|[1-5]:09|[1-5]:1[0-5])
        die "평일 08:00~16:00 KST(수업 시간 금지창)에는 배포할 수 없습니다 (강제 실행 불가)"
        ;;
    esac

    user_bundle=""
    init_flag=""
    deploy_ref=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --bundle)
          [ $# -ge 2 ] || die "--bundle 뒤에 파일 경로를 주세요"
          user_bundle="$2"
          shift 2
          ;;
        --init)
          init_flag="--init"
          shift
          ;;
        --*)
          die "지원하지 않는 옵션입니다: $1 (sh ops/we.sh deploy --help 참고)"
          ;;
        *)
          [ -z "$deploy_ref" ] || die "참조(ref) 인자가 두 번 지정되었습니다: $1"
          deploy_ref="$1"
          shift
          ;;
      esac
    done
    deploy_ref="${deploy_ref:-HEAD}"

    tmp_bundle=""
    tmp_ref=""
    bundle_sha=""
    cleanup_bundle() {
      if [ -n "$tmp_ref" ]; then
        git -C "$repo_root" update-ref -d "$tmp_ref" "$bundle_sha"
        tmp_ref=""
      fi
      if [ -n "$tmp_bundle" ] && [ -f "$tmp_bundle" ]; then rm -f "$tmp_bundle"; fi
    }
    trap 'cleanup_bundle' EXIT
    trap 'exit 130' INT TERM HUP

    if [ -n "$user_bundle" ]; then
      [ -s "$user_bundle" ] || die "번들 파일이 없습니다: $user_bundle"
      git bundle verify "$user_bundle" >/dev/null 2>&1 || die "유효하지 않은 git bundle 파일입니다: $user_bundle"
      bundle_src="$user_bundle"
    else
      [ -d "$repo_root/.git" ] || die "Git 저장소가 아닙니다: $repo_root (--bundle <파일> 을 지정하세요)"
      bundle_sha="$(git -C "$repo_root" rev-parse --verify --end-of-options "$deploy_ref^{commit}" 2>/dev/null)" \
        || die "저장소에 커밋 '$deploy_ref'가 없습니다(먼저 커밋이 있어야 git bundle을 만들 수 있습니다)"
      tmp_bundle="$(mktemp "${TMPDIR:-/tmp}/geulbang-deploy.XXXXXX.bundle")"
      # 브랜치·태그·HEAD는 기존 참조를 그대로 쓴다. 원시 SHA에는 아래에서 임시 bundle head를 만든다.
      if sym_ref="$(git -C "$repo_root" symbolic-ref -q "$deploy_ref" 2>/dev/null)"; then
        git -C "$repo_root" bundle create "$tmp_bundle" "$sym_ref" >/dev/null 2>&1
        deploy_ref="$sym_ref"
      elif git -C "$repo_root" show-ref --verify --quiet "refs/heads/$deploy_ref"; then
        git -C "$repo_root" bundle create "$tmp_bundle" "refs/heads/$deploy_ref" >/dev/null 2>&1
      elif git -C "$repo_root" show-ref --verify --quiet "refs/tags/$deploy_ref"; then
        git -C "$repo_root" bundle create "$tmp_bundle" "refs/tags/$deploy_ref" >/dev/null 2>&1
      elif [ "$deploy_ref" = "HEAD" ]; then
        git -C "$repo_root" bundle create "$tmp_bundle" HEAD >/dev/null 2>&1
      else
        # git bundle은 원시 SHA만 넘기면 head가 없어 실패하므로 전용 임시 ref를 만들고 반드시 회수한다.
        candidate_ref="refs/we-deploy/$(basename "$tmp_bundle" .bundle)"
        git -C "$repo_root" update-ref "$candidate_ref" "$bundle_sha" "" \
          || die "번들용 임시 참조를 만들지 못했습니다"
        tmp_ref="$candidate_ref"
        git -C "$repo_root" bundle create "$tmp_bundle" "$tmp_ref" >/dev/null 2>&1 \
          || die "커밋 번들 생성 실패: $deploy_ref"
        deploy_ref="$bundle_sha"
      fi
      bundle_src="$tmp_bundle"
    fi

    dest_bundle="$we_home/bundles/incoming.bundle"
    as_svc sh -c 'umask 077; mkdir -p "$1"; cat > "$2.tmp" && chmod 600 "$2.tmp" && mv "$2.tmp" "$2"' \
      sh "$we_home/bundles" "$dest_bundle" < "$bundle_src"
    cleanup_bundle

    # 현재 저장소의 최신 deploy.sh·rollback.sh·healthcheck.mjs·env.sh를 bootstrap에도 갱신해 첫 배포 전에도 최신 본문을 쓴다.
    for sfile in env.sh deploy.sh rollback.sh restart.sh rotate-key.sh db-check.sh healthcheck.mjs heartbeat.sh status.sh public.sh init-secrets.sh save-secret.sh; do
      as_svc sh -c 'umask 077; mkdir -p "$1"; cat > "$1/$2.tmp" && chmod 700 "$1/$2.tmp" && mv "$1/$2.tmp" "$1/$2"' \
        sh "$we_home/bootstrap/scripts" "$sfile" < "$here/scripts/$sfile"
    done

    sdir="$(svc_scripts_dir deploy.sh)"
    set -- --bundle "$dest_bundle" "$deploy_ref"
    [ -n "$init_flag" ] && set -- "$@" "$init_flag"

    if [ -x "$rg_bin" ] && [ "${RESOURCE_GUARD_ACTIVE:-0}" != "1" ]; then
      exec "$rg_bin" run --profile build -- sudo -u "$svc" -H sh "$sdir/deploy.sh" "$@"
    else
      exec sudo -u "$svc" -H sh "$sdir/deploy.sh" "$@"
    fi
    ;;
  init-secrets|save-secret|rotate-key|db-check|rollback|restart|heartbeat|status|public)
    for arg in "$@"; do
      case "$arg" in
        -h|--help|help)
          exec sh "$here/scripts/$cmd.sh" --help
          ;;
      esac
    done
    need_svc
    sdir="$(svc_scripts_dir "$cmd.sh")"
    exec sh -c 'cd / && exec sudo -u "$0" -H sh "$@"' "$svc" "$sdir/$cmd.sh" "$@"
    ;;
  healthcheck)
    for arg in "$@"; do
      case "$arg" in
        -h|--help|help)
          exec "$node_bin" "$here/scripts/healthcheck.mjs" --help
          ;;
      esac
    done
    need_svc
    sdir="$(svc_scripts_dir healthcheck.mjs)"
    exec sh -c 'cd / && exec sudo -u "$0" -H "$1" "$2" "$@"' "$svc" "$node_bin" "$sdir/healthcheck.mjs" "$@"
    ;;
  logs)
    log_name=""
    follow=0
    while [ $# -gt 0 ]; do
      case "$1" in
        -h|--help|help)
          echo "사용법: sh ops/we.sh logs [server|tunnel|watch|deploy|build] [--follow|-f] (종료: Ctrl+C)"
          exit 0
          ;;
        --follow|-f) follow=1 ;;
        server|tunnel|watch|deploy|build)
          [ -z "$log_name" ] || die "로그 이름은 하나만 지정하세요"
          log_name="$1"
          ;;
        *) die "알 수 없는 로그 인자: $1 (--help 참고)" ;;
      esac
      shift
    done
    log_name="${log_name:-server}"
    need_svc
    case "$log_name" in
      deploy|build)
        log_file="$(as_svc sh -c "ls -t '$we_home/logs/$log_name-'*.log 2>/dev/null | head -n 1" || true)"
        ;;
      server|tunnel|watch)
        log_file="$we_home/logs/$log_name.log"
        ;;
      *)
        die "허용된 로그 이름: server | tunnel | watch | deploy | build"
        ;;
    esac
    [ -n "$log_file" ] && as_svc test -f "$log_file" || die "아직 해당 로그 파일이 없습니다 ($log_name)"
    echo "== $log_file"
    if [ "$follow" = "1" ]; then
      as_svc tail -n "${LINES_TO_SHOW:-60}" -F "$log_file"
    else
      as_svc tail -n "${LINES_TO_SHOW:-60}" "$log_file"
    fi
    ;;
  *)
    die "알 수 없는 명령: '$cmd' (도움말: sh ops/we.sh --help)"
    ;;
esac
