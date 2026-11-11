import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { computeRoomExpiresAt, generateEntryCode, isGenreId } from '@geulbang/core';
import type { ApiOutput } from '@geulbang/core/api';
import { AppError } from '@geulbang/core/errors';
import type { ServerConfig } from '../config.ts';
import type { Logger } from '../log.ts';
import { deviceHmac, pinHmac } from '../security/hmac.ts';
import { encryptPin } from '../security/pinCrypto.ts';
import {
  assertPinNotLocked,
  checkRoomCreateRateLimit,
  recordPinFailure,
  type PinRateLimitOptions,
} from '../security/rateLimit.ts';
import { isUniqueViolation } from '../store/db.ts';
import { hashArgs } from '../store/repos/commands.ts';
import type { Repos } from '../store/repos/index.ts';
import type { DeleteRoom } from './deleteRoom.ts';

/**
 * 수업방 만들기(PLAN §2.3 ①, PRD F-15).
 * 순서: 시작 코드(틀리면 PIN 실패 칸으로 셈) → 다시 보낸 요청이면 저장한 결과 → 만들기 칸(기기·IP 하루)
 * → PIN 실패 칸(잠겼으면 거부) → `pin_hmac` → 같은 PIN·뽑은 입장 코드를 붙잡은 만료 방은 공통 삭제(`deleteRoom`, PLAN §7.7)
 * → 한 트랜잭션[`rooms`(유일 제약이 다시 확인) → LINK 세션 → 명령 기록]. 입장 코드가 겹치면 다시 뽑는다.
 * PIN이 이미 쓰이면 `E_PIN_TAKEN`이고 그것도 PIN 실패 칸으로 센다(PRD F-20).
 * 선생님 링크 토큰은 기기가 만들어 해시만 보낸다. 그래서 응답에 비밀이 없고 다시 보내도 같은 결과다.
 */

/** 입장 코드가 겹치면 새로 뽑는 횟수(PLAN §2.3 ①-3). 90만 칸에서 다섯 번 연속 겹칠 일은 없다. */
const ENTRY_CODE_ATTEMPTS = 5;

export type CreateRoomBody = ApiOutput<'createRoomBody'>;
export type CreateRoomResult = ApiOutput<'createRoomResult'>;

export interface CreateRoomDeps {
  readonly config: ServerConfig;
  readonly repos: Repos;
  readonly log: Logger;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** 만료 방이 PIN·입장 코드를 붙잡고 있을 때 비우는 공통 삭제(정리 작업·지금 삭제와 같은 절차) */
  readonly deleteRoom: DeleteRoom;
}

export interface CreateRoomInput {
  readonly body: CreateRoomBody;
  /** 머리 `X-Start-Code`. 모양이 틀렸으면 부르는 쪽이 이미 undefined로 넘긴다. */
  readonly startCode: string | undefined;
  readonly ip: string;
}

export async function createRoom(
  deps: CreateRoomDeps,
  input: CreateRoomInput,
): Promise<{ readonly result: CreateRoomResult; readonly replayed: boolean }> {
  const { config, repos, log, sleep } = deps;
  const p = config.product;
  const { body, ip } = input;
  const now = deps.now();
  const pinOptions: PinRateLimitOptions = {
    db: repos.db,
    product: p,
    secrets: config.secrets,
    deviceId: body.deviceId,
    ip,
    now,
  };

  await checkStartCode(deps, input, pinOptions);

  // PIN 원문을 해시에 넣지 않는다(6~8자리 SHA-256은 쉽게 되돌려진다). `pin_hmac`은 어차피 rooms에 있다.
  const pinHmacValue = pinHmac(config.secrets, body.pin);
  const { commandId, pin: _pin, ...rest } = body;
  const key = {
    id: commandId,
    actorKind: 'ANON' as const,
    actorId: deviceHmac(config.secrets, body.deviceId),
    name: 'room.create',
    argsHash: hashArgs({ ...rest, pinHmac: pinHmacValue }),
  };
  const previous = repos.commands.replay<CreateRoomResult>(key);
  if (previous) return previous;

  checkRoomCreateRateLimit({ ...pinOptions, deviceId: body.deviceId });
  const { delayMs } = assertPinNotLocked(pinOptions);
  if (delayMs > 0) {
    await sleep(delayMs);
    // "이미 쓰이는 PIN"도 PIN을 알려 주는 답이다. 기다리는 사이 병렬 요청이 한도를 채웠으면 여기서 막는다(enterWithPin과 같음).
    assertPinNotLocked({ ...pinOptions, now: deps.now() });
  }

  if (!body.genres.every(isGenreId)) {
    throw new AppError('E_INPUT', 'genre is not in the catalog', { genres: 'invalid' });
  }
  const expiresAt = computeRoomExpiresAt(now, p, config.ops.ROOM_TTL_MINUTES_OVERRIDE);

  // 만료 행이 같은 PIN을 붙잡고 있으면 공통 삭제(PLAN §7.7: 방송·연결 닫기·AI 중단·메모리 정리)로 먼저 비운다.
  // 저장소에서 바로 지우면 열린 연결·메모리 문서가 남는다(P5-5b 검토 B01). 유일성은 아래 트랜잭션의 제약이 다시 본다.
  const pinHolder = repos.rooms.findByPinHmac(pinHmacValue);
  if (pinHolder && pinHolder.expiresAt <= now) await deps.deleteRoom(pinHolder.id, 'EXPIRED');

  try {
    for (let attempt = 0; attempt < ENTRY_CODE_ATTEMPTS; attempt++) {
      const entryCode = newEntryCode(p);
      const codeHolder = repos.rooms.findByEntryCode(entryCode);
      if (codeHolder) {
        // 살아 있는 방의 코드면 다시 뽑는다. 만료 방이면 공통 삭제로 비운 뒤 쓴다(PIN과 같은 이유).
        if (codeHolder.expiresAt > now) continue;
        await deps.deleteRoom(codeHolder.id, 'EXPIRED');
      }
      try {
        return repos.commands.runOnce(
          { ...key, roomId: null },
          now,
          () => insertRoom(deps, { pinHmacValue, entryCode, body, now, expiresAt }),
          result => result.roomId,
        );
      } catch (error) {
        // 그사이 다른 요청이 같은 코드를 가져갔다(트랜잭션은 되돌려졌다). 다시 뽑는다.
        if (isUniqueViolation(error, 'rooms.entry_code')) continue;
        throw error;
      }
    }
    throw new AppError('E_INTERNAL', 'could not find a free entry code');
  } catch (error) {
    if (error instanceof AppError && error.code === 'E_PIN_TAKEN') {
      // "이미 쓰이는 PIN" 확인도 같은 제한을 받는다(PRD F-20). 잠금 한도를 넘으면 여기서 E_PIN_LOCKED가 된다.
      const counted = recordPinFailure(pinOptions);
      if (counted.delayMs > 0) await sleep(counted.delayMs);
    }
    throw error;
  }
}

