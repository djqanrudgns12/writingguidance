import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const autoScript = join(root, 'ops/scripts/auto-deploy.sh');
const local = join(root, '.local');
mkdirSync(local, { recursive: true });

function fixture(t) {
  const dir = mkdtempSync(join(local, 'autodeploy-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'service home');
  const remote = join(dir, 'remote.git');
  const cache = join(home, 'repo-cache');
  mkdirSync(join(home, 'app'), { recursive: true });
  mkdirSync(join(home, 'state'));
  const env = {
    ...process.env,
    WE_HOME: home,
    WE_SERVICE_USER: 'wesvc',
    WE_OPS_TEST_MODE: '1',
    WE_TEST_KST_DOW_HOUR: '6:20',
    WE_REPO_HTTPS: remote,
    WE_DEPLOY_BRANCH: 'main',
    WE_AUTODEPLOY_REQUIRE_CI: '1',
    WE_AUTODEPLOY_DEPLOY_CMD: join(dir, 'deploy.sh'),
    WE_AUTODEPLOY_CI_CMD: join(dir, 'ci.sh'),
    WE_AUTODEPLOY_HEALTH_CMD: join(dir, 'health.sh'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Ops Fixture',
    GIT_AUTHOR_EMAIL: 'ops-fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Ops Fixture',
    GIT_COMMITTER_EMAIL: 'ops-fixture@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  };
  function git(args, input) {
    const r = spawnSync('git', args, { env, encoding: 'utf8', input });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  }
  git(['init', '-q', '--bare', remote]);
  git(['init', '-q', '--bare', cache]);
  function commit(message, parent, withMigration = false) {
    const blob = git(['-C', remote, 'hash-object', '-w', '--stdin'], `${message}\n`);
    let entries = `100644 blob ${blob}\tREADME\n`;
    if (withMigration) {
      const migrations = git(['-C', remote, 'mktree'], `100644 blob ${blob}\t0002_ops.sql\n`);
      const server = git(['-C', remote, 'mktree'], `040000 tree ${migrations}\tmigrations\n`);
      const apps = git(['-C', remote, 'mktree'], `040000 tree ${server}\tserver\n`);
      entries += `040000 tree ${apps}\tapps\n`;
    }
    const tree = git(['-C', remote, 'mktree'], entries);
    // 실제 저장소의 commit·push 대신 격리 bare 저장소에만 시험용 객체를 쓴다.
    return git(['-C', remote, 'commit-tree', tree, ...(parent ? ['-p', parent] : [])], `${message}\n`);
  }
  const base = commit('fixture baseline');
  const next = commit('fixture descendant', base, true);
  git(['-C', remote, 'update-ref', 'refs/heads/main', base]);
  git(['-C', cache, 'fetch', '-q', remote, 'refs/heads/main:refs/deploy/target']);
  writeFileSync(join(home, 'app/.we-commit'), `${base}\n`);
  writeFileSync(join(home, 'health.json'), '{"connections":0}');
  writeFileSync(join(home, 'deploy-rc'), '0');
  writeFileSync(env.WE_AUTODEPLOY_HEALTH_CMD, '#!/bin/sh\ncat "$WE_HOME/health.json"\n');
  writeFileSync(
    env.WE_AUTODEPLOY_CI_CMD,
    '#!/bin/sh\nprintf "query\\n" >> "$WE_HOME/ci-calls"\ncat "$WE_HOME/ci.json"\n',
  );
  writeFileSync(
    env.WE_AUTODEPLOY_DEPLOY_CMD,
    `#!/bin/sh
set -eu
[ "$1" = "--git" ] || exit 99
printf '%s\n' "$2" >> "$WE_HOME/deploy-calls"
rc="$(cat "$WE_HOME/deploy-rc")"
if [ "$rc" = "0" ]; then printf '%s\n' "$2" > "$WE_HOME/app/.we-commit";
else echo 'ERROR: fixture deployment failure' >&2; fi
exit "$rc"
`,
  );
  function ci(conclusion = 'success', status = 'completed', sha = next, extraRuns = []) {
    writeFileSync(
      join(home, 'ci.json'),
      JSON.stringify({
        check_runs: [
          { id: 10, name: 'verify', head_sha: sha, app: { slug: 'github-actions' }, status, conclusion },
          ...extraRuns,
        ],
      }),
    );
  }
  ci();
  function publish(sha = next) {
    git(['-C', remote, 'update-ref', 'refs/heads/main', sha]);
  }
  function run(mode, overrides = {}) {
    const result = spawnSync('sh', [autoScript, ...(mode ? [mode] : [])], {
      env: { ...env, ...overrides },
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result;
  }
  const read = path => (existsSync(join(home, path)) ? readFileSync(join(home, path), 'utf8') : '');
  const calls = path => read(path).trim().split('\n').filter(Boolean);
  return { home, env, base, next, commit, git, remote, publish, ci, run, read, calls };
}

test('같은 SHA는 배포·CI 조회 없이 종료한다', t => {
  const f = fixture(t);
  f.run();
  assert.deepEqual(f.calls('deploy-calls'), []);
  assert.deepEqual(f.calls('ci-calls'), []);
  assert.match(f.read('state/autodeploy-status'), /최신 상태/);
});

test('새 후손 커밋과 CI 성공이면 정확한 SHA를 한 번 배포하고 알린다', t => {
  const f = fixture(t);
  f.publish();
  const result = f.run();
  f.run();
  assert.deepEqual(f.calls('deploy-calls'), [f.next]);
  assert.deepEqual(f.calls('ci-calls'), ['query']);
  assert.equal(f.read('app/.we-commit').trim(), f.next);
  assert.match(result.stderr, /\[글방\] deploy OK/);
  assert.equal(f.read('state/autodeploy-failed'), '');
});

for (const condition of ['수업 시간', '일시정지', '활성 연결', '배포 잠금', '첫 배포 전']) {
  test(`${condition}이면 조회·배포·실패 기록 없이 대기한다`, t => {
    const f = fixture(t);
    f.publish();
    const overrides = {};
    if (condition === '수업 시간')
      Object.assign(overrides, { WE_TEST_KST_DOW_HOUR: '4:10', WE_SCHOOL_HOURS_GUARD: 'on' });
    if (condition === '일시정지') writeFileSync(join(f.home, 'AUTO_DEPLOY_PAUSED'), '');
    if (condition === '활성 연결') writeFileSync(join(f.home, 'health.json'), '{"connections":3}');
    if (condition === '배포 잠금') {
      mkdirSync(join(f.home, 'state/deploy.lock'));
      writeFileSync(join(f.home, 'state/deploy.lock/pid'), String(process.pid));
    }
    if (condition === '첫 배포 전') rmSync(join(f.home, 'app/.we-commit'));
    f.run(undefined, overrides);
    assert.deepEqual(f.calls('deploy-calls'), []);
    assert.deepEqual(f.calls('ci-calls'), []);
    assert.equal(f.read('state/autodeploy-failed'), '');
    assert.match(f.read('state/autodeploy-status'), /수업 시간|일시정지|실시간 연결|다른 배포|첫 배포 전/);
  });
}

for (const body of ['not json', '{}', '{"connections":-1}', '{"connections":"0"}']) {
  test(`잘못된 연결 상태(${body})를 0개로 간주하지 않는다`, t => {
    const f = fixture(t);
    f.publish();
    writeFileSync(join(f.home, 'health.json'), body);
    f.run();
    assert.deepEqual(f.calls('deploy-calls'), []);
    assert.equal(f.read('state/autodeploy-failed'), '');
    assert.match(f.read('state/autodeploy-status'), /응답 확인 실패/);
  });
}

test('CI 진행 중은 대기하고 같은 SHA 조회 간격 120초를 지킨다', t => {
  const f = fixture(t);
  f.publish();
  f.ci(null, 'in_progress');
  f.run();
  f.ci();
  f.run();
  assert.deepEqual(f.calls('ci-calls'), ['query']);
  assert.deepEqual(f.calls('deploy-calls'), []);
  assert.match(f.read('state/autodeploy-status'), /시험 기다리는 중/);
  assert.equal(f.read('state/autodeploy-failed'), '');
  writeFileSync(
    join(f.home, 'state/autodeploy-ci'),
    `${f.next} ${Math.floor(Date.now() / 1000) - 121} pending\n`,
  );
  f.run();
  assert.deepEqual(f.calls('ci-calls'), ['query', 'query']);
  assert.deepEqual(f.calls('deploy-calls'), [f.next]);
});

for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
  test(`CI ${conclusion}는 배포 없이 최종 실패를 한 번 알린다`, t => {
    const f = fixture(t);
    f.publish();
    f.ci(conclusion);
    const first = f.run();
    const second = f.run();
    assert.deepEqual(f.calls('deploy-calls'), []);
    assert.equal(f.read('state/autodeploy-failed'), `${f.next} 2 CI verify: ${conclusion}\n`);
    assert.match(first.stderr, /\[글방\] deploy FAILED/);
    assert.doesNotMatch(second.stderr, /deploy FAILED/);
    assert.deepEqual(f.calls('ci-calls'), ['query']);
  });
}

test('CI가 없거나 응답이 잘못되면 대기한다', t => {
  const f = fixture(t);
  f.publish();
  for (const json of ['{"check_runs":[]}', 'invalid']) {
    writeFileSync(join(f.home, 'ci.json'), json);
    f.run('--retry');
    assert.deepEqual(f.calls('deploy-calls'), []);
    assert.equal(f.read('state/autodeploy-failed'), '');
    assert.match(f.read('state/autodeploy-status'), /시험 기다리는 중/);
  }
});

test('다른 SHA 성공과 이전 실행 성공은 최신 실행의 CI를 대신하지 못한다', t => {
  const f = fixture(t);
  f.publish();
  f.ci('success', 'completed', f.base);
  f.run();
  assert.deepEqual(f.calls('deploy-calls'), []);
  f.ci('success', 'completed', f.next, [
    {
      id: 11,
      name: 'verify',
      head_sha: f.next,
      app: { slug: 'github-actions' },
      status: 'in_progress',
      conclusion: null,
    },
  ]);
  f.run('--retry');
  assert.deepEqual(f.calls('deploy-calls'), []);
  assert.match(f.read('state/autodeploy-status'), /시험 기다리는 중/);
});

test('강제 푸시와 되감기는 CI 조회·배포 없이 최종 실패한다', t => {
  const f = fixture(t);
  const unrelated = f.commit('unrelated root');
  f.publish(unrelated);
  f.run();
  assert.match(f.read('state/autodeploy-failed'), new RegExp(`^${unrelated} 2 .*후손이 아님`));
  assert.deepEqual(f.calls('ci-calls'), []);
  assert.deepEqual(f.calls('deploy-calls'), []);
  f.publish();
  f.run();
  f.publish(f.base);
  f.run();
  assert.match(f.read('state/autodeploy-failed'), new RegExp(`^${f.base} 2 .*후손이 아님`));
  assert.deepEqual(f.calls('deploy-calls'), [f.next]);
});

test('배포 실패는 두 번 뒤 멈추며 retry로 재개하고 성공 시 실패 기록을 지운다', t => {
  const f = fixture(t);
  f.publish();
  writeFileSync(join(f.home, 'deploy-rc'), '1');
  const first = f.run();
  assert.equal(f.read('state/autodeploy-failed'), `${f.next} 1 fixture deployment failure\n`);
  assert.doesNotMatch(first.stderr, /deploy FAILED/);
  const second = f.run();
  assert.match(second.stderr, /deploy FAILED/);
  f.run();
  assert.deepEqual(f.calls('deploy-calls'), [f.next, f.next]);
  assert.equal(f.read('state/autodeploy-failed'), `${f.next} 2 fixture deployment failure\n`);
  writeFileSync(join(f.home, 'deploy-rc'), '0');
  f.run('--retry');
  assert.deepEqual(f.calls('deploy-calls'), [f.next, f.next, f.next]);
  assert.equal(f.read('state/autodeploy-failed'), '');
});

test('새 커밋을 푸시하면 이전 SHA의 최종 실패와 무관하게 다시 배포한다', t => {
  const f = fixture(t);
  f.publish();
  f.ci('failure');
  f.run();
  const newer = f.commit('fixed descendant', f.next, true);
  f.publish(newer);
  f.ci('success', 'completed', newer);
  f.run();
  assert.deepEqual(f.calls('deploy-calls'), [newer]);
  assert.equal(f.read('state/autodeploy-failed'), '');
});

test('배포 종료 코드 75는 실패 횟수를 늘리지 않고 다음 회차에 재시도한다', t => {
  const f = fixture(t);
  f.publish();
  writeFileSync(join(f.home, 'deploy-rc'), '75');
  f.run();
  assert.equal(f.read('state/autodeploy-failed'), '');
  assert.match(f.read('state/autodeploy-status'), /배포 대기/);
  writeFileSync(join(f.home, 'state/autodeploy-failed'), `${f.next} 1 previous failure\n`);
  f.run();
  assert.equal(f.read('state/autodeploy-failed'), `${f.next} 1 previous failure\n`);
  writeFileSync(join(f.home, 'deploy-rc'), '0');
  f.run();
  assert.deepEqual(f.calls('deploy-calls'), [f.next, f.next, f.next]);
});

test('CI 비활성화 설정은 CI를 조회하지 않고 기존 배포 경로를 쓴다', t => {
  const f = fixture(t);
  f.publish();
  f.ci('failure');
  f.run(undefined, { WE_AUTODEPLOY_REQUIRE_CI: '0' });
  assert.deepEqual(f.calls('ci-calls'), []);
  assert.deepEqual(f.calls('deploy-calls'), [f.next]);
});

test('dry-run은 커밋·마이그레이션을 보여주고 배포·실패 기록·상태를 바꾸지 않는다', t => {
  const f = fixture(t);
  f.publish();
  writeFileSync(join(f.home, 'state/autodeploy-status'), 'preserved state\n');
  const result = f.run('--dry-run');
  assert.match(result.stdout, /fixture descendant/);
  assert.match(result.stdout, /apps\/server\/migrations\/0002_ops.sql/);
  assert.equal(f.read('state/autodeploy-status'), 'preserved state\n');
  assert.equal(f.read('state/autodeploy-failed'), '');
  assert.deepEqual(f.calls('deploy-calls'), []);
  assert.doesNotMatch(result.stderr, /deploy OK|deploy FAILED/);
});

test('pause·resume은 스위치만 바꾸고 retry도 일시정지를 우회하지 않는다', t => {
  const f = fixture(t);
  f.publish();
  f.run('--pause');
  f.run('--retry');
  assert.deepEqual(f.calls('deploy-calls'), []);
  const status = f.run('--status');
  assert.match(status.stdout, /일시정지 중/);
  f.run('--resume');
  assert.equal(existsSync(join(f.home, 'AUTO_DEPLOY_PAUSED')), false);
  assert.deepEqual(f.calls('deploy-calls'), []);
  f.run();
  assert.deepEqual(f.calls('deploy-calls'), [f.next]);
});

test('운영 기본 계정 검사는 유지하고 시험 우회는 격리 경로에서만 허용한다', t => {
  const f = fixture(t);
  const denied = spawnSync('sh', [autoScript, '--status'], {
    env: { ...f.env, WE_OPS_TEST_MODE: '0' },
    encoding: 'utf8',
  });
  // 실제 wesvc로 실행하는 환경에서는 기본 검사 자체가 정상 통과할 수 있다.
  if (spawnSync('id', ['-un'], { encoding: 'utf8' }).stdout.trim() !== 'wesvc') {
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /wesvc 계정/);
  }
  const unsafeTestHome = spawnSync('sh', [autoScript, '--status'], {
    env: { ...f.env, WE_HOME: '/Users/wesvc/writeessay-server' },
    encoding: 'utf8',
  });
  assert.equal(unsafeTestHome.status, 1);
  assert.match(unsafeTestHome.stderr, /격리된 WE_HOME/);
});

test('deploy.sh는 수업 시간 거부를 75로 반환하고 잘못된 git SHA를 거부한다', t => {
  const f = fixture(t);
  const script = join(root, 'ops/scripts/deploy.sh');
  const school = spawnSync('sh', [script, '--git', f.next], {
    env: { ...f.env, WE_TEST_KST_DOW_HOUR: '4:10', WE_SCHOOL_HOURS_GUARD: 'on' },
    encoding: 'utf8',
  });
  assert.equal(school.status, 75);
  assert.match(school.stderr, /수업 시간 금지창/);
  // 개발 중(기본값 off, ADR-062)에는 같은 시각이어도 금지창으로 거부하지 않는다.
  const dev = spawnSync('sh', [script, '--git', f.next], {
    env: { ...f.env, WE_TEST_KST_DOW_HOUR: '4:10' },
    encoding: 'utf8',
  });
  assert.doesNotMatch(dev.stderr, /수업 시간 금지창/);
  const invalid = spawnSync('sh', [script, '--git', 'bad-sha'], { env: f.env, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /40자/);
});

test('deploy.sh가 배포 잠금 안에서 운영 SHA 변경과 수동 일시정지를 다시 확인한다', t => {
  const f = fixture(t);
  const script = join(root, 'ops/scripts/deploy.sh');
  const changed = spawnSync('sh', [script, '--git', f.next], {
    env: { ...f.env, WE_AUTODEPLOY_RUN: '1', WE_AUTODEPLOY_BASE: f.next },
    encoding: 'utf8',
  });
  assert.equal(changed.status, 75);
  assert.match(changed.stderr, /운영 커밋이 바뀌어/);
  assert.equal(existsSync(join(f.home, 'state/deploy.lock')), false);
  writeFileSync(join(f.home, 'AUTO_DEPLOY_PAUSED'), '');
  const paused = spawnSync('sh', [script, '--git', f.next], {
    env: { ...f.env, WE_AUTODEPLOY_RUN: '1', WE_AUTODEPLOY_BASE: f.base },
    encoding: 'utf8',
  });
  assert.equal(paused.status, 75);
  assert.match(paused.stderr, /일시정지/);
});

test('deploy.sh도 활성 연결과 잘못된 연결 응답을 75로 처리한다', t => {
  const f = fixture(t);
  for (const body of ['{"connections":2}', 'invalid']) {
    writeFileSync(join(f.home, 'health.json'), body);
    const result = spawnSync('sh', [join(root, 'ops/scripts/deploy.sh'), '--git', f.next], {
      env: { ...f.env, WE_AUTODEPLOY_RUN: '1', WE_AUTODEPLOY_BASE: f.base },
      encoding: 'utf8',
    });
    assert.equal(result.status, 75);
    assert.match(result.stderr, /실시간 연결/);
    assert.equal(existsSync(join(f.home, 'state/deploy.lock')), false);
  }
});

test('자원 가드가 없거나 75를 반환하면 실제 배포를 실행하지 않고 기다린다', t => {
  const f = fixture(t);
  f.publish();
  const guard = join(f.home, 'guard.sh');
  const overrides = { WE_AUTODEPLOY_DEPLOY_CMD: '', WE_RESOURCE_GUARD: guard, RESOURCE_GUARD_ACTIVE: '' };
  f.run(undefined, overrides);
  assert.equal(f.read('state/autodeploy-failed'), '');
  assert.match(f.read('state/autodeploy-status'), /자원 가드 접근 불가/);
  writeFileSync(
    guard,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$WE_HOME/guard-calls"\nprintf "%s\\n" "$WE_AUTODEPLOY_BASE" > "$WE_HOME/guard-base"\nexit 75\n',
  );
  chmodSync(guard, 0o700);
  f.run(undefined, overrides);
  assert.deepEqual(f.calls('guard-calls'), [
    'run',
    '--profile',
    'build',
    '--',
    'sh',
    join(root, 'ops/scripts/deploy.sh'),
    '--git',
    f.next,
  ]);
  assert.equal(f.read('guard-base').trim(), f.base);
  assert.deepEqual(f.calls('deploy-calls'), []);
  assert.equal(f.read('state/autodeploy-failed'), '');
  assert.match(f.read('state/autodeploy-status'), /배포 대기/);
});

test('CI 전송 실패도 120초 조회 간격을 지키며 실패로 세지 않는다', t => {
  const f = fixture(t);
  f.publish();
  writeFileSync(f.env.WE_AUTODEPLOY_CI_CMD, '#!/bin/sh\nprintf "query\\n" >> "$WE_HOME/ci-calls"\nexit 22\n');
  f.run();
  f.run();
  assert.deepEqual(f.calls('ci-calls'), ['query']);
  assert.deepEqual(f.calls('deploy-calls'), []);
  assert.equal(f.read('state/autodeploy-failed'), '');
});

test('자동 회차 잠금이 있으면 같은 SHA를 동시에 배포하지 않는다', t => {
  const f = fixture(t);
  f.publish();
  mkdirSync(join(f.home, 'state/autodeploy.lock'));
  writeFileSync(join(f.home, 'state/autodeploy.lock/pid'), String(process.pid));
  const result = f.run();
  assert.match(result.stdout, /다른 자동 배포 회차/);
  assert.deepEqual(f.calls('deploy-calls'), []);
  assert.deepEqual(f.calls('ci-calls'), []);
  assert.equal(f.read('state/autodeploy-failed'), '');
});

test('회차 로그는 최근 20개만 남기고 다른 운영 기록은 보존한다', t => {
  const f = fixture(t);
  f.publish();
  const logs = join(f.home, 'logs');
  mkdirSync(logs);
  for (let i = 0; i < 22; i += 1) {
    writeFileSync(join(logs, `autodeploy-run-${i.toString(16).padStart(40, '0')}.log`), 'fixture');
  }
  writeFileSync(join(logs, 'build-preserved.log'), 'preserved');
  writeFileSync(join(logs, 'autodeploy.log'), 'preserved');
  f.run();
  const kept = readdirSync(logs).filter(name => name.startsWith('autodeploy-run-'));
  assert.equal(kept.length, 20);
  assert.ok(kept.includes(`autodeploy-run-${f.next}.log`));
  assert.equal(f.read('logs/build-preserved.log'), 'preserved');
  assert.equal(f.read('logs/autodeploy.log'), 'preserved');
});
