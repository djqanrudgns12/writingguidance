#!/bin/sh
# 읽기 전용 저장소 키를 준비한다. GitHub 등록은 소유자가 직접 하며 비밀 키는 출력하지 않는다.
set -eu
case "${1:-}" in
  -h|--help|help)
    echo "사용법: sh ops/we.sh setup-deploy-key (wesvc ed25519 키 생성·GitHub 호스트 지문 고정·공개 키 안내)"
    exit 0 ;;
esac
[ $# -eq 0 ] || { echo "ERROR: 인자를 받지 않습니다" >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"
we_require_service_user setup-deploy-key
key="$WE_SECRETS/github_deploy_key"
hosts="$WE_SECRETS/github_known_hosts"
mkdir -p "$WE_SECRETS"
chmod 700 "$WE_SECRETS"
we_mktemp_dir
candidate="$WE_TMP_DIR/known_hosts"
ssh-keyscan -T 10 -t ed25519 github.com > "$candidate" 2>/dev/null \
  || we_die "GitHub 호스트 키를 받지 못했습니다(저장된 키는 유지됨)"
# 공식 문서: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
expected='SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU'
actual="$(ssh-keygen -lf "$candidate" -E sha256 2>/dev/null | awk '{print $2}' | sort -u)"
[ "$actual" = "$expected" ] || we_die "GitHub 호스트 키 지문 불일치 — 저장하지 않았습니다"
if [ -e "$key" ] || [ -e "$key.pub" ]; then
  [ -s "$key" ] && [ -s "$key.pub" ] || we_die "기존 키 쌍이 불완전합니다 — 덮어쓰지 않았습니다"
else
  ssh-keygen -q -t ed25519 -N '' -C 'macmini wesvc writingguidance read-only' -f "$key"
fi
chmod 600 "$key" "$key.pub"
cp "$candidate" "$hosts.tmp"
chmod 600 "$hosts.tmp"
mv "$hosts.tmp" "$hosts"
echo "GitHub 호스트 키 지문 확인: $expected"
echo "공개 키(Deploy keys에 읽기 전용으로 등록):"
cat "$key.pub"
echo "소유자 계정 등록 명령(쓰기 권한 옵션 없음):"
printf 'gh repo deploy-key add %s -R djqanrudgns12/writingguidance -t macmini-wesvc\n' "$key.pub"
echo "wesvc 공개 키 파일을 소유자가 읽을 수 없으면 위 공개 키 한 줄만 소유자 임시 파일에 저장해 등록하세요."
