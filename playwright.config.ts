import { defineConfig, devices } from '@playwright/test';
import {
  E2E_AI_DAILY_PER_PARTICIPANT,
  E2E_BASE_URL,
  E2E_DB_PATH,
  E2E_DESKTOP_VIEWPORT,
  E2E_DEV_SECRET,
  E2E_HOST,
  E2E_PHONE_VIEWPORT,
  E2E_PORT,
  E2E_ROOM_CREATE_PER_DAY,
  E2E_ROOM_TTL_MINUTES,
  E2E_SNAPSHOT_INTERVAL_SEC,
  E2E_START_CODE,
  E2E_WEB_DIST_DIR,
} from './tests/e2e/constants.ts';

/**
 * Playwright 화면 시험 설정(PLAN §10.3·§10.5, P2-6·P4-15).
 * 브라우저는 Chromium만(WebKit 프로젝트는 나중 일). 폭은 1280·360 두 프로젝트로 돌리고,
 * 폭과 관계없는 시험(한글 조합·만료)과 스스로 여러 폭을 도는 배치 시험은 1280 프로젝트에서만 돈다.
 * 시험 서버 하나를 모든 시험이 함께 쓰므로 worker는 1개다.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-1280',
      use: { ...devices['Desktop Chrome'], viewport: E2E_DESKTOP_VIEWPORT },
    },
    {
      name: 'chromium-360',
      use: { ...devices['Desktop Chrome'], viewport: E2E_PHONE_VIEWPORT },
      testIgnore: ['**/ime.spec.ts', '**/layout.spec.ts', '**/retention.spec.ts'],
    },
  ],
  webServer: {
    command:
      'node --conditions=@geulbang/source tests/e2e/prepare.ts && exec node --conditions=@geulbang/source apps/server/src/index.ts',
    url: `${E2E_BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 20_000,
    stdout: 'pipe',
    stderr: 'pipe',
    gracefulShutdown: {
      signal: 'SIGTERM',
      timeout: 5_000,
    },
    env: {
      NODE_ENV: 'test',
      PORT: String(E2E_PORT),
      HOST: E2E_HOST,
      DEV_DOCS_ENABLED: 'true',
      DEV_SECRET: E2E_DEV_SECRET,
      DB_PATH: E2E_DB_PATH,
      WEB_DIST_DIR: E2E_WEB_DIST_DIR,
      // PLAN §10.5 시험 설정
      AI_PROVIDER: 'fake',
      SNAPSHOT_INTERVAL_SEC: String(E2E_SNAPSHOT_INTERVAL_SEC),
      ROOM_TTL_MINUTES_OVERRIDE: String(E2E_ROOM_TTL_MINUTES),
      TEACHER_START_CODE: E2E_START_CODE,
      AI_DAILY_PER_PARTICIPANT: String(E2E_AI_DAILY_PER_PARTICIPANT),
      ROOM_CREATE_PER_IP_PER_DAY: String(E2E_ROOM_CREATE_PER_DAY),
      ROOM_CREATE_PER_DEVICE_PER_DAY: String(E2E_ROOM_CREATE_PER_DAY),
    },
  },
});
