#!/bin/sh
# 검증된 운영 릴리스의 스크립트로 main을 확인한다. 새 코드의 운영 스크립트를 먼저 실행하지 않는다.
set -eu

usage() {
  cat <<'EOF'
사용법: sh ops/we.sh autodeploy <status|dry-run|retry|pause|resume|run>
  status   상태·운영 SHA·실패 기록 조회
  dry-run  안전 조건·CI를 확인하고 커밋·마이그레이션만 표시(배포·실패 기록·알림 없음)
  retry    같은 커밋의 실패·CI 조회 기록을 비우고 한 번 확인(일시정지는 유지)
  pause    일시정지 파일 생성
  resume   일시정지 파일 제거(다음 회차부터 확인)
  run      한 번 확인·배포(launchd 기본 동작)
EOF
}

mode="${1:---run}"
case "$mode" in -h|--help|help) usage; exit 0 ;; esac
[ $# -le 1 ] || { usage >&2; exit 1; }
case "$mode" in --status|--dry-run|--retry|--pause|--resume|--run) ;; *) usage >&2; exit 1 ;; esac
here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"
we_require_service_user autodeploy

cache="$WE_HOME/repo-cache"
failed_file="$WE_STATE/autodeploy-failed"
status_file="$WE_STATE/autodeploy-status"
ci_file="$WE_STATE/autodeploy-ci"
paused_file="$WE_HOME/AUTO_DEPLOY_PAUSED"

if [ "$mode" = "--status" ]; then
  echo "운영 SHA: $(cat "$WE_APP/.we-commit" 2>/dev/null || echo 없음)"
  echo "자동 배포: $(cat "$status_file" 2>/dev/null || echo 기록 없음)"
  [ ! -e "$paused_file" ] || echo "일시정지 중: AUTO_DEPLOY_PAUSED"
  [ ! -s "$failed_file" ] || echo "실패 기록: $(cat "$failed_file")"
  exit 0
fi
mkdir -p "$WE_STATE" "$WE_LOGS"
case "$mode" in
  --pause) touch "$paused_file"; echo "자동 배포를 멈췄습니다"; exit 0 ;;
  --resume) rm -f "$paused_file"; echo "자동 배포를 켰습니다(다음 회차부터 확인)"; exit 0 ;;
esac

status() {
  if [ "$mode" = "--dry-run" ]; then
    printf '%s\n' "$*"
  else
    printf '%s %s\n' "$(date '+%F %T')" "$*" > "$status_file.tmp"
    mv "$status_file.tmp" "$status_file"
  fi
}
wait_for() { status "$*"; exit 0; }
valid_sha() {
  [ "${#1}" -eq 40 ] || return 1
  case "$1" in *[!0-9a-f]*) return 1 ;; esac
}

# 자동 회차끼리 상태·실패 횟수·CI 조회 시각을 덮어쓰지 않게 한다. deploy 잠금은 실제 배포 자식이 잡는다.
we_lock autodeploy || { echo "다른 자동 배포 회차가 진행 중입니다"; exit 0; }
if [ "$mode" = "--retry" ]; then
  rm -f "$failed_file" "$ci_file"
fi
[ ! -e "$paused_file" ] || wait_for "일시정지 중(AUTO_DEPLOY_PAUSED)"
if we_is_school_hours; then wait_for "수업 시간 — 16:00 뒤 배포"; fi
[ -f "$WE_APP/.we-commit" ] || wait_for "첫 배포 전 — sh ops/we.sh deploy --init"
current="$(cat "$WE_APP/.we-commit")"
valid_sha "$current" || wait_for "운영 SHA 기록이 잘못되었습니다 — 수동 배포 확인"
if [ -d "$WE_STATE/deploy.lock" ]; then
  holder="$(cat "$WE_STATE/deploy.lock/pid" 2>/dev/null || true)"
  if [ -z "$holder" ] || kill -0 "$holder" 2>/dev/null; then
    wait_for "다른 배포 또는 되돌리기가 진행 중"
  fi
fi

# 조회 실패를 연결 0개로 간주하면 수업 중에 앱을 교체할 수 있어 반드시 대기한다.
if [ "${WE_OPS_TEST_MODE:-0}" = "1" ] && [ -n "${WE_AUTODEPLOY_HEALTH_CMD:-}" ]; then
  health_json="$(sh "$WE_AUTODEPLOY_HEALTH_CMD")" || wait_for "연결 상태 확인 실패 — 다음 회차에 다시"
else
  health_json="$(curl -fsS --max-time 3 "http://127.0.0.1:$WE_PORT/internal/health" 2>/dev/null)" \
    || wait_for "연결 상태 확인 실패 — 다음 회차에 다시"
fi
active="$(printf '%s' "$health_json" | "$NODE_BIN" -e '
  let s = "";
  for await (const c of process.stdin) s += c;
  try {
    const n = JSON.parse(s).connections;
    if (!Number.isSafeInteger(n) || n < 0) process.exit(1);
    console.log(n);
  } catch { process.exit(1); }
' --input-type=module)" || wait_for "연결 상태 응답 확인 실패 — 다음 회차에 다시"
[ "$active" -eq 0 ] || wait_for "실시간 연결 ${active}개 — 수업 종료 뒤 배포"

