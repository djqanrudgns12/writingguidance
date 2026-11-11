import { defaultConfig, type Config } from '../config.ts';
import type { ErrorCode } from '../errors.ts';
import { dateParts, dayKey, MS_PER_DAY, MS_PER_HOUR, MS_PER_SECOND } from './clock.ts';

/**
 * AI 사용 한도·쿨다운·한국 시각(KST) 하루 경계 계산(PRD F-26, PRD 6.5, PLAN §5.2·§8.2).
 *
 * 한도 판단 순서(PLAN §8.2):
 * 1. 같은 `commandId` 중복 요청 → 앞 결과 재사용(한도 차감·거절 없음)
 * 2. 버튼별 쿨다운(`AI_COOLDOWN_SEC`) → `E_AI_COOLDOWN` + 남은 초
 * 3. 참가자 하루(`AI_DAILY_PER_PARTICIPANT`) → `E_AI_LIMIT`
 * 4. 수업방 하루(`AI_DAILY_PER_ROOM`, 개인 모드는 건너뜀) → `E_AI_LIMIT`
 * 5. 전체 하루(`AI_DAILY_GLOBAL`, 개인 모드는 `AI_DAILY_PERSONAL_GLOBAL`) → `E_AI_LIMIT`
 */

export type AiDayConfig = Pick<Config, 'TIMEZONE'>;
export type AiCooldownConfig = Pick<Config, 'AI_COOLDOWN_SEC'>;
export type AiQuotaConfig = Pick<
  Config,
  | 'TIMEZONE'
  | 'AI_COOLDOWN_SEC'
  | 'AI_DAILY_PER_PARTICIPANT'
  | 'AI_DAILY_PER_ROOM'
  | 'AI_DAILY_GLOBAL'
  | 'AI_DAILY_PERSONAL_GLOBAL'
>;

export const AI_USAGE_STATUSES = ['RESERVED', 'OK', 'FAILED', 'REFUNDED'] as const;
export type AiUsageStatus = (typeof AI_USAGE_STATUSES)[number];

export const AI_DAILY_SCOPES = ['GLOBAL', 'PERSONAL'] as const;
export type AiDailyScope = (typeof AI_DAILY_SCOPES)[number];

export type AiQuotaErrorCode = Extract<ErrorCode, 'E_AI_COOLDOWN' | 'E_AI_LIMIT'>;

export type AiQuotaRejectReason =
  'COOLDOWN' | 'PARTICIPANT_LIMIT' | 'ROOM_LIMIT' | 'GLOBAL_LIMIT' | 'PERSONAL_GLOBAL_LIMIT';

export interface AiDayBounds {
  readonly day: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface AiQuotaInput {
  /** 같은 `commandId`로 이미 예약·처리된 멱등 재시도인지 여부(PLAN §8.2 1순위). */
  readonly sameCommandId?: boolean | undefined;
  /** 같은 버튼의 직전 요청 시각(UTC ms). 없으면 `null` 또는 생략. */
  readonly lastButtonAt?: number | null | undefined;
  /** 참가자가 오늘(KST) 이미 쓴 횟수(`RESERVED`·`OK`·`FAILED` 합계). */
  readonly participantUsed: number;
  /** 수업방이 오늘(KST) 이미 쓴 횟수. 개인 모드(`isPersonal: true` 또는 `roomUsed: null`)에서는 검사하지 않는다. */
  readonly roomUsed?: number | null | undefined;
  /** 전체(또는 개인 모드 전체)가 오늘(KST) 이미 쓴 횟수. */
  readonly globalUsed: number;
  /** 개인 모드 여부(참이면 수업방 한도를 건너뛰고 `AI_DAILY_PERSONAL_GLOBAL`을 적용). */
  readonly isPersonal?: boolean | undefined;
  /** 명시적 하루 범위(`GLOBAL` | `PERSONAL`). 지정하면 `isPersonal`보다 우선한다. */
  readonly scope?: AiDailyScope | undefined;
}

export type AiQuotaDecision =
  | {
      readonly ok: true;
      readonly allowed: true;
      readonly duplicate: boolean;
      readonly code: null;
      readonly reason: null;
      readonly cooldownLeftSec: 0;
      readonly cooldownLeftMs: 0;
      readonly day: string;
      readonly scope: AiDailyScope;
    }
  | {
      readonly ok: false;
      readonly allowed: false;
      readonly duplicate: false;
      readonly code: AiQuotaErrorCode;
      readonly reason: AiQuotaRejectReason;
      readonly cooldownLeftSec: number;
      readonly cooldownLeftMs: number;
      readonly day: string;
      readonly scope: AiDailyScope;
    };

const KST_OFFSET_MS = 9 * MS_PER_HOUR;

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = wallFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    wallFormatters.set(timeZone, f);
  }
  return f;
}

