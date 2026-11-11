import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import type { AppEnv } from './envelope.ts';

/**
 * 웹 빌드(`apps/web/dist`)를 내준다(PLAN §2.1).
 * - 해시 붙은 자산(`/assets/*`·`/art/*`)은 1년 캐시. CloudFront도 이 경로만 캐시한다.
 * - `index.html`·`sw.js`·매니페스트는 `no-cache`(새 판이 바로 보이게, 적용 시점은 PWA 규칙이 정함).
 * - 파일이 없는 화면 경로(`/{code}`, `/t/...`)는 앱 껍데기(`index.html`)를 준다.
 * - 실기기 시험 빌드(`vite build --mode devices`)를 `DEV_DOCS_ENABLED`로 내줄 때만 `/dev/*`를 개발 화면 껍데기
 *   (`dev/index.html`)로 보낸다. 운영 빌드에는 `dev/`가 없고(번들 검사), 운영에서는 `DEV_DOCS_ENABLED`가 시작 거부라 두 겹으로 막힌다.
 */
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';
const RESERVED = /^\/(api|ws|internal)(\/|$)/;
const DEV_PAGE = /^\/dev(\/|$)/;

export interface StaticOptions {
  readonly devPages?: boolean;
}

export function mountStatic(app: Hono<AppEnv>, distDir: string, options: StaticOptions = {}): boolean {
  const indexFile = join(distDir, 'index.html');
  if (!existsSync(indexFile)) return false;
  const devShell = options.devPages === true && existsSync(join(distDir, 'dev', 'index.html'));

  app.use('/*', async (c, next) => {
    if (RESERVED.test(c.req.path)) return next();
    return serveStatic<AppEnv>({
      root: distDir,
      onFound: (_path, ctx) => {
        const p = ctx.req.path;
        ctx.header('Cache-Control', p.startsWith('/assets/') || p.startsWith('/art/') ? IMMUTABLE : NO_CACHE);
      },
    })(c, next);
  });

  // 앱 껍데기: 확장자 없는 GET 경로만. 없는 자산 파일은 404 그대로 둔다.
  app.get('/*', async (c, next) => {
    if (RESERVED.test(c.req.path) || /\.[a-z0-9]+$/i.test(c.req.path)) return next();
    return serveStatic<AppEnv>({
      root: distDir,
      rewriteRequestPath: p => (devShell && DEV_PAGE.test(p) ? '/dev/index.html' : '/index.html'),
      onFound: (_path, ctx) => {
        ctx.header('Cache-Control', NO_CACHE);
      },
    })(c, next);
  });
  return true;
}