git check-ref-format "refs/heads/$WE_DEPLOY_BRANCH" >/dev/null 2>&1 || we_die "배포 브랜치 이름이 올바르지 않습니다"
repo="$WE_REPO_HTTPS"
export GIT_TERMINAL_PROMPT=0
if [ -s "$WE_SECRETS/github_deploy_key" ]; then
  [ -s "$WE_SECRETS/github_known_hosts" ] || wait_for "고정 호스트 키 없음 — setup-deploy-key 필요"
  repo="$WE_REPO_SSH"
  # Git이 셸로 해석하므로 경로의 작은따옴표도 안전하게 이스케이프한다.
  ssh_key="$(printf '%s' "$WE_SECRETS/github_deploy_key" | sed "s/'/'\\\\''/g")"
  ssh_hosts="$(printf '%s' "$WE_SECRETS/github_known_hosts" | sed "s/'/'\\\\''/g")"
  GIT_SSH_COMMAND="ssh -i '$ssh_key' -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile='$ssh_hosts' -o GlobalKnownHostsFile=/dev/null -o ConnectTimeout=10"
  export GIT_SSH_COMMAND
fi
remote_line="$(git ls-remote --exit-code "$repo" "refs/heads/$WE_DEPLOY_BRANCH" 2>/dev/null)" \
  || wait_for "원격 저장소 확인 실패 — 다음 회차에 다시"
remote="$(printf '%s\n' "$remote_line" | awk 'NR == 1 {print $1}')"
valid_sha "$remote" || wait_for "원격 SHA 확인 실패 — 다음 회차에 다시"
short="$(printf '%s' "$remote" | cut -c1-8)"
[ "$remote" != "$current" ] || wait_for "최신 상태($short) — 배포할 것 없음"

fail_count=0
if [ -s "$failed_file" ]; then
  read -r failed_sha failed_count failed_reason < "$failed_file" || true
  if [ "${failed_sha:-}" = "$remote" ]; then
    case "${failed_count:-}" in 1|2) fail_count="$failed_count" ;; esac
  fi
fi
[ "$fail_count" -lt 2 ] || wait_for "중단: $short 실패 2회 — 새 커밋 푸시 또는 --retry"

if [ ! -d "$cache/objects" ]; then git init -q --bare "$cache"; fi
git -C "$cache" fetch -q --no-tags "$repo" "+refs/heads/$WE_DEPLOY_BRANCH:refs/autodeploy/candidate" 2>/dev/null \
  || wait_for "저장소 받기 실패 — 다음 회차에 다시"
fetched="$(git -C "$cache" rev-parse refs/autodeploy/candidate)"
[ "$fetched" = "$remote" ] || wait_for "확인 중 새 푸시 감지 — 다음 회차에 다시"
git -C "$cache" cat-file -e "$current^{commit}" 2>/dev/null \
  || wait_for "운영 커밋이 캐시에 없습니다 — 수동 배포 확인"

commits="$(git -C "$cache" log --max-count=20 --format='- %h %s' "$current..$remote")"
migrations="$(git -C "$cache" diff --name-status "$current" "$remote" -- apps/server/migrations)"
detail="$(printf '커밋(최대 20줄):\n%s\n\n바뀐 마이그레이션:\n%s' "$commits" "${migrations:-- 없음}")"
record_failure() {
  reason="$1"
  if [ "$2" = "final" ]; then count=2; else count=$((fail_count + 1)); fi
  if [ "$mode" = "--dry-run" ]; then wait_for "배포 거부: $reason"; fi
  printf '%s %s %s\n' "$remote" "$count" "$reason" > "$failed_file.tmp"
  mv "$failed_file.tmp" "$failed_file"
  if [ "$count" -ge 2 ]; then
    status "중단: $short — $reason"
    we_notify "[글방] deploy FAILED $short" "$(printf '자동 배포 중단: %s\n수동 배포: sh ops/we.sh deploy\n재시도: sh ops/we.sh autodeploy retry\n\n%s' "$reason" "$detail")"
  else
    status "실패 1회: $short — $reason (다음 회차에 재시도)"
  fi
}
if ! git -C "$cache" merge-base --is-ancestor "$current" "$remote"; then
  record_failure "운영 커밋의 후손이 아님(강제 푸시·되감기) — 수동 배포 확인" final
  exit 0
fi

