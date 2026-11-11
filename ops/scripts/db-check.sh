#!/bin/sh
# 운영 SQLite는 생성·수정·복구하지 않고 읽기 전용 무결성 검사 결과만 출력한다.
set -eu

case "${1:-}" in
  -h|--help|help)
    echo "사용법: sh ops/we.sh db-check"
    echo "운영 DB를 sqlite3 -readonly로 열어 integrity_check와 quick_check 결과만 출력합니다. 이상이면 종료 코드 1입니다."
    exit 0
    ;;
esac
[ $# -eq 0 ] || { echo "ERROR: 알 수 없는 인자 (--help 참고)" >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"
[ "$(id -un)" = "$WE_SERVICE_USER" ] || we_die "$WE_SERVICE_USER 계정으로 실행해야 합니다: sh ops/we.sh db-check"
[ -f "$WE_DB_PATH" ] || we_die "운영 DB가 없습니다(자동 생성하지 않음)"
command -v sqlite3 >/dev/null 2>&1 || we_die "sqlite3가 없습니다"

failed=0
for check in integrity_check quick_check; do
  result="$(sqlite3 -readonly "$WE_DB_PATH" "PRAGMA query_only = ON; PRAGMA $check;")" \
    || we_die "$check 실행 실패(자동 복구하지 않음)"
  printf '%s:\n%s\n' "$check" "$result"
  if [ "$result" != "ok" ]; then failed=1; fi
done
exit "$failed"