/**
 * 선생님 시작 코드(PRD F-15). 틀린 시도는 PIN과 같은 칸(기기 5번 → 10분 잠금)으로 세고, 잠긴 동안은 맞는 코드도 막는다
 * (안 그러면 잠금이 맞히기 시도를 늦추지 못한다). 머리가 아예 없으면 추측이 아니므로 세지 않는다.
 */
async function checkStartCode(
  deps: CreateRoomDeps,
  input: CreateRoomInput,
  pinOptions: PinRateLimitOptions,
): Promise<void> {
  const { config, log, sleep } = deps;
  if (!config.product.TEACHER_START_CODE_REQUIRED) return;
  const expected = config.secrets.teacherStartCode;
  if (expected === undefined) {
    // 운영은 값이 없으면 시작을 거부한다(config.ts). 개발에서 비워 두었을 때만 여기로 온다.
    log.warn('start_code_unset', { detail: '개발: TEACHER_START_CODE가 없어 시작 코드 확인을 건너뜀' });
    return;
  }
  const { delayMs } = assertPinNotLocked(pinOptions);
  if (input.startCode !== undefined && sameDigits(input.startCode, expected)) return;
  if (input.startCode !== undefined) {
    const counted = recordPinFailure(pinOptions);
    const wait = Math.max(delayMs, counted.delayMs);
    if (wait > 0) await sleep(wait);
  }
  throw new AppError('E_START_CODE_INVALID');
}

function sameDigits(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 숫자 `ENTRY_CODE_LENGTH`자리, 첫 자리는 1~9(ADR-016, `domain/entryCode.ts`). */
function newEntryCode(config: Readonly<{ ENTRY_CODE_LENGTH: number }>): string {
  return generateEntryCode(max => randomInt(0, max), config);
}

/**
 * 한 트랜잭션 안(명령 기록과 함께): `rooms` → LINK 세션. 유일 제약이 PIN·입장 코드를 마지막으로 확인한다.
 * PIN이 겹치면(살아 있는 방, 또는 다른 삭제가 아직 끝나지 않은 만료 방) `E_PIN_TAKEN`으로 답하지 않고 갈라 낸다.
 */
function insertRoom(
  deps: CreateRoomDeps,
  args: {
    readonly pinHmacValue: string;
    readonly entryCode: string;
    readonly body: CreateRoomBody;
    readonly now: number;
    readonly expiresAt: number;
  },
): CreateRoomResult {
  const { config, repos, log } = deps;
  const p = config.product;
  const { body, now, entryCode, expiresAt } = args;
  const schoolName = body.schoolName ?? null;
  const roomId = randomUUID();
  try {
    repos.rooms.insert({
      id: roomId,
      entryCode,
      pinHmac: args.pinHmacValue,
      pinEnc: encryptPin(config.secrets.pinEncKey, body.pin),
      className: body.className,
      title: body.title,
      schoolName,
      showSchool: body.showSchool && schoolName !== null,
      settings: {
        // 카탈로그 확인은 위에서 끝냈다(genres.ts).
        genres: [...new Set(body.genres)],
        aiButtons: [...new Set(body.aiButtons)],
        sound: false,
        undoLevel: 'normal',
        diagnostics: false,
      },
      retentionDays: p.ROOM_TTL_DAYS,
      createdAt: now,
      expiresAt,
    });
  } catch (error) {
    if (isUniqueViolation(error, 'rooms.pin_hmac')) {
      const holder = repos.rooms.findByPinHmac(args.pinHmacValue);
      // 만료 방이 아직 지워지는 중(정리 작업과 겹침)이면 PIN 실패로 세지 않고 잠시 뒤 다시 보내게 한다.
      if (holder && holder.expiresAt <= now)
        throw new AppError('E_INTERNAL', 'expired room is being deleted');
      throw new AppError('E_PIN_TAKEN');
    }
    throw error;
  }
  try {
    repos.teacherSessions.insert({
      id: randomUUID(),
      roomId,
      tokenHash: body.linkTokenHash,
      kind: 'LINK',
      deviceId: null,
      createdAt: now,
    });
  } catch (error) {
    if (isUniqueViolation(error, 'teacher_sessions.token_hash')) {
      throw new AppError('E_INPUT', 'link token reused', { linkTokenHash: 'taken' });
    }
    throw error;
  }
  log.info('room_created', { detail: `ttl_days=${p.ROOM_TTL_DAYS}` });
  return { roomId, entryCode, expiresAt };
}