function timeZoneOffsetMsAt(utcMs: number, timeZone: string): number {
  if (timeZone === 'Asia/Seoul') return KST_OFFSET_MS;
  const parts = wallFormatter(timeZone).formatToParts(utcMs);
  let year = 0;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
    else if (part.type === 'hour') hour = Number(part.value);
    else if (part.type === 'minute') minute = Number(part.value);
    else if (part.type === 'second') second = Number(part.value);
  }
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const roundedUtc = Math.floor(utcMs / MS_PER_SECOND) * MS_PER_SECOND;
  return wallAsUtc - roundedUtc;
}

function startOfLocalDateMs(year: number, month: number, day: number, timeZone: string): number {
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  if (timeZone === 'Asia/Seoul') return utcMidnight - KST_OFFSET_MS;
  const firstGuess = utcMidnight - timeZoneOffsetMsAt(utcMidnight, timeZone);
  return utcMidnight - timeZoneOffsetMsAt(firstGuess, timeZone);
}

/** 주어진 시각이 속한 AI 하루 키(`YYYY-MM-DD`, 기본 `Asia/Seoul`). */
export function aiDayKey(nowMs: number, config: AiDayConfig = defaultConfig): string {
  return dayKey(nowMs, config.TIMEZONE);
}

/** 두 시각이 같은 AI 하루(기본 `Asia/Seoul` 자정 기준)에 속하는지 확인한다. */
export function isSameAiDay(aMs: number, bMs: number, config: AiDayConfig = defaultConfig): boolean {
  return aiDayKey(aMs, config) === aiDayKey(bMs, config);
}

/**
 * 주어진 시각이 속한 날의 시작 시각(00:00:00.000, 포함)과 다음 날 시작 시각(미포함)을 돌려준다.
 * SQLite `ai_usage` 인덱스(`created_at >= startMs AND created_at < endMs`) 조회에 쓴다.
 */
export function aiDayBoundsMs(nowMs: number, config: AiDayConfig = defaultConfig): AiDayBounds {
  const day = aiDayKey(nowMs, config);
  const { year, month, day: dayOfMonth } = dateParts(nowMs, config.TIMEZONE);
  const startMs = startOfLocalDateMs(year, month, dayOfMonth, config.TIMEZONE);
  const endMs =
    config.TIMEZONE === 'Asia/Seoul'
      ? startMs + MS_PER_DAY
      : startOfLocalDateMs(year, month, dayOfMonth + 1, config.TIMEZONE);
  return { day, startMs, endMs };
}

/** `ai_usage.status`가 하루 한도에 포함되는 상태인지 확인한다(`REFUNDED`만 제외, PLAN §5.2). */
export function countsTowardAiQuota(status: AiUsageStatus): boolean {
  return status === 'RESERVED' || status === 'OK' || status === 'FAILED';
}

/**
 * 버튼별 쿨다운 남은 시간(밀리초)을 계산한다.
 * 직전 사용이 없거나 이미 `AI_COOLDOWN_SEC` 이상 지났으면 `0`을 돌려준다.
 */
export function cooldownLeftMs(
  lastAt: number | null | undefined,
  now: number,
  config: AiCooldownConfig = defaultConfig,
): number {
  if (lastAt === null || lastAt === undefined) return 0;
  const totalMs = config.AI_COOLDOWN_SEC * MS_PER_SECOND;
  if (totalMs <= 0) return 0;
  const elapsedMs = Math.max(0, now - lastAt);
  if (elapsedMs >= totalMs) return 0;
  return totalMs - elapsedMs;
}

