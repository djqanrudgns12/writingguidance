import { createApiSchemas } from '@geulbang/core/api';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AiPort } from '../../ai/port.ts';
import {
  prepareAiRequest,
  runPolishRequest,
  runStructuredRequest,
  type AiRequestDeps,
} from '../../application/aiRequest.ts';
import type { ServerConfig } from '../../config.ts';
import type { Logger } from '../../log.ts';
import type { RealtimeServices } from '../../realtime/hocuspocus.ts';
import type { Repos } from '../../store/repos/index.ts';
import { studentFor } from '../bearer.ts';
import { okCommand, type AppEnv } from '../envelope.ts';
import { parseInput, readJson } from '../input.ts';

/**
 * `POST /api/rooms/:roomId/ai`(학생 Bearer, PLAN §7.2·§8). 본문 크기는 `AI_REQUEST_MAX_BYTES`(`app.ts`가 이 경로만 넓힌다).
 * - 맞춤법·한마디·방향: 봉투 `{data: aiStructuredResult, requestId, commandId}`.
 * - 다듬은 글: `application/x-ndjson`으로 `PolishLine` 한 줄씩(PLAN §8.3). 기기가 끊으면 요청 신호가 끊겨
 *   제공사 호출도 멈추고 정산한다. 한도·입력 오류처럼 시작 전에 나는 오류는 보통 봉투로 답한다.
 */
export interface AiRouteDeps {
  readonly config: ServerConfig;
  readonly repos: Repos;
  readonly log: Logger;
  readonly now: () => number;
  readonly services: RealtimeServices;
  readonly ai: AiPort | null;
}

const uuid = z.uuid();

export function mountAiRoutes(app: Hono<AppEnv>, deps: AiRouteDeps): void {
  const schemas = createApiSchemas(deps.config.product);
  const aiDeps: AiRequestDeps = {
    config: deps.config,
    repos: deps.repos,
    log: deps.log,
    now: deps.now,
    ai: deps.ai,
    gate: deps.services.gate,
    snapshots: deps.services.snapshots,
    hocuspocus: deps.services.hocuspocus,
  };

  app.post('/api/rooms/:roomId/ai', async c => {
    const roomId = parseInput(uuid, c.req.param('roomId'), 'roomId');
    const student = studentFor(
      { repos: deps.repos, gate: deps.services.gate },
      c.req.raw.headers,
      roomId,
      deps.now(),
    );
    const body = parseInput(schemas.aiRequestBody, await readJson(c));
    const prepared = prepareAiRequest(
      aiDeps,
      {
        deviceRowId: student.device.id,
        participantId: student.participant.id,
        consentVersion: student.participant.consentVersion,
        room: student.room,
      },
      body,
    );
    if (prepared.kind === 'replay') return okCommand(c, prepared.result, body.commandId);

    const signal = c.req.raw.signal;
    if (body.button !== 'POLISH') {
      const result = await runStructuredRequest(aiDeps, prepared.ticket, signal);
      return okCommand(c, result, body.commandId);
    }

    const lines = runPolishRequest(aiDeps, prepared.ticket, signal);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await lines.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
      },
      async cancel() {
        await lines.return(undefined);
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
    });
  });
}
