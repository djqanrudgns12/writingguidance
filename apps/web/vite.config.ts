import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';
import { ko } from '../../packages/core/src/copy/ko.ts';
import { pwaPlugin } from './scripts/pwa-plugin.mjs';

/**
 * 개발 4462(strictPort), `/api`·`/ws`는 개발 서버 4461로 넘긴다(PLAN §2.1).
 * `--mode devices`(실기기 시험 빌드)만 `/dev/*` 화면을 넣는다. 운영 빌드에는 없다.
 */
const DEV_PATH = /^\/dev(?:\/[^.?]*)?(?:\?.*)?$/;
/** 그림은 `/art/`(해시 붙음, 1년 캐시)로 내보낸다. 첫 화면 예산(PRD 8.8 80KB)을 JS와 따로 재려고 작은 그림도 글자로 넣지 않는다. */
const ART_FILE = /\.(?:webp|png|svg)$/i;

/** 개발 서버에서 `/dev/ui`·`/dev/editor`를 개발 화면 묶음(`dev/index.html`)으로 보낸다. */
const devPages = (): Plugin => ({
  name: 'geulbang-dev-pages',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && DEV_PATH.test(req.url) && !req.url.startsWith('/dev/index.html'))
        req.url = '/dev/index.html';
      next();
    });
  },
});

export default defineConfig(({ mode }) => ({
  plugins: [react(), devPages(), pwaPlugin({ name: ko.common.appName, shortName: ko.common.appShortName })],
  resolve: { conditions: ['@geulbang/source', ...defaultClientConditions] },
  server: {
    host: '127.0.0.1',
    port: 4462,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4461',
      '/ws': { target: 'ws://127.0.0.1:4461', ws: true },
    },
  },
  build: {
    target: 'es2022',
    // 실기기 시험 빌드는 운영 빌드(`dist`)를 더럽히지 않게 따로 둔다. 서버는 `WEB_DIST_DIR`로 이 폴더를 내준다.
    outDir: mode === 'devices' ? 'dist-devices' : 'dist',
    assetsInlineLimit: (file: string) => (ART_FILE.test(file) ? false : undefined),
    rolldownOptions: {
      input: mode === 'devices' ? { app: 'index.html', dev: 'dev/index.html' } : { app: 'index.html' },
      output: {
        assetFileNames: info =>
          ART_FILE.test(info.names[0] ?? '') ? 'art/[name]-[hash][extname]' : 'assets/[name]-[hash][extname]',
      },
    },
  },
}));
