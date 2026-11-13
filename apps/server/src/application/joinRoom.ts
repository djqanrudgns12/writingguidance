import { randomUUID } from 'node:crypto';
import type { ApiOutput } from '@geulbang/core/api';
import { AppError } from '@geulbang/core/errors';
import type { ServerConfig } from '../config.ts';
import { deviceHmac } from '../security/hmac.ts';
import { checkCodeLookupRateLimit } from '../security/rateLimit.ts';
import { isUniqueViolation } from '../store/db.ts';
import { hashArgs } from '../store/repos/commands.ts';
import type { Repos } from '../store/repos/index.ts';
import { roomStatusAt } from '../store/repos/rooms.ts';
import { assertConsentCurrent } from './consent.ts';
import { normalizeNickname } from './nickname.ts';

/**
 * 학생 첫 입장(PLAN §2.3 ②, PRD F-02~F-04).
 * 별명 정규화 → 수업방 상태(없음·만료·닫힘) → 같은 별명이면 `E_NICK_TAKEN`(기기는 `내가 쓰던 거예요`/`다른 별명` 카드)
 * → 인원이 차면 `E_ROOM_FULL` → 참가자 + 기기(토큰 해시) 한 트랜잭션. 동의는 지금 정책 판이어야 받는다.
 * 기기 토큰은 기기가 만들고 해시만 온다. 같은 `commandId`로 다시 보내면 같은 결과다.
 */
export type JoinBody = ApiOutput<'joinBody'>;
export type JoinResult = ApiOutput<'joinResult'>;

export interface JoinRoomDeps {
  readonly config: ServerConfig;
  readonly repos: Repos;
  readonly now: () => number;
}

export function joinRoom(
  deps: JoinRoomDeps,
  input: { readonly roomId: string; readonly body: JoinBody; readonly ip: string },
): { readonly result: JoinResult; readonly replayed: boolean } {
  const { config, repos } = deps;
  const p = config.product;
  const { roomId, body } = input;
  const now = deps.now();

  const { commandId, ...args } = body;
  const key = {
    id: commandId,
    actorKind: 'ANON' as const,
    actorId: deviceHmac(config.secrets, body.deviceId),
    name: 'room.join',
    argsHash: hashArgs({ roomId, ...args }),
  };
  const previous = repos.commands.replay<JoinResult>(key);
  if (previous) return previous;

  checkCodeLookupRateLimit({
    db: repos.db,
    product: p,
    secrets: config.secrets,
    deviceId: body.deviceId,
    ip: input.ip,
    now,
  });

  // 기기는 조회 응답의 `policyVersion`으로 동의를 받는다. 그사이 정책이 바뀌었으면 다시 받게 한다(PRD F-03).
  assertConsentCurrent(body.consentVersion, p.POLICY_VERSION);
  const nickname = normalizeNickname(body.nickname, p);

  return repos.commands.runOnce({ ...key, roomId }, now, () => {
    const room = repos.rooms.findById(roomId);
    if (!room) throw new AppError('E_ROOM_NOT_FOUND');
    const status = roomStatusAt(room, now);
    if (status === 'EXPIRED') throw new AppError('E_ROOM_EXPIRED');
    if (status === 'CLOSED') throw new AppError('E_ROOM_CLOSED');

    if (repos.participants.findByNickname(roomId, nickname.norm)) throw new AppError('E_NICK_TAKEN');
    if (repos.participants.countInRoom(roomId) >= p.ROOM_MAX_PARTICIPANTS) throw new AppError('E_ROOM_FULL');

    const participantId = randomUUID();
    try {
      repos.participants.insert({
        id: participantId,
        roomId,
        nickname: nickname.display,
        nicknameNorm: nickname.norm,
        consentVersion: body.consentVersion,
        createdAt: now,
      });
    } catch (error) {
      if (isUniqueViolation(error, 'participants.nickname_norm')) throw new AppError('E_NICK_TAKEN');
      throw error;
    }
    try {
      repos.devices.insert({
        id: randomUUID(),
        participantId,
        tokenHash: body.deviceTokenHash,
        deviceId: body.deviceId,
        approvedAt: now,
      });
    } catch (error) {
      if (isUniqueViolation(error, 'devices.token_hash')) {
        throw new AppError('E_INPUT', 'device token reused', { deviceTokenHash: 'taken' });
      }
      throw error;
    }
    return { participantId, nickname: nickname.display };
  });
}
