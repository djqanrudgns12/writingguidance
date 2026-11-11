import { randomUUID } from 'node:crypto';
import type { ApiOutput } from '@geulbang/core/api';
import { AppError } from '@geulbang/core/errors';
import type { ServerConfig } from '../config.ts';
import type { RoomGate } from '../realtime/roomGate.ts';
import { deviceHmac, pinHmac } from '../security/hmac.ts';
import { assertPinNotLocked, recordPinFailure, type PinRateLimitOptions } from '../security/rateLimit.ts';
import { isUniqueViolation } from '../store/db.ts';
import { hashArgs } from '../store/repos/commands.ts';
import type { Repos } from '../store/repos/index.ts';

/**
 * PIN으로 들어가기(PRD F-20, PLAN §7.2 `POST /api/teacher/pin`). PIN은 살아 있는 수업방 사이에서 유일하므로
 * PIN만으로 수업방이 정해진다. 기기가 만든 세션 토큰의 해시를 PIN 세션으로 등록하고, 그 토큰이 이 기기의 교사 토큰이 된다.
 * 틀린 시도는 PIN 칸(기기 `PIN_MAX_FAILS`번 → `PIN_LOCK_MIN`분 잠금, IP는 높게, 전체가 많으면 늦춤)으로 센다.
 */
export type TeacherPinBody = ApiOutput<'teacherPinBody'>;
export type TeacherPinResult = ApiOutput<'teacherPinResult'>;

export interface EnterWithPinDeps {
  readonly config: ServerConfig;
  readonly repos: Repos;
  readonly gate: RoomGate;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export async function enterWithPin(
  deps: EnterWithPinDeps,
  input: { readonly body: TeacherPinBody; readonly ip: string },
): Promise<{ readonly result: TeacherPinResult; readonly replayed: boolean }> {
  const { config, repos } = deps;
  const { body } = input;
  const now = deps.now();
  const pinOptions: PinRateLimitOptions = {
    db: repos.db,
    product: config.product,
    secrets: config.secrets,
    deviceId: body.deviceId,
    ip: input.ip,
    now,
  };
  // 잠긴 동안은 맞는 PIN도 막는다(안 그러면 잠금이 맞히기를 늦추지 못한다).
  const { delayMs } = assertPinNotLocked(pinOptions);
  const pinHmacValue = pinHmac(config.secrets, body.pin);
  const key = {
    id: body.commandId,
    actorKind: 'ANON' as const,
    actorId: deviceHmac(config.secrets, body.deviceId),
    name: 'teacher.pin',
    argsHash: hashArgs({
      pinHmac: pinHmacValue,
      deviceId: body.deviceId,
      sessionTokenHash: body.sessionTokenHash,
    }),
  };
  const previous = repos.commands.replay<TeacherPinResult>(key);
  if (previous) return previous;
  let checkOptions = pinOptions;
  if (delayMs > 0) {
    await deps.sleep(delayMs);
    // 기다리는 사이 같은 기기·IP의 다른 요청들이 한도를 채웠을 수 있다. 조회 직전에 지금 시각으로 다시 본다.
    // 여기서부터 실패 기록까지는 await가 없어야 한다(그 틈에 병렬 요청이 검사를 같이 통과한다).
    checkOptions = { ...pinOptions, now: deps.now() };
    assertPinNotLocked(checkOptions);
  }
  const at = checkOptions.now;

  const room = repos.rooms.findActiveByPinHmac(pinHmacValue, at);
  if (!room || deps.gate.isClosing(room.id)) {
    const counted = recordPinFailure(checkOptions);
    if (counted.delayMs > 0) await deps.sleep(counted.delayMs);
    throw new AppError('E_PIN_INVALID');
  }
  return repos.commands.runOnce({ ...key, roomId: room.id }, at, () => {
    try {
      repos.teacherSessions.insert({
        id: randomUUID(),
        roomId: room.id,
        tokenHash: body.sessionTokenHash,
        kind: 'PIN',
        deviceId: body.deviceId,
        createdAt: at,
      });
    } catch (error) {
      if (isUniqueViolation(error, 'teacher_sessions.token_hash')) {
        throw new AppError('E_INPUT', 'session token reused', { sessionTokenHash: 'taken' });
      }
      throw error;
    }
    return { roomId: room.id };
  });
}
