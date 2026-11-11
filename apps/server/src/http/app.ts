import { randomUUID } from 'node:crypto';
import { dayKey } from '@geulbang/core';
import { AppError } from '@geulbang/core/errors';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AiPort } from '../ai/port.ts';
import type { ServerConfig } from '../config.ts';
import type { Logger } from '../log.ts';
import type { RealtimeServices } from '../realtime/hocuspocus.ts';
import { cameThroughTunnel } from '../security/clientIp.ts';
import type { Db } from '../store/db.ts';
import type { Repos } from '../store/repos/index.ts';
import { fail, failFromError, ok, type AppEnv } from './envelope.ts';
import { mountAiRoutes } from './routes/ai.ts';
import { mountResumeRoutes } from './routes/resume.ts';
import { mountRoomRoutes } from './routes/rooms.ts';
import { mountTeacherRoutes } from './routes/teacher.ts';
import { mountStatic } from './static.ts';

export interface HttpDeps {
  readonly config: ServerConfig;
  readonly log: Logger;
  readonly db: Db;
  readonly repos: Repos;
  readonly now: () => number;
  /** PIN 전역 감속 대기(PRD F-20). 시험에서 줄일 때 바꾼다. */
  readonly sleep: (ms: number) => Promise<void>;
  /** 실시간 쪽과 함께 쓰는 것(방 문·이벤트·이어 쓰기 대기·스냅샷·메모리 요약) */
  readonly services: RealtimeServices;
  /** AI 제공사. 설정이 없으면 null(AI 요청은 `E_AI_PROVIDER`). */
  readonly ai: AiPort | null;
  readonly startedAt: number;
  readonly schemaVersion: string | null;
  readonly webDistDir: string;
  /** 맥 안 상태 확인용 실시간 숫자 */
  readonly realtimeStats: () => {
    readonly connections: number;
    readonly documents: number;
    readonly persistFailures: number;
  };
}

/** REST 기본 크기 상한(PLAN §7.2). AI 경로만 `AI_REQUEST_MAX_BYTES`로 따로 연다(P4). */
const DEFAULT_BODY_LIMIT = 8 * 1024;
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const AI_PATH = /^\/api\/rooms\/[^/]+\/ai$/;

export function securityHeaders(publicOrigin: string): Record<string, string> {
  const wss = `wss://${new URL(publicOrigin).host}`;
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      `connect-src 'self' ${wss}`,
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "style-src 'self'",
      "style-src-attr 'unsafe-inline'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    // 선생님 링크 토큰이 다른 곳으로 새지 않게(PLAN §7.3)
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

export function createHttpApp(deps: HttpDeps): Hono<AppEnv> {
  const { config, log, db } = deps;
  const app = new Hono<AppEnv>();
  const headers = securityHeaders(config.product.PUBLIC_ORIGIN);

  app.use('*', async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    c.set('requestId', requestId);
    const started = deps.now();
    await next();
    c.header('X-Request-Id', requestId);
    c.header('X-Server-Now', String(deps.now()));
    for (const [name, value] of Object.entries(headers)) c.header(name, value);
    if (c.req.path.startsWith('/api/')) {
      const status = c.res.status;
      const fields = {
        route: `${c.req.method} ${c.req.routePath}`,
        status,
        ms: deps.now() - started,
        requestId,
      };
      if (status >= 500) log.error('http', fields);
      else if (status >= 400) log.info('http', fields);
      else log.debug('http', fields);
    }
  });

  // 기본 8KB, AI 요청만 `AI_REQUEST_MAX_BYTES`(맞춤법 최대 글자 × 한글 3바이트 + 여유, PLAN §7.2)
  const tooLarge = { status: 413, message: 'body too large' } as const;
  const defaultLimit = bodyLimit({
    maxSize: DEFAULT_BODY_LIMIT,
    onError: c => fail(c as never, 'E_INPUT', tooLarge),
  });
  const aiLimit = bodyLimit({
    maxSize: config.product.AI_REQUEST_MAX_BYTES,
    onError: c => fail(c as never, 'E_INPUT', tooLarge),
  });
  app.use('/api/*', (c, next) => (AI_PATH.test(c.req.path) ? aiLimit(c, next) : defaultLimit(c, next)));

  app.get('/api/health', c => {
    db.prepare('SELECT 1').get();
    const now = deps.now();
    const today = dayKey(now, config.product.TIMEZONE);
    const row = db.prepare("SELECT count FROM ai_daily WHERE day = ? AND scope = 'GLOBAL'").get(today) as
      { count: number } | undefined;
    return ok(c, {
      ok: true,
      version: config.ops.RELEASE_ID,
      uptimeSec: Math.floor((now - deps.startedAt) / 1000),
      db: 'ok',
      aiToday: row?.count ?? 0,
      serverNow: now,
    });
  });

  // 맥 안 상태 확인(PLAN §15.2 healthcheck ①). 터널 설정이 ^/internal/을 404로 막고, 여기서도 한 번 더 막는다.
  app.get('/internal/health', c => {
    if (cameThroughTunnel(c.req.raw.headers)) return c.notFound();
    const stats = deps.realtimeStats();
    // 저장하지 못한 글이 있으면 실패로 보인다(하트비트가 메일을 보냄, PLAN §4.7 대응 2).
    const healthy = stats.persistFailures === 0;
    return c.json(
      {
        ok: healthy,
        release: config.ops.RELEASE_ID,
        schemaVersion: deps.schemaVersion,
        db: 'ok',
        connections: stats.connections,
        documents: stats.documents,
        persistFailures: stats.persistFailures,
        serverNow: deps.now(),
      },
      healthy ? 200 : 503,
    );
  });

  const routeDeps = {
    config,
    repos: deps.repos,
    log,
    now: deps.now,
    sleep: deps.sleep,
    services: deps.services,
    ai: deps.ai,
  };
  mountRoomRoutes(app, routeDeps);
  mountResumeRoutes(app, routeDeps);
  mountAiRoutes(app, routeDeps);
  mountTeacherRoutes(app, routeDeps);

  app.all('/api/*', c => fail(c, 'E_INPUT', { status: 404, message: 'unknown route' }));

  const staticMounted = mountStatic(app, deps.webDistDir, { devPages: config.ops.DEV_DOCS_ENABLED });
  if (!staticMounted)
    log.info('static_skipped', { detail: '웹 빌드가 없어 정적 파일을 내주지 않음(개발은 Vite 4462)' });

  app.onError((error, c) => {
    if (error instanceof AppError) return failFromError(c, error);
    log.error('unhandled', {
      route: `${c.req.method} ${c.req.routePath}`,
      requestId: c.get('requestId'),
      error,
    });
    return fail(c, 'E_INTERNAL', { message: 'internal error' });
  });

  return app;
}
