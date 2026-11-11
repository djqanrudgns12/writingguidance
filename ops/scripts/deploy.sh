#!/bin/sh
# 쌤유 글방 운영 배포 스크립트(서비스 계정 wesvc) — git bundle 빌드·사전 호환 검사·마이그레이션·원자적 전환·자동 되돌리기를 수행한다.
#
# 왜 필요한가:
#   - GitHub 원격 없이 소유자가 넘긴 git bundle만으로 독립된 releases/<sha>를 만들고 검증한 뒤 심볼릭 링크로 무중단 전환한다(U-13 ②, PLAN §15.4).
#   - 되돌리기 때 DB는 그대로 남으므로, 앱을 바꾸기 전에 "새 스키마가 적용된 임시 SQLite에서 이전 릴리스가 기동되는지"를 기계로 증명한다.
# 안전장치:
#   - 평일 08:00~16:00 KST 수업 시간에는 강제 옵션 없이 무조건 거부한다.
#   - 활성 실시간 연결이 남아 있으면 거부한다.
#   - 맥미니의 다른 서비스·포트(쌤유니버스 4390, rollingthunder 3000·8000·20241, 글방 터널 20242)는 끄거나 바꾸지 않는다.
set -eu

usage() {
  cat <<'EOF'
사용법:
  sh ops/we.sh deploy [ref] [--init] [--bundle <번들파일>]
  sudo -u wesvc -H sh ops/scripts/deploy.sh [--bundle <번들파일>] [--init] [ref]

소유자가 만든 git bundle을 받아 새 releases/<sha>에 풀고:
  1) 평일 08:00~16:00 KST 금지창 및 실시간 연결 0건 확인 (강제 우회 옵션 없음)
  2) npm ci (.npmrc의 min-release-age=7 존중) + npm run build
  3) 사전 검사: 새 스키마를 입힌 임시 DB에서 새 릴리스와 이전 릴리스가 모두 정상 시작·응답하는지 검증
  4) 운영 DB 마이그레이션 (DB 파일이 없으면 --init 일 때만 최초 생성)
  5) app 심볼릭 링크 교체 -> 운영 서버(4460) 재시작 -> healthcheck
  6) healthcheck 실패 시 자동으로 rollback.sh를 불러 이전 릴리스로 복귀

인자·옵션:
  ref                  번들 안에서 배포할 참조 이름 (기본: HEAD)
  --bundle <경로>      읽을 git bundle 경로 (기본: /Users/wesvc/writeessay-server/bundles/incoming.bundle)
  --init               운영 SQLite 파일이 아직 없을 때 최초 1회 생성을 허용합니다.
  -h, --help           이 도움말을 보여 줍니다.
EOF
}

bundle_path=""
allow_init=0
target_ref=""

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help|help)
      usage
      exit 0
      ;;
    --bundle)
      [ $# -ge 2 ] || { echo "ERROR: --bundle 뒤에 파일 경로를 주세요" >&2; exit 1; }
      bundle_path="$2"
      shift 2
      ;;
    --init)
      allow_init=1
      shift
      ;;
    --*)
      echo "ERROR: 지원하지 않는 옵션입니다: $1 (금지창 강제 우회 옵션은 제공하지 않습니다. --help 참고)" >&2
      exit 1
      ;;
    *)
      [ -z "$target_ref" ] || { echo "ERROR: 참조(ref) 인자가 두 번 지정되었습니다: $1" >&2; exit 1; }
      target_ref="$1"
      shift
      ;;
  esac
done

target_ref="${target_ref:-HEAD}"

here="$(cd "$(dirname "$0")" && pwd -P)"
. "$here/env.sh"

[ "$(id -un)" = "$WE_SERVICE_USER" ] || we_die "$WE_SERVICE_USER 계정으로 실행해야 합니다: sh ops/we.sh deploy"

