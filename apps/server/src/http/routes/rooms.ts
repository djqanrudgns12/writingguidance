import { createApiSchemas } from '@geulbang/core/api';
import type { Hono } from 'hono';
import { z } from 'zod';
import { createRoom } from '../../application/createRoom.ts';
import { joinRoom } from '../../application/joinRoom.ts';
import { lookupRoom } from '../../application/lookupRoom.ts';
import type { ServerConfig } from '../../config.ts';
import type { Logger } from '../../log.ts';
import type { RealtimeServices } from '../../realtime/hocuspocus.ts';
import { clientIpFrom } from '../../security/clientIp.ts';
import type { Repos } from '../../store/repos/index.ts';
import { ok, okCommand, type AppEnv } from '../envelope.ts';
import { parseInput, readJson } from '../input.ts';

/**
 * 수업방 만들기·코드 조회·입장(PLAN §7.2). 봉투·`X-Server-Now`·보안 머리는 `app.ts`의 공통 미들웨어가 붙이고,
 * 오류는 `AppError`로 던져 `app.onError`가 봉투로 바꾼다. 요청 본문은 규약 스키마(`strict`)로 확인한다.
 *
 * 머리:
 * - `X-Start-Code`: 선생님 시작 코드(PRD F-15). 만들기에만.
 * - `X-Device-Id`: 기기 ID(UUID). 본문이 없는 코드 조회에서 기기 칸을 셀 때 쓴다. 없으면 IP 칸만 센다.
 */
export interface RoomRouteDeps {
  readonly config: ServerConfig;
  readonly repos: Repos;
  readonly log: Logger;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly services: RealtimeServices;
}

const uuid = z.uuid();

export function mountRoomRoutes(app: Hono<AppEnv>, deps: RoomRouteDeps): void {
  const schemas = createApiSchemas(deps.config.product);

  app.post('/api/rooms', async c => {
    const body = parseInput(schemas.createRoomBody, await readJson(c));
    const { result } = await createRoom(
      { ...deps, deleteRoom: deps.services.deleteRoom },
      {
        body,
        startCode: c.req.header('x-start-code')?.trim() || undefined,
        ip: clientIpFrom(c.req.raw.headers),
      },
    );
    return okCommand(c, result, body.commandId);
  });

  app.get('/api/rooms/by-code/:code', c => {
    const entryCode = parseInput(schemas.entryCode, c.req.param('code'), 'code');
    const deviceHeader = uuid.safeParse(c.req.header('x-device-id'));
    const result = lookupRoom(deps, {
      entryCode,
      deviceId: deviceHeader.success ? deviceHeader.data : undefined,
      ip: clientIpFrom(c.req.raw.headers),
    });
    return ok(c, result);
  });

  app.post('/api/rooms/:roomId/join', async c => {
    const roomId = parseInput(uuid, c.req.param('roomId'), 'roomId');
    const body = parseInput(schemas.joinBody, await readJson(c));
    deps.services.gate.assertOpen(roomId);
    const { result, replayed } = joinRoom(deps, { roomId, body, ip: clientIpFrom(c.req.raw.headers) });
    if (!replayed) {
      // 교사 화면에 글이 아직 없는 참가자도 보이게(hello.participants·participant.update)
      const participant = deps.repos.participants.findById(result.participantId);
      if (participant) deps.services.roomState.addParticipant(participant);
    }
    return okCommand(c, result, body.commandId);
  });
}
