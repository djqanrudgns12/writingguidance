import { MS_PER_SECOND } from '@geulbang/core';
import { AppError } from '@geulbang/core/errors';
import { createApiSchemas } from '@geulbang/core/api';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AiPort } from '../../ai/port.ts';
import { enterWithPin } from '../../application/enterWithPin.ts';
import { exportRoom } from '../../application/exportRoom.ts';
import type { ServerConfig } from '../../config.ts';
import type { Logger } from '../../log.ts';
import type { RealtimeServices } from '../../realtime/hocuspocus.ts';
import { clientIpFrom } from '../../security/clientIp.ts';
import { decryptPin } from '../../security/pinCrypto.ts';
import { requireBearerTokenHash } from '../../security/tokens.ts';
import { checkTeacherAiRateLimit } from '../../security/rateLimit.ts';
import type { Repos } from '../../store/repos/index.ts';
import { roomStatusAt } from '../../store/repos/rooms.ts';
import { teacherFor } from '../bearer.ts';
import { ok, okCommand, type AppEnv } from '../envelope.ts';
import { parseInput, readJson } from '../input.ts';

/**
 * 교사 REST(PLAN §7.2, PRD F-16·F-20·F-21). PIN 입장을 빼면 모두 교사 Bearer(선생님 링크·PIN 세션 토큰)다.
 * - `POST /api/teacher/pin`: PIN 칸·잠금, 기기가 만든 세션 토큰 해시를 PIN 세션으로 등록
 * - `GET /api/teacher/rooms/:roomId`: 수업 준비 화면(입장 코드·짧은 주소·삭제 예정일)
 * - `GET /api/teacher/rooms/:roomId/pin`: PIN `보기`(복호화, 캐시 금지)
 * - `POST /api/teacher/rooms/:roomId/check-ai`: 연결 점검의 AI 항목(하루 `CHECK_AI_PER_DAY`)
 * - `GET /api/teacher/rooms/:roomId/export?scope=submitted|all`: 모두 내려받기
 */
export interface TeacherRouteDeps {
  readonly config: ServerConfig;
  readonly repos: Repos;
  readonly log: Logger;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly services: RealtimeServices;
  readonly ai: AiPort | null;
}

const uuid = z.uuid();
const scopeSchema = z.enum(['submitted', 'all']);

export function mountTeacherRoutes(app: Hono<AppEnv>, deps: TeacherRouteDeps): void {
  const schemas = createApiSchemas(deps.config.product);
  const p = deps.config.product;
  const bearer = { repos: deps.repos, gate: deps.services.gate };
  const teacher = (headers: Headers, rawRoomId: string | undefined) =>
    teacherFor(bearer, headers, parseInput(uuid, rawRoomId, 'roomId'), deps.now());

  app.post('/api/teacher/pin', async c => {
    const body = parseInput(schemas.teacherPinBody, await readJson(c));
    const { result } = await enterWithPin(
      { config: deps.config, repos: deps.repos, gate: deps.services.gate, now: deps.now, sleep: deps.sleep },
      { body, ip: clientIpFrom(c.req.raw.headers) },
    );
    return okCommand(c, result, body.commandId);
  });

  // 선생님 링크 `/t/{토큰}`을 다른 기기에서 열 때: 토큰만으로 어느 방인지 알려 준다(PRD F-20, ADR-056).
  // 토큰 해시가 맞는 세션만 답하고, 방 ID 말고는 아무것도 주지 않는다.
  app.get('/api/teacher/session', c => {
    const session = deps.repos.teacherSessions.findByTokenHash(requireBearerTokenHash(c.req.raw.headers));
    if (!session || session.revokedAt !== null) throw new AppError('E_AUTH', 'unknown or revoked session');
    const { room } = teacher(c.req.raw.headers, session.roomId);
    return ok(c, { roomId: room.id });
  });

  app.get('/api/teacher/rooms/:roomId', c => {
    const { room } = teacher(c.req.raw.headers, c.req.param('roomId'));
    return ok(c, {
      room: {
        id: room.id,
        className: room.className,
        title: room.title,
        schoolName: room.schoolName,
        showSchool: room.showSchool,
        status: roomStatusAt(room, deps.now()),
        genres: room.settings.genres,
        aiButtons: room.settings.aiButtons,
        sound: room.settings.sound,
        createdAt: room.createdAt,
      },
      entryCode: room.entryCode,
      // 학생에게 보여 줄 짧은 주소(PRD F-02 `https://{도메인}/{입장코드}`에서 앞머리를 뺀 것)
      shortUrl: `${new URL(p.PUBLIC_ORIGIN).host}/${room.entryCode}`,
      expiresAt: room.expiresAt,
    });
  });

  app.get('/api/teacher/rooms/:roomId/pin', c => {
    const { room } = teacher(c.req.raw.headers, c.req.param('roomId'));
    const encrypted = deps.repos.rooms.pinEncOf(room.id);
    if (!encrypted) throw new Error('pin_enc 없음');
    c.header('Cache-Control', 'no-store');
    return ok(c, { pin: decryptPin(deps.config.secrets.pinEncKey, encrypted) });
  });

  app.post('/api/teacher/rooms/:roomId/check-ai', async c => {
    const { session } = teacher(c.req.raw.headers, c.req.param('roomId'));
    checkTeacherAiRateLimit({
      db: deps.repos.db,
      product: p,
      secrets: deps.config.secrets,
      teacherSessionKey: session.id,
      now: deps.now(),
    });
    if (!deps.ai) return ok(c, { ok: false, latencyMs: 0 });
    const started = deps.now();
    try {
      const result = await deps.ai.ping({
        model: p.MODEL_FEEDBACK,
        effort: 'off',
        maxTokens: p.AI_MAX_OUTPUT_TOKENS.direction,
        signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(p.AI_TIMEOUT_SEC * MS_PER_SECOND)]),
      });
      return ok(c, result);
    } catch {
      return ok(c, { ok: false, latencyMs: deps.now() - started });
    }
  });

  app.get('/api/teacher/rooms/:roomId/export', c => {
    const { room } = teacher(c.req.raw.headers, c.req.param('roomId'));
    const scope = parseInput(scopeSchema, c.req.query('scope'), 'scope');
    c.header('Cache-Control', 'no-store');
    return ok(c, exportRoom({ hocuspocus: deps.services.hocuspocus, repos: deps.repos }, room, scope));
  });
}