case "$WE_AUTODEPLOY_REQUIRE_CI" in 0|1) ;; *) we_die "WE_AUTODEPLOY_REQUIRE_CI는 0 또는 1이어야 합니다" ;; esac
if [ "$WE_AUTODEPLOY_REQUIRE_CI" = "1" ]; then
  now="$(date +%s)"
  ci_sha=""; ci_at=0; ci_result=pending
  if [ -s "$ci_file" ]; then read -r ci_sha ci_at ci_result < "$ci_file" || true; fi
  case "$ci_at" in *[!0-9]*|"") ci_at=0 ;; esac
  # 응답 실패도 조회 시각을 남긴다. GitHub 익명 한도를 지키기 위해 같은 SHA는 120초 간격이다.
  if [ "$ci_sha" != "$remote" ] || [ "$((now - ci_at))" -ge 120 ]; then
    ci_result=pending
    we_mktemp_dir
    ci_json="$WE_TMP_DIR/check-runs.json"
    ci_ok=0
    if [ "${WE_OPS_TEST_MODE:-0}" = "1" ] && [ -n "${WE_AUTODEPLOY_CI_CMD:-}" ]; then
      if sh "$WE_AUTODEPLOY_CI_CMD" "$remote" > "$ci_json"; then ci_ok=1; fi
    elif curl -fsS --max-time 10 -H 'Accept: application/vnd.github+json' \
      -H 'X-GitHub-Api-Version: 2022-11-28' \
      "https://api.github.com/repos/djqanrudgns12/writingguidance/commits/$remote/check-runs?check_name=verify" \
      > "$ci_json" 2>/dev/null; then ci_ok=1; fi
    if [ "$ci_ok" = "1" ]; then
      ci_result="$("$NODE_BIN" --input-type=module - "$ci_json" "$remote" <<'mjs'
import { readFileSync } from 'node:fs';
try {
  const body = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const runs = Array.isArray(body.check_runs) ? body.check_runs.filter(r =>
    r && Number.isSafeInteger(r.id) && r.id >= 0 && r.name === 'verify' &&
    r.head_sha === process.argv[3] && r.app?.slug === 'github-actions'
  ) : [];
  runs.sort((a, b) => Number(b.id) - Number(a.id));
  const run = runs[0];
  const conclusion = run?.status === 'completed' ? run.conclusion : null;
  console.log(['success', 'failure', 'cancelled', 'timed_out'].includes(conclusion) ? conclusion : 'pending');
} catch { console.log('pending'); }
mjs
)"
    fi
    printf '%s %s %s\n' "$remote" "$now" "$ci_result" > "$ci_file.tmp"
    mv "$ci_file.tmp" "$ci_file"
  fi
  case "$ci_result" in
    success) ;;
    failure|cancelled|timed_out) record_failure "CI verify: $ci_result" final; exit 0 ;;
    *) wait_for "시험 기다리는 중($short)" ;;
  esac
fi

if [ "$mode" = "--dry-run" ]; then
  printf '배포 예정: %s → %s\n%s\n' "$current" "$remote" "$detail"
  exit 0
fi
# 긴 Git/CI 조회 중 수동 배포·되돌리기가 끝났으면 오래된 기준으로 배포하지 않는다.
[ ! -e "$paused_file" ] || wait_for "일시정지 중(AUTO_DEPLOY_PAUSED)"
[ "$(cat "$WE_APP/.we-commit" 2>/dev/null || true)" = "$current" ] || wait_for "운영 커밋 변경 감지 — 다음 회차에 다시"
out="$WE_LOGS/autodeploy-run-$remote.log"
status "배포 중: $short"
rc=0
defer_reason=""
if [ "${WE_OPS_TEST_MODE:-0}" = "1" ] && [ -n "${WE_AUTODEPLOY_DEPLOY_CMD:-}" ]; then
  WE_AUTODEPLOY_RUN=1 WE_AUTODEPLOY_BASE="$current" sh "$WE_AUTODEPLOY_DEPLOY_CMD" --git "$remote" > "$out" 2>&1 || rc=$?
else
  if [ "${RESOURCE_GUARD_ACTIVE:-0}" = "1" ]; then
    WE_AUTODEPLOY_RUN=1 WE_AUTODEPLOY_BASE="$current" sh "$here/deploy.sh" --git "$remote" > "$out" 2>&1 || rc=$?
  elif [ -x "$WE_RESOURCE_GUARD" ]; then
    WE_AUTODEPLOY_RUN=1 WE_AUTODEPLOY_BASE="$current" "$WE_RESOURCE_GUARD" run --profile build -- sh "$here/deploy.sh" --git "$remote" > "$out" 2>&1 || rc=$?
  else
    echo "ERROR: resource-guard 접근 불가: $WE_RESOURCE_GUARD" > "$out"
    defer_reason="자원 가드 접근 불가 — wesvc의 WE_RESOURCE_GUARD 설치·권한 확인 필요"
    rc=75
  fi
fi
case "$rc" in
  0)
    rm -f "$failed_file"
    status "최신 상태($short) — 자동 배포 완료"
    we_notify "[글방] deploy OK $short" "$detail"
    echo "자동 배포 완료: $remote"
    ;;
  75) status "${defer_reason:-배포 대기(수업 시간·활성 연결·잠금·자원) — 다음 회차에 다시}" ;;
  *)
    reason="$(sed -n 's/^ERROR: //p' "$out" | tail -n 1)"
    record_failure "${reason:-배포 명령 실패($rc) — $out 확인}" retry
    ;;
esac
# 회차 로그만 최근 20개를 남긴다. 다른 배포·빌드·감시 기록은 건드리지 않는다.
ls -1t "$WE_LOGS"/autodeploy-run-*.log 2>/dev/null | tail -n +21 | while IFS= read -r old; do
  rm -f "$old"
done
exit 0
