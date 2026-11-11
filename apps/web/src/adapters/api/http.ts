import { createApiSchemas, errorEnvelopeSchema } from '@geulbang/core/api';
import type { Config } from '@geulbang/core/config';
import { errorCatalog, isErrorCode } from '@geulbang/core/errors';
import { z } from 'zod';
import type { ApiError, ApiPort } from '../../ports/api.ts';
import { readPolishLines } from '../ai/polishStream.ts';
import type { ServerClock } from '../realtime/serverClock.ts';

/**
 * REST 어댑터(PLAN §7.2). 봉투를 풀고, `X-Server-Now`로 서버 시각을 맞추고, 실패를 `ApiError`로 바꾼다.
 * - 응답이 없으면 인터넷이 끊겼는지에 따라 `E_OFFLINE` / `E_SERVER_DOWN`.
 * - 응답 모양이 규약과 다르면 `E_VERSION`(서버가 새 판으로 바뀌었을 가능성, "새로워졌어요. 다시 열어 주세요.").
 */
export interface HttpApiDeps {
  readonly config: Readonly<Config>;
  readonly clock?: ServerClock;
  readonly base?: string;
  readonly fetch?: typeof fetch;
  readonly isOnline?: () => boolean;
}

const fail = (code: ApiError['code'], message = ''): ApiError => ({
  code,
  message,
  retryable: errorCatalog[code].retryable,
});

export function createHttpApi(deps: HttpApiDeps): ApiPort {
  const schemas = createApiSchemas(deps.config);
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const base = deps.base ?? '';
  const isOnline = deps.isOnline ?? (() => globalThis.navigator?.onLine ?? true);

  async function request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    result: z.ZodType<T>,
    body?: unknown,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const started = Date.now();
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        credentials: 'same-origin',
        ...(signal ? { signal } : {}),
      });
    } catch {
      throw fail(isOnline() ? 'E_SERVER_DOWN' : 'E_OFFLINE');
    }
    const serverNow = Number(res.headers.get('x-server-now'));
    if (Number.isFinite(serverNow) && serverNow > 0) deps.clock?.observe(serverNow, Date.now() - started);

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw fail(res.status >= 500 ? 'E_SERVER_DOWN' : 'E_VERSION');
    }
    if (!res.ok) {
      const env = errorEnvelopeSchema.safeParse(json);
      if (!env.success) throw fail(res.status >= 500 ? 'E_SERVER_DOWN' : 'E_VERSION');
      const code = isErrorCode(env.data.error.code) ? env.data.error.code : 'E_INTERNAL';
      throw {
        code,
        message: env.data.error.message,
        retryable: env.data.error.retryable,
        ...(env.data.error.fields ? { fields: env.data.error.fields } : {}),
      } satisfies ApiError;
    }
    const env = z.object({ data: result, requestId: z.string() }).safeParse(json);
    if (!env.success) throw fail('E_VERSION');
    return env.data.data;
  }

  return {
    createRoom: (input, startCode) =>
      request(
        'POST',
        '/api/rooms',
        schemas.createRoomResult,
        input,
        startCode ? { 'x-start-code': startCode } : {},
      ),
    roomByCode: (code, deviceId) =>
      request(
        'GET',
        `/api/rooms/by-code/${encodeURIComponent(code)}`,
        schemas.roomByCodeResult,
        undefined,
        deviceId ? { 'x-device-id': deviceId } : {},
      ),
    aiStructured: (roomId, token, input) =>
      request('POST', `/api/rooms/${encodeURIComponent(roomId)}/ai`, schemas.aiStructuredResult, input, {
        authorization: `Bearer ${token}`,
      }),
    aiPolish: (roomId, token, input, signal) => ({
      async *[Symbol.asyncIterator]() {
        let res: Response;
        try {
          res = await doFetch(`${base}/api/rooms/${encodeURIComponent(roomId)}/ai`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify(input),
            credentials: 'same-origin',
            signal,
          });
        } catch {
          if (signal.aborted) return;
          throw fail(isOnline() ? 'E_SERVER_DOWN' : 'E_OFFLINE');
        }
        if (!res.ok || !res.body) {
          const env = errorEnvelopeSchema.safeParse(await res.json().catch(() => null));
          const code =
            env.success && isErrorCode(env.data.error.code) ? env.data.error.code : 'E_AI_PROVIDER';
          throw fail(code);
        }
        yield* readPolishLines(res.body);
      },
    }),
    resumeRequest: (roomId, input) =>
      request(
        'POST',
        `/api/rooms/${encodeURIComponent(roomId)}/resume-requests`,
        schemas.resumeRequestResult,
        input,
      ),
    resumeStatus: (roomId, requestId, token, waitSec, signal) =>
      request(
        'GET',
        `/api/rooms/${encodeURIComponent(roomId)}/resume-requests/${encodeURIComponent(requestId)}?wait=${Math.max(0, Math.floor(waitSec))}`,
        schemas.resumeStatusResult,
        undefined,
        { authorization: `Bearer ${token}` },
        signal,
      ),
    resumeCancel: (roomId, requestId, token) =>
      request(
        'DELETE',
        `/api/rooms/${encodeURIComponent(roomId)}/resume-requests/${encodeURIComponent(requestId)}`,
        schemas.resumeStatusResult,
        undefined,
        { authorization: `Bearer ${token}` },
      ),
    teacherPin: input => request('POST', '/api/teacher/pin', schemas.teacherPinResult, input),
    teacherSession: token =>
      request('GET', '/api/teacher/session', schemas.teacherSessionResult, undefined, {
        authorization: `Bearer ${token}`,
      }),
    teacherRoom: (roomId, token, signal) =>
      request(
        'GET',
        `/api/teacher/rooms/${encodeURIComponent(roomId)}`,
        schemas.teacherRoomResult,
        undefined,
        {
          authorization: `Bearer ${token}`,
        },
        signal,
      ),
    teacherPinView: (roomId, token) =>
      request(
        'GET',
        `/api/teacher/rooms/${encodeURIComponent(roomId)}/pin`,
        schemas.teacherPinViewResult,
        undefined,
        {
          authorization: `Bearer ${token}`,
        },
      ),
    checkAi: (roomId, token, signal) =>
      request(
        'POST',
        `/api/teacher/rooms/${encodeURIComponent(roomId)}/check-ai`,
        schemas.checkAiResult,
        {},
        {
          authorization: `Bearer ${token}`,
        },
        signal,
      ),
    exportRoom: (roomId, token, scope) =>
      request(
        'GET',
        `/api/teacher/rooms/${encodeURIComponent(roomId)}/export?scope=${scope}`,
        schemas.exportResult,
        undefined,
        { authorization: `Bearer ${token}` },
      ),
    join: (roomId, input) =>
      request('POST', `/api/rooms/${encodeURIComponent(roomId)}/join`, schemas.joinResult, input),
  };
}