# 1. 평일 수업 시간(08:00~16:00 KST) 무조건 거부 — 강제 우회 옵션 없음(PLAN §15.4).
if we_is_school_hours; then
  we_die "평일 08:00~16:00 KST(수업 시간 금지창)에는 배포할 수 없습니다 (현재 $(TZ=Asia/Seoul date '+%F %T KST'))"
fi

# 2. 활성 실시간 웹소켓 연결이 남아 있으면 거부(PLAN §15.4).
if internal_json="$(curl -fsS --max-time 3 "http://127.0.0.1:$WE_PORT/internal/health" 2>/dev/null)"; then
  active_conn="$(printf '%s' "$internal_json" | "$NODE_BIN" -e '
    let s = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", c => (s += c));
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(s);
        process.stdout.write(String(typeof j.connections === "number" ? j.connections : 0));
      } catch {
        process.stdout.write("0");
      }
    });
  ')"
  if [ "${active_conn:-0}" -gt 0 ]; then
    we_die "현재 실시간 연결(${active_conn}개)이 남아 있어 배포를 멈춥니다. 수업 종료 뒤 다시 실행하세요."
  fi
fi

# 3. 원자적 잠금 (종료 코드 75 = 다른 작업 진행 중).
if ! we_lock deploy; then
  echo "ERROR: 다른 배포 또는 되돌리기가 이미 실행 중입니다" >&2
  exit 75
fi

# 4. 운영 비밀값 파일과 운영 DB 조건 사전 확인.
[ -s "$WE_ENV_FILE" ] || we_die "$WE_ENV_FILE 이 없습니다 — 먼저 sh ops/we.sh init-secrets 를 실행하세요"
for req_key in PIN_HMAC_KEY PIN_ENC_KEY ID_HMAC_KEY ANTHROPIC_API_KEY TEACHER_START_CODE; do
  grep -q "^${req_key}=." "$WE_ENV_FILE" || we_die "$WE_ENV_FILE 에 필수 항목 $req_key 가 없습니다 (값은 표시하지 않음)"
done

if [ ! -f "$WE_DB_PATH" ] && [ "$allow_init" != "1" ]; then
  we_die "운영 DB 파일($WE_DB_PATH)이 없습니다. 최초 1회 배포일 때만 --init 옵션을 붙이세요(PLAN §15.4)."
fi

bundle_path="${bundle_path:-$WE_BUNDLES/incoming.bundle}"
[ -s "$bundle_path" ] || we_die "git bundle 파일이 없습니다: $bundle_path (sh ops/we.sh deploy 로 실행하세요)"

mkdir -p "$WE_RELEASES" "$WE_LOGS" "$WE_STATE" "$WE_DATA"

echo "== 1/6 git bundle 검증 및 커밋 추출"
git bundle verify "$bundle_path" >/dev/null 2>&1 || we_die "유효하지 않거나 불완전한 git bundle입니다: $bundle_path"

resolved_line="$(git bundle list-heads "$bundle_path" | awk -v want="$target_ref" '
  $2 == want || $2 == ("refs/heads/" want) || $2 == ("refs/tags/" want) || $1 == want {
    print $1, $2; exit
  }
')"
if [ -z "$resolved_line" ] && [ "$target_ref" = "HEAD" ]; then
  resolved_line="$(git bundle list-heads "$bundle_path" | head -n 1)"
fi
[ -n "$resolved_line" ] || we_die "번들 안에서 참조 '$target_ref'를 찾지 못했습니다"

full_sha="$(printf '%s\n' "$resolved_line" | awk '{print $1}')"
bundle_ref="$(printf '%s\n' "$resolved_line" | awk '{print $2}')"
case "$full_sha" in
  *[!0-9a-f]*|"") we_die "커밋 해시 형식이 올바르지 않습니다: $full_sha" ;;
esac

cache="$WE_HOME/repo-cache"
if [ ! -d "$cache/objects" ]; then
  git init -q --bare "$cache"
