import { randomUUID } from 'node:crypto';
import { validateNickname, type ResumeStatus } from '@geulbang/core';
import type { ApiOutput } from '@geulbang/core/api';
import { AppError } from '@geulbang/core/errors';
import type { ServerConfig } from '../config.ts';
import type { RoomEvents } from '../realtime/roomEvents.ts';
import type { RoomGate } from '../realtime/roomGate.ts';
import { deviceHmac } from '../security/hmac.ts';
import { checkCodeLookupRateLimit } from '../security/rateLimit.ts';
import { isUniqueViolation } from '../store/db.ts';
import { hashArgs } from '../store/repos/commands.ts';
import type { Repos } from '../store/repos/index.ts';
import { roomStatusAt } from '../store/repos/rooms.ts';
import type { ResumeWaiters } from './resumeWaiters.ts';

/**
 * 다른 기기 이어 쓰기(PRD F-14, PLAN §2.3 ④).
 * 1. 새 기기가 토큰을 만들어 해시와 함께 요청 → `requestId`. 같은 기기·같은 별명의 대기 요청이 있으면 그것을 돌려준다.
 *    교사 연결에 `resume.pending`(교사가 없으면 들어올 때 `hello.pendingResumes`).
 * 2. 기기는 `Bearer {새 토큰}`으로 긴 조회를 반복한다. 서버는 해시가 그 요청과 맞는지만 본다.
 * 3. 교사 결정(`resume.decide`)이나 기기 취소가 나면 기다리던 조회가 바로 답한다. 허용이면 그 토큰이 곧 기기 토큰이다.
 * 요청은 저절로 사라지지 않는다(수업방이 지워질 때만).
 */
export type ResumeRequestBody = ApiOutput<'resumeRequestBody'>;

export interface ResumeDeps {
  readonly config: ServerConfig;
  readonly repos: Repos;
  readonly gate: RoomGate;
  readonly events: RoomEvents;
  readonly waiters: ResumeWaiters;
  readonly now: () => number;
}

export function createResumeRequest(
  deps: ResumeDeps,
  input: { readonly roomId: string; readonly body: ResumeRequestBody; readonly ip: string },
): { readonly result: { requestId: string }; readonly replayed: boolean } {
  const { config, repos } = deps;
  const { roomId, body } = input;
  const now = deps.now();
  const { commandId, ...args } = body;
  const key = {
    id: commandId,
    actorKind: 'ANON' as const,
    actorId: deviceHmac(config.secrets, body.deviceId),
    name: 'resume.request',
    argsHash: hashArgs({ roomId, ...args }),
  };
  const previous = repos.commands.replay<{ requestId: string }>(key);
  if (previous) return previous;
  checkCodeLookupRateLimit({
    db: repos.db,
    product: config.product,
    secrets: config.secrets,
    deviceId: body.deviceId,
    ip: input.ip,
    now,
  });
  deps.gate.assertOpen(roomId);
  const nickname = validateNickname(body.nickname, config.product);
  if (!nickname.ok)
    throw new AppError('E_NICK_INVALID', 'nickname', { nickname: nickname.reason.toLowerCase() });

  let created = false;
  const outcome = repos.commands.runOnce({ ...key, roomId }, now, () => {
    const room = repos.rooms.findById(roomId);
    if (!room) throw new AppError('E_ROOM_NOT_FOUND');
    const status = roomStatusAt(room, now);
    if (status === 'EXPIRED') throw new AppError('E_ROOM_EXPIRED');
    if (status === 'CLOSED') throw new AppError('E_ROOM_CLOSED');
    const participant = repos.participants.findByNickname(roomId, nickname.nicknameKey);
    if (!participant) throw new AppError('E_INPUT', 'no such nickname in this room', { nickname: 'unknown' });
    const waiting = repos.resumeRequests.findPending(participant.id, body.deviceId);
    if (waiting) return { requestId: waiting.id };
    const requestId = randomUUID();
    try {
      repos.resumeRequests.insert({
        id: requestId,
        roomId,
        participantId: participant.id,
        deviceId: body.deviceId,
        deviceTokenHash: body.deviceTokenHash,
        createdAt: now,
      });
    } catch (error) {
      if (isUniqueViolation(error, 'resume_requests.device_token_hash')) {
        throw new AppError('E_INPUT', 'device token reused', { deviceTokenHash: 'taken' });
      }
      throw error;
    }
    created = true;
    return { requestId };
  });
  if (created) deps.events.toTeachers(roomId, 'resume.pending', repos.resumeRequests.listPending(roomId));
  return outcome;
}

/** 요청과 그 요청을 만든 기기의 토큰이 맞는지. 아니면(없는 요청 포함) `E_AUTH`. */
function ownedRequest(deps: ResumeDeps, roomId: string, requestId: string, tokenHash: string) {
  const request = deps.repos.resumeRequests.findById(requestId);
  if (!request || request.roomId !== roomId || request.deviceTokenHash !== tokenHash) {
    throw new AppError('E_AUTH', 'unknown request or token');
  }
  return request;
}

export async function pollResume(
  deps: ResumeDeps,
  input: {
    readonly roomId: string;
    readonly requestId: string;
    readonly tokenHash: string;
    readonly waitSec: number;
    readonly signal: AbortSignal;
  },
): Promise<{ status: ResumeStatus }> {
  deps.gate.assertOpen(input.roomId);
  const request = ownedRequest(deps, input.roomId, input.requestId, input.tokenHash);
  if (request.status !== 'PENDING' || input.waitSec <= 0) return { status: request.status };
  const waitMs = Math.min(input.waitSec, deps.config.product.RESUME_LONGPOLL_SEC) * 1000;
  await deps.waiters.wait(input.requestId, waitMs, input.signal);
  // 기다리는 사이 방이 지워졌으면 행이 없다.
  deps.gate.assertOpen(input.roomId);
  const after = deps.repos.resumeRequests.findById(input.requestId);
  if (!after) throw new AppError('E_ROOM_EXPIRED');
  return { status: after.status };
}

export function cancelResume(
  deps: ResumeDeps,
  input: { readonly roomId: string; readonly requestId: string; readonly tokenHash: string },
): { status: ResumeStatus } {
  deps.gate.assertOpen(input.roomId);
  ownedRequest(deps, input.roomId, input.requestId, input.tokenHash);
  const changed = deps.repos.resumeRequests.decide(input.requestId, input.roomId, 'CANCELLED', deps.now());
  if (changed === 1) {
    deps.waiters.notify(input.requestId);
    deps.events.toTeachers(input.roomId, 'resume.decided', {
      requestId: input.requestId,
      status: 'CANCELLED',
    });
  }
  const current = deps.repos.resumeRequests.findById(input.requestId);
  return { status: current?.status ?? 'CANCELLED' };
}
