import { defineProject } from 'vitest/config';
import { defaultServerConditions } from 'vite';

export default defineProject({
  ssr: { resolve: { conditions: ['@geulbang/source', ...defaultServerConditions] } },
  test: { name: 'server', environment: 'node', include: ['test/**/*.test.ts', 'src/**/*.test.ts'] },
});
