#!/usr/bin/env node
/**
 * 개발 서버 둘을 함께 띄운다(PLAN §2.1): 서버 4461(`--watch`) + 웹 Vite 4462.
 * - `npm run dev`            : 보통 개발. 개발 시험 문서(`/dev/editor`)도 켠다(DEV_DOCS_ENABLED=true).
 * - `npm run dev -- --devices`: 실기기 시험. 시험 빌드(`dist-devices`)를 서버 한 곳(4461)이 내준다(P2-8).
 *   먼저 `npm run build:devices`로 빌드해 둔다. 이때는 Vite를 띄우지 않는다.
 * 한쪽이 끝나면 다른 쪽도 끝낸다. 출력 줄 앞에 [server]·[web]을 붙인다.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const devices = process.argv.includes('--devices');

if (devices && !existsSync(new URL('../apps/web/dist-devices/dev/index.html', import.meta.url))) {
  process.stderr.write('시험 빌드가 없습니다. 먼저 `npm run build:devices`를 실행하세요.\n');
  process.exit(1);
}

const serverEnv = {
  ...process.env,
  DEV_DOCS_ENABLED: process.env.DEV_DOCS_ENABLED ?? 'true',
  ...(devices ? { WEB_DIST_DIR: 'apps/web/dist-devices' } : {}),
};

const jobs = [{ name: 'server', args: ['run', 'dev', '-w', '@geulbang/server'], env: serverEnv }];
if (!devices) jobs.push({ name: 'web', args: ['run', 'dev', '-w', '@geulbang/web'], env: process.env });

const children = jobs.map(job => {
  const child = spawn('npm', job.args, { cwd: root, env: job.env, stdio: ['ignore', 'pipe', 'pipe'] });
  // 줄 단위로 앞머리를 붙인다. 덜 끝난 줄은 다음 조각과 이어 붙인다.
  const pipe = (stream, out) => {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) out.write(`[${job.name}] ${line}\n`);
    });
    stream.on('end', () => {
      if (rest) out.write(`[${job.name}] ${rest}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return { job, child };
});

let stopping = false;
const stopAll = signal => {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) if (child.exitCode === null) child.kill(signal);
};

for (const { job, child } of children) {
  child.on('exit', code => {
    if (!stopping) process.stderr.write(`[${job.name}] 끝남(${code ?? 'signal'}). 나머지도 끝냅니다.\n`);
    stopAll('SIGTERM');
    if (children.every(c => c.child.exitCode !== null || c.child.signalCode !== null))
      process.exit(code ?? 0);
  });
}
process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));