/**
 * 버튼별 쿨다운 남은 시간(초, 올림 정수)을 계산한다(PRD F-08·F-26).
 * 서버 쿨다운 판정과 기기 쪽 AI 칩 상태 표시("N초 뒤")가 함께 쓴다.
 */
export function cooldownLeftSec(
  lastAt: number | null | undefined,
  now: number,
  config: AiCooldownConfig = defaultConfig,
): number {
  const leftMs = cooldownLeftMs(lastAt, now, config);
  if (leftMs <= 0) return 0;
  return Math.ceil(leftMs / MS_PER_SECOND);
}

/**
 * PLAN §8.2 순서로 AI 요청 허용 여부·오류 코드(`E_AI_COOLDOWN`·`E_AI_LIMIT`)·남은 쿨다운 초를 판단한다.
 * 순서: 같은 `commandId` → 버튼별 쿨다운 → 참가자 하루 → 수업방 하루 → 전체 하루(개인 모드는 개인 전체).
 */
export function checkAiQuota(
  input: AiQuotaInput,
  now: number,
  config: AiQuotaConfig = defaultConfig,
): AiQuotaDecision {
  const scope: AiDailyScope = input.scope ?? (input.isPersonal ? 'PERSONAL' : 'GLOBAL');
  const day = aiDayKey(now, config);

  // 1. 같은 commandId 중복 요청은 쿨다운·한도를 다시 차감하지 않고 앞 결과를 돌려준다.
  if (input.sameCommandId) {
    return {
      ok: true,
      allowed: true,
      duplicate: true,
      code: null,
      reason: null,
      cooldownLeftSec: 0,
      cooldownLeftMs: 0,
      day,
      scope,
    };
  }

  // 2. 버튼별 쿨다운(AI_COOLDOWN_SEC)
  const leftMs = cooldownLeftMs(input.lastButtonAt, now, config);
  const leftSec = cooldownLeftSec(input.lastButtonAt, now, config);
  if (leftSec > 0) {
    return {
      ok: false,
      allowed: false,
      duplicate: false,
      code: 'E_AI_COOLDOWN',
      reason: 'COOLDOWN',
      cooldownLeftSec: leftSec,
      cooldownLeftMs: leftMs,
      day,
      scope,
    };
  }

  // 3. 참가자 하루 한도(AI_DAILY_PER_PARTICIPANT)
  if (input.participantUsed >= config.AI_DAILY_PER_PARTICIPANT) {
    return {
      ok: false,
      allowed: false,
      duplicate: false,
      code: 'E_AI_LIMIT',
      reason: 'PARTICIPANT_LIMIT',
      cooldownLeftSec: 0,
      cooldownLeftMs: 0,
      day,
      scope,
    };
  }

  // 4. 수업방 하루 한도(AI_DAILY_PER_ROOM, 수업방 모드일 때만)
  if (scope === 'GLOBAL') {
    const roomUsed = input.roomUsed ?? 0;
    if (roomUsed >= config.AI_DAILY_PER_ROOM) {
      return {
        ok: false,
        allowed: false,
        duplicate: false,
        code: 'E_AI_LIMIT',
        reason: 'ROOM_LIMIT',
        cooldownLeftSec: 0,
        cooldownLeftMs: 0,
        day,
        scope,
      };
    }
  }

  // 5. 전체 하루 한도(수업방: AI_DAILY_GLOBAL, 개인 모드: AI_DAILY_PERSONAL_GLOBAL)
  const globalLimit = scope === 'PERSONAL' ? config.AI_DAILY_PERSONAL_GLOBAL : config.AI_DAILY_GLOBAL;
  if (input.globalUsed >= globalLimit) {
    return {
      ok: false,
      allowed: false,
      duplicate: false,
      code: 'E_AI_LIMIT',
      reason: scope === 'PERSONAL' ? 'PERSONAL_GLOBAL_LIMIT' : 'GLOBAL_LIMIT',
      cooldownLeftSec: 0,
      cooldownLeftMs: 0,
      day,
      scope,
    };
  }

  return {
    ok: true,
    allowed: true,
    duplicate: false,
    code: null,
    reason: null,
    cooldownLeftSec: 0,
    cooldownLeftMs: 0,
    day,
    scope,
  };
}
