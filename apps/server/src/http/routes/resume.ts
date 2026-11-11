import { createApiSchemas } from '@geulbang/core/api';
import type { Hono } from 'hono';
import { z } from 'zod';
import { cancelResume, createResumeRequest, pollResume, type ResumeDeps } from '../../application/resume.ts';
import type { ServerConfig } from '../../config.ts';
import type { RealtimeServices } from '../../realtime/hocuspocus.ts';
import { clientIpFrom } from '../../security/clientIp.ts';
import { requireBearerTokenHash } from '../../security/tokens.ts';
import type { Repos } from '../../store/repos/index.ts';
import { ok, okCommand, type AppEnv } from '../envelope.ts';
import { parseInput, readJson } from '../input.ts';

/**
 * 이어 쓰기 요청(PLAN §7.2, PRD F-14).
 * - `POST /api/rooms/:roomId/resume-requests` → {requestId}
 * - `GET  /api/rooms/:roomId/resume-requests/:id?wait=20` (Bearer 새 기기 토큰) → {status}. 결정이 나거나
 *   `wait`초(최대 `RESUME_LONGPOLL_SEC`)가 지나면 답한다.
 * - `DELETE /api/rooms/:roomId/resume-requests/:id` (Bearer 새 기기 토큰) → {status}
 */
export interface ResumeRouteDeps {
  readonly config: ServerConfig;
  readonly repos: Repos;
  readonly now: () => number;
  readonly services: RealtimeServices;
}

const uuid = z.uuid();

export function mountResumeRoutes(app: Hono<AppEnv>, deps: ResumeRouteDeps): void {
  const schemas = createApiSchemas(deps.config.product);
  const waitSchema = z.coerce.number().int().min(0).max(deps.config.product.RESUME_LONGPOLL_SEC);
  const resume: ResumeDeps = {
    config: deps.config,
    repos: deps.repos,
    gate: deps.services.gate,
    events: deps.services.events,
    waiters: deps.services.resumeWaiters,
    now: deps.now,
  };

  app.post('/api/rooms/:roomId/resume-requests', async c => {
    const roomId = parseInput(uuid, c.req.param('roomId'), 'roomId');
    const body = parseInput(schemas.resumeRequestBody, await readJson(c));
    const { result } = createResumeRequest(resume, { roomId, body, ip: clientIpFrom(c.req.raw.headers) });
    return okCommand(c, result, body.commandId);
  });

  app.get('/api/rooms/:roomId/resume-requests/:id', async c => {
    const roomId = parseInput(uuid, c.req.param('roomId'), 'roomId');
    const requestId = parseInput(uuid, c.req.param('id'), 'id');
    const tokenHash = requireBearerTokenHash(c.req.raw.headers);
    const rawWait = c.req.query('wait');
    const waitSec = rawWait === undefined ? 0 : parseInput(waitSchema, rawWait, 'wait');
    const result = await pollResume(resume, {
      roomId,
      requestId,
      tokenHash,
      waitSec,
      signal: c.req.raw.signal,
    });
    c.header('Cache-Control', 'no-store');
    return ok(c, result);
  });

  app.delete('/api/rooms/:roomId/resume-requests/:id', c => {
    const roomId = parseInput(uuid, c.req.param('roomId'), 'roomId');
    const requestId = parseInput(uuid, c.req.param('id'), 'id');
    const tokenHash = requireBearerTokenHash(c.req.raw.headers);
    return ok(c, cancelResume(resume, { roomId, requestId, tokenHash }));
  });
}