fi
git -C "$cache" fetch -q "$bundle_path" "$bundle_ref:refs/deploy/target"
sha="$(git -C "$cache" rev-parse --short=12 "$full_sha")"
dest="$WE_RELEASES/$sha"
deploy_log="$WE_LOGS/deploy-$sha.log"
build_log="$WE_LOGS/build-$sha.log"

prev="$(readlink "$WE_APP" 2>/dev/null || true)"
if [ -d "$dest" ] && [ ! -f "$dest/.we-build-ok" ] && [ "$prev" = "$dest" ]; then
  touch "$dest/.we-build-ok"
fi
if [ -d "$dest" ] && [ ! -f "$dest/.we-build-ok" ]; then
  echo "이전 미완성 릴리스 폴더 정리: $dest"
  rm -rf "$dest"
fi
if [ ! -d "$dest" ]; then
  mkdir -p "$dest"
  git --git-dir="$cache" archive "$full_sha" | tar -x -C "$dest"
fi

echo "== 2/6 의존성 설치(npm ci, .npmrc 7일 대기 확인) 및 빌드 ($sha)"
[ -f "$dest/.npmrc" ] || we_die "$dest/.npmrc 파일이 없습니다"
grep -Eq '^[[:space:]]*min-release-age[[:space:]]*=[[:space:]]*[7-9]|^[[:space:]]*min-release-age[[:space:]]*=[[:space:]]*[1-9][0-9]+' "$dest/.npmrc" \
  || we_die ".npmrc 에 min-release-age=7(이상) 설정이 없습니다(ADR-051)"

if [ ! -f "$dest/.we-build-ok" ]; then
  (
    cd "$dest"
    unset npm_config_min_release_age NPM_CONFIG_MIN_RELEASE_AGE
    npm ci --no-audit --no-fund
    npm run build
  ) > "$build_log" 2>&1 || we_die "빌드 실패 — $build_log 확인 (운영 서버·DB는 바뀌지 않았습니다)"

  [ -f "$dest/apps/server/dist/index.js" ] || we_die "서버 빌드 산출물(apps/server/dist/index.js)이 없습니다"
  [ -f "$dest/apps/web/dist/index.html" ] || we_die "웹 빌드 산출물(apps/web/dist/index.html)이 없습니다"
  touch "$dest/.we-build-ok"
fi

echo "== 3/6 사전 검사: 마이그레이션 무결성 및 '새 스키마에서 이전 릴리스 시작' 검증"
we_mktemp_dir
compat_db="$WE_TMP_DIR/compat.sqlite"

