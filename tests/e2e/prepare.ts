import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_DB_DIR, E2E_WEB_DIST_DIR } from './constants.ts';

/**
 * Playwright `webServer`가 시험 서버를 띄우기 직전에 실행한다.
 * 1) 시험 빌드(`apps/web/dist-devices`)가 없으면 빌드를 대신 돌리지 않고 알기 쉬운 안내와 함께 멈춘다.
 * 2) `.local/e2e/` 폴더 안의 이전 SQLite 파일만 지워 매 실행을 깨끗한 DB에서 시작한다.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const distDir = resolve(repoRoot, E2E_WEB_DIST_DIR);
const appEntry = resolve(distDir, 'index.html');
const devEntry = resolve(distDir, 'dev/index.html');

if (!existsSync(appEntry) || !existsSync(devEntry)) {
  process.stderr.write(
    [
      `[e2e] 시험 웹 빌드를 찾을 수 없습니다: ${E2E_WEB_DIST_DIR}/dev/index.html`,
      '화면 시험을 돌리기 전에 먼저 아래 명령으로 실기기·개발 화면 빌드를 만들어 주세요:',
      '  npm run build:devices',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const localRoot = resolve(repoRoot, '.local');
const e2eDir = resolve(repoRoot, E2E_DB_DIR);
const rel = relative(localRoot, e2eDir);
if (rel !== 'e2e') {
  process.stderr.write(`[e2e] 예상치 못한 DB 정리 경로를 거부했습니다: ${e2eDir}\n`);
  process.exit(1);
}

rmSync(e2eDir, { recursive: true, force: true });
mkdirSync(e2eDir, { recursive: true });
