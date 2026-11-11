import { defaultServerConditions } from 'vite';
import { defineProject } from 'vitest/config';

/** 기기 어댑터(apps/web)를 실제 서버(apps/server)에 붙여 보는 시험(PLAN §10.4). Node에서 돈다. */
export default defineProject({
  ssr: { resolve: { conditions: ['@geulbang/source', ...defaultServerConditions] } },
  test: { name: 'integration', environment: 'node', include: ['**/*.test.ts'], testTimeout: 20_000 },
});