(
  cd "$dest"
  "$NODE_BIN" --input-type=module - "$dest" "${prev:-}" "$WE_DB_PATH" "$compat_db" "$WE_ENV_FILE" "$NODE_BIN" "$sha" <<'mjs'
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const [, , newDir, prevDir, prodDbPath, compatDbPath, envFile, nodeBin, newSha] = process.argv;

const newDbMod = await import(pathToFileURL(join(newDir, 'apps/server/dist/store/db.js')).href);
const newMigMod = await import(pathToFileURL(join(newDir, 'apps/server/dist/store/migrate.js')).href);

const newMigrationsDir = join(newDir, 'apps/server/migrations');
const newFiles = newMigMod.readMigrations(newMigrationsDir);

// 1) 운영 DB가 이미 있으면 읽기 전용으로 열어 기존 마이그레이션 변조·누락과 파괴적 SQL을 검사한다.
const appliedVersions = new Set();
if (existsSync(prodDbPath)) {
  const ro = new Database(prodDbPath, { readonly: true, fileMustExist: true });
  try {
    const hasTable = ro
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get();
    if (hasTable) {
      const rows = ro.prepare('SELECT version, sha256 FROM schema_migrations ORDER BY version').all();
      const byVer = new Map(newFiles.map(f => [f.version, f]));
      for (const row of rows) {
        appliedVersions.add(row.version);
        const f = byVer.get(row.version);
        if (!f) {
          throw new Error(`운영 DB에 적용된 마이그레이션 판(${row.version})이 새 릴리스에서 삭제되었습니다`);
        }
        if (f.sha256 !== row.sha256) {
          throw new Error(`이미 적용된 마이그레이션 ${f.file}의 내용이 바뀌었습니다 (새 파일로 추가하세요)`);
        }
      }
    }
  } finally {
    ro.close();
  }
}

// PLAN §15.4: 옛 앱이 새 스키마에서도 뜨도록 마이그레이션은 "더하기만" 한다(열 삭제·이름 바꾸기 금지).
const DESTRUCTIVE_RE =
  /\bDROP\s+(?:TABLE|COLUMN)\b|\bRENAME\s+(?:TO|COLUMN)\b|\bTRUNCATE\b/i;
for (const f of newFiles) {
  if (appliedVersions.has(f.version)) continue;
  if (f.sql.includes('we:allow-destructive')) continue;
  const stripped = f.sql.replace(/--.*$/gm, '');
  if (DESTRUCTIVE_RE.test(stripped)) {
    throw new Error(
      `새 마이그레이션 ${f.file}에 이전 릴리스 호환을 깨뜨리는 문장(DROP/RENAME/TRUNCATE)이 있습니다(PLAN §15.4)`,
    );
  }
}

// 2) 학생 데이터가 전혀 없는 빈 임시 SQLite에 이전 스키마 -> 새 스키마를 순서대로 입힌다.
const tempDb = newDbMod.openDatabase(compatDbPath, { create: true });
try {
  if (prevDir && existsSync(join(prevDir, 'apps/server/migrations'))) {
    newMigMod.migrate(tempDb, join(prevDir, 'apps/server/migrations'));
  }
  newMigMod.migrate(tempDb, newMigrationsDir);
  newDbMod.checkpoint(tempDb);
} finally {
  tempDb.close();
}

async function bootAndProbe(releaseDir, label) {
  const entry = join(releaseDir, 'apps/server/dist/index.js');
  const child = spawn(nodeBin, [`--env-file=${envFile}`, entry], {
    cwd: releaseDir,
    env: {
      HOME: process.env.HOME ?? '/tmp',
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '0',
      DB_PATH: compatDbPath,
      RELEASE_ID: `precheck-${label}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  let boundUrl = null;

  const readyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${label} 사전 기동 시간 초과(15초)`));
    }, 15_000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderrBuf += chunk;
    });
    child.stdout.on('data', chunk => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.code === 'listening' && typeof parsed.detail === 'string') {
            boundUrl = parsed.detail;
            clearTimeout(timeout);
            resolve(boundUrl);
          }
        } catch {
          // JSON 외 출력 무시
        }
      }
    });

    child.once('exit', code => {
      if (!boundUrl) {
        clearTimeout(timeout);
        const hint = stderrBuf.trim().split('\n').slice(-3).join(' | ');
        reject(new Error(`${label} 기동 중 비정상 종료 (code=${String(code)}${hint ? `, ${hint}` : ''})`));
      }
    });
  });

  const url = await readyPromise;
  try {
    const r1 = await fetch(`${url}/internal/health`, { signal: AbortSignal.timeout(5000) });
    const b1 = await r1.json();
    if (r1.status !== 200 || b1.ok !== true || b1.db !== 'ok') {
      throw new Error(`${label} /internal/health 실패 (HTTP ${r1.status})`);
    }
    const r2 = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
    const b2 = await r2.json();
    if (r2.status !== 200 || b2?.data?.ok !== true) {
      throw new Error(`${label} /api/health 실패 (HTTP ${r2.status})`);
    }
  } finally {
    child.kill('SIGTERM');
  }

  const exitCode = await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${label} SIGTERM 종료 대기 시간 초과`));
    }, 10_000);
    child.once('exit', code => {
      clearTimeout(t);
      resolve(code);
    });
  });

  if (exitCode !== 0) {
    throw new Error(`${label} 종료 코드가 0이 아닙니다 (${String(exitCode)})`);
  }
}

try {
  await bootAndProbe(newDir, `new-${newSha}`);
  if (prevDir && existsSync(join(prevDir, 'apps/server/dist/index.js'))) {
    await bootAndProbe(prevDir, 'previous-on-new-schema');
    process.stdout.write('사전 검사 통과: 새 스키마 위에서 새 릴리스와 이전 릴리스 모두 정상 기동·종료 확인\n');
  } else {
    process.stdout.write('사전 검사 통과: 새 릴리스 기동·종료 확인 (이전 릴리스 없음 — 첫 배포)\n');
  }
} finally {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${compatDbPath}${suffix}`, { force: true });
  }
}
mjs
) >> "$deploy_log" 2>&1 || {
  tail -n 10 "$deploy_log" >&2 || true
  we_die "사전 검사 실패 — 새 스키마 또는 환경 설정 호환성 문제로 배포를 중단합니다 (운영 서버·DB는 그대로 유지됨)"
}
tail -n 1 "$deploy_log"

