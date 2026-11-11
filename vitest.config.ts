import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/core', 'apps/server', 'apps/web', 'tests/integration'],
    // 아직 시험이 없는 묶음(웹은 P2부터)이 있어도 실패로 치지 않는다.
    passWithNoTests: true,
  },
});