echo "== 4/6 운영 DB 마이그레이션 ($WE_DB_PATH)"
created_db=0
[ ! -f "$WE_DB_PATH" ] && created_db=1

# 파이프(`| tee`)는 tee의 종료값만 남겨 마이그레이션 실패를 숨긴다. 결과를 파일에 받아 종료값을 따로 본다.
mig_out="$(mktemp)"
if (
  cd "$dest"
  "$NODE_BIN" --input-type=module - "$dest" "$WE_DB_PATH" "$allow_init" <<'mjs'
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , relDir, dbPath, allowInit] = process.argv;
const { openDatabase, quickCheck } = await import(
  pathToFileURL(join(relDir, 'apps/server/dist/store/db.js')).href
);
const { migrate } = await import(
  pathToFileURL(join(relDir, 'apps/server/dist/store/migrate.js')).href
);

const db = openDatabase(dbPath, { create: allowInit === '1' });
try {
  quickCheck(db);
  const report = migrate(db, join(relDir, 'apps/server/migrations'));
  process.stdout.write(
    `마이그레이션 완료: schema=${report.current ?? '-'} applied=[${report.applied.join(',')}]\n`,
  );
} finally {
  db.close();
}
mjs
) >"$mig_out" 2>&1; then mig_ok=1; else mig_ok=0; fi
tee -a "$deploy_log" <"$mig_out"
rm -f "$mig_out"
[ "$mig_ok" = "1" ] || we_die "운영 DB 마이그레이션 실패 — 심볼릭 링크를 바꾸지 않고 중단했습니다"

if [ "$created_db" = "1" ] && [ -f "$WE_DB_PATH" ]; then
  chmod 600 "$WE_DB_PATH"
fi

echo "== 5/6 심볼릭 링크 전환 및 운영 서버 재시작"
if [ -n "$prev" ] && [ "$prev" != "$dest" ]; then
  printf '%s\n' "$prev" > "$WE_STATE/previous-release.tmp"
  mv "$WE_STATE/previous-release.tmp" "$WE_STATE/previous-release"
fi

printf 'RELEASE_ID=releases/%s\n' "$sha" > "$WE_STATE/release.env.tmp"
chmod 600 "$WE_STATE/release.env.tmp"
mv "$WE_STATE/release.env.tmp" "$WE_STATE/release.env"

ln -sfn "$dest" "$WE_APP"
echo "릴리스 링크: ${prev:-(없음)} -> $dest" | tee -a "$deploy_log"

server_plist="/Library/LaunchDaemons/com.ssamwrite.server.plist"
tunnel_plist="/Library/LaunchDaemons/com.ssamwrite.tunnel.plist"

if [ ! -f "$server_plist" ]; then
  echo "== 6/6 첫 배포 준비 완료 (아직 launchd 데몬 등록 전)"
  printf 'releases/%s\n' "$sha" > "$WE_STATE/current-release"
  printf '%s %s\n' "$full_sha" "$(date '+%F %T')" > "$WE_STATE/last-deploy"
  [ "$bundle_path" = "$WE_BUNDLES/incoming.bundle" ] && rm -f "$bundle_path"
  echo "다음 명령으로 서버 데몬을 시작하세요: sh ops/we.sh install-daemons server"
  exit 0
fi

we_restart_server

echo "== 6/6 상태 확인 (healthcheck, 최대 60초 대기)"
hc_mode=""
if [ ! -f "$tunnel_plist" ] || [ -f "$WE_STATE/public-off" ]; then
  hc_mode="--local-only"
  echo "(터널 미설치 또는 public-off 상태 — 로컬 경로 --local-only 점검)"
fi

ok=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  sleep 2
  if [ -n "$hc_mode" ]; then
    if "$NODE_BIN" "$dest/ops/scripts/healthcheck.mjs" --local-only --expect-release "releases/$sha" --quiet 2>/dev/null; then
      ok=1
      break
    fi
  else
    if "$NODE_BIN" "$dest/ops/scripts/healthcheck.mjs" --expect-release "releases/$sha" --quiet 2>/dev/null; then
      ok=1
      break
    fi
  fi
  attempt=$((attempt + 1))
done

if [ "$ok" != "1" ]; then
  echo "상태 확인 실패 — 마지막 점검 결과:" >&2
  if [ -n "$hc_mode" ]; then
    "$NODE_BIN" "$dest/ops/scripts/healthcheck.mjs" --local-only --expect-release "releases/$sha" >&2 || true
  else
    "$NODE_BIN" "$dest/ops/scripts/healthcheck.mjs" --expect-release "releases/$sha" >&2 || true
  fi

  if [ -n "$prev" ] && [ "$prev" != "$dest" ] && [ -d "$prev" ]; then
    echo "자동 되돌리기 실행: $prev" >&2
    sh "$here/rollback.sh" --from-deploy "$prev" || true
    we_notify "[Writeessay] deploy FAILED $sha (rolled back)" "healthcheck failed; rolled back to $prev"
    we_die "새 릴리스($sha) 상태 확인 실패로 이전 릴리스($prev)로 자동 되돌렸습니다 (DB는 유지됨)"
  fi
  we_notify "[Writeessay] deploy FAILED $sha" "healthcheck failed; no previous release to roll back"
  we_die "새 릴리스($sha) 상태 확인 실패 (되돌릴 이전 릴리스 없음)"
fi

printf 'releases/%s\n' "$sha" > "$WE_STATE/current-release"
printf '%s %s\n' "$full_sha" "$(date '+%F %T')" > "$WE_STATE/last-deploy"
[ "$bundle_path" = "$WE_BUNDLES/incoming.bundle" ] && rm -f "$bundle_path"

# 최근 WE_RELEASES_KEEP(5)개 릴리스만 남기고 오래된 폴더를 정리한다(현재·직전 릴리스는 보호).
keep_prev="$(we_previous_release)"
ls -1t "$WE_RELEASES" 2>/dev/null | tail -n +"$((WE_RELEASES_KEEP + 1))" | while IFS= read -r old_name; do
  [ -n "$old_name" ] || continue
  old_dir="$WE_RELEASES/$old_name"
  [ "$old_dir" = "$dest" ] && continue
  [ "$old_dir" = "$keep_prev" ] && continue
  rm -rf "$old_dir"
done

we_notify "[Writeessay] deploy OK $sha" "deployed releases/$sha"
echo "배포 완료: releases/$sha"
