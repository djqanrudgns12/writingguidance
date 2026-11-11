import type { Config } from '@geulbang/core/config';
import { AppError } from '@geulbang/core/errors';
import type { Secrets } from '../config.ts';
import type { Db } from '../store/db.ts';
import { deviceHmac, globalPinHmac, ipHmac, teacherHmac } from './hmac.ts';

/**
 * `rate_buckets` 고정 창 카운터(PLAN §5.2·§7.4, PRD 12.3·F-20).
 * 칸 이름은 PLAN §5.2 주석 목록과 같고, 키는 모두 HMAC hex만 저장한다(원문 금지).
 */
export const RATE_BUCKETS = [
  'pin_device',
  'pin_ip',
  'pin_global',
  'room_create_device',
  'room_create_ip',
  'code_lookup_device',
  'code_lookup_ip',
  'personal_device',
  'personal_ip',
  'check_ai_teacher',
] as const;

export type RateBucketName = (typeof RATE_BUCKETS)[number];

export const WINDOW_ONE_MIN_MS = 60_000;
export const WINDOW_ONE_DAY_MS = 86_400_000;

const KEY_HMAC_PATTERN = /^[0-9a-f]{64}$/;

export interface BucketRule {
  readonly windowMs: number;
  readonly limit: number;
  /** 상한 초과 시 던질 오류 코드. `null`이면 오류를 던지지 않고 감속 지연 시간(`delayMs`)만 돌려준다. */
  readonly errorCode: 'E_RATE_LIMITED' | 'E_PIN_LOCKED' | null;
}

/** 모든 한도·창 크기를 `config.product`에서 읽어 칸별 규칙을 만든다(하드코딩 금지). */
export function getBucketRule(product: Readonly<Config>, bucket: RateBucketName): BucketRule {
  const pinWindowMs = product.PIN_LOCK_MIN * WINDOW_ONE_MIN_MS;
  switch (bucket) {
    case 'pin_device':
      return { windowMs: pinWindowMs, limit: product.PIN_MAX_FAILS, errorCode: 'E_PIN_LOCKED' };
    case 'pin_ip':
      return { windowMs: pinWindowMs, limit: product.PIN_IP_MAX_FAILS, errorCode: 'E_PIN_LOCKED' };
    case 'pin_global':
      return { windowMs: pinWindowMs, limit: product.PIN_GLOBAL_SLOW_FAILS, errorCode: null };
    case 'room_create_device':
      return {
        windowMs: WINDOW_ONE_DAY_MS,
        limit: product.ROOM_CREATE_PER_DEVICE_PER_DAY,
        errorCode: 'E_RATE_LIMITED',
      };
    case 'room_create_ip':
      return {
        windowMs: WINDOW_ONE_DAY_MS,
        limit: product.ROOM_CREATE_PER_IP_PER_DAY,
        errorCode: 'E_RATE_LIMITED',
      };
    case 'code_lookup_device':
      return {
        windowMs: WINDOW_ONE_MIN_MS,
        limit: product.CODE_LOOKUP_PER_DEVICE_PER_MIN,
        errorCode: 'E_RATE_LIMITED',
      };
    case 'code_lookup_ip':
      return {
        windowMs: WINDOW_ONE_MIN_MS,
        limit: product.CODE_LOOKUP_PER_IP_PER_MIN,
        errorCode: 'E_RATE_LIMITED',
      };
    case 'personal_device':
      return {
        windowMs: WINDOW_ONE_MIN_MS,
        limit: product.CODE_LOOKUP_PER_DEVICE_PER_MIN,
        errorCode: 'E_RATE_LIMITED',
      };
    case 'personal_ip':
      return {
        windowMs: WINDOW_ONE_MIN_MS,
        limit: product.CODE_LOOKUP_PER_IP_PER_MIN,
        errorCode: 'E_RATE_LIMITED',
      };
    case 'check_ai_teacher':
      return {
        windowMs: WINDOW_ONE_DAY_MS,
        limit: product.CHECK_AI_PER_DAY,
        errorCode: 'E_RATE_LIMITED',
      };
  }
}

/** 시각(`now`)이 속한 고정 창의 시작 시각(`window_start`). */
export function windowStartFor(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

function assertKeyHmac(keyHmac: string): void {
  if (!KEY_HMAC_PATTERN.test(keyHmac)) {
    throw new Error('rate_buckets.key_hmac에는 64자 소문자 hex HMAC만 넣을 수 있습니다(원문 금지)');
  }
}

export interface ConsumeBucketOptions {
  readonly db: Db;
  readonly product: Readonly<Config>;
  readonly bucket: RateBucketName;
  readonly keyHmac: string;
  readonly now: number;
}

export interface ConsumeBucketResult {
  readonly bucket: RateBucketName;
  readonly windowStart: number;
  readonly count: number;
  readonly limit: number;
  readonly delayMs: number;
}

const UPSERT_SQL = `
INSERT INTO rate_buckets (bucket, key_hmac, window_start, count)
VALUES (?, ?, ?, 1)
ON CONFLICT (bucket, key_hmac, window_start)
DO UPDATE SET count = rate_buckets.count + 1
RETURNING count
`;

const SELECT_COUNT_SQL = `
SELECT count FROM rate_buckets
WHERE bucket = ? AND key_hmac = ? AND window_start = ?
`;

/**
 * 한 문장 upsert로 고정 창 카운터를 1 올리고 상한을 검사한다.
 * - `pin_device` · `pin_ip`: 상한을 넘으면 `AppError('E_PIN_LOCKED')`
 * - `pin_global`: 상한(`PIN_GLOBAL_SLOW_FAILS`)을 넘으면 `delayMs = PIN_GLOBAL_DELAY_MS` 반환
 * - 그 밖의 칸: 상한을 넘으면 `AppError('E_RATE_LIMITED')`
 */
export function consumeRateBucket(options: ConsumeBucketOptions): ConsumeBucketResult {
  const { db, product, bucket, keyHmac, now } = options;
  assertKeyHmac(keyHmac);

  const rule = getBucketRule(product, bucket);
  const windowStart = windowStartFor(now, rule.windowMs);
  const row = db.prepare(UPSERT_SQL).get(bucket, keyHmac, windowStart) as { count: number };
  const count = row.count;
  const overLimit = count > rule.limit;

  if (overLimit && rule.errorCode !== null) {
    throw new AppError(rule.errorCode);
  }

  const delayMs = bucket === 'pin_global' && overLimit ? product.PIN_GLOBAL_DELAY_MS : 0;
  return { bucket, windowStart, count, limit: rule.limit, delayMs };
}

export const hitRateBucket = consumeRateBucket;

/** 카운터를 올리지 않고 현재 창의 카운트를 읽는다. */
export function getRateBucketCount(
  db: Db,
  product: Readonly<Config>,
  bucket: RateBucketName,
  keyHmac: string,
  now: number,
): number {
  assertKeyHmac(keyHmac);
  const rule = getBucketRule(product, bucket);
  const windowStart = windowStartFor(now, rule.windowMs);
  const row = db.prepare(SELECT_COUNT_SQL).get(bucket, keyHmac, windowStart) as { count: number } | undefined;
  return row?.count ?? 0;
}

export interface PinRateLimitOptions {
  readonly db: Db;
  readonly product: Readonly<Config>;
  readonly secrets: Pick<Secrets, 'idHmacKey'>;
  readonly deviceId: string;
  readonly ip: string;
  readonly now: number;
}

export interface PinRateLimitResult {
  readonly deviceCount: number;
  readonly ipCount: number;
  readonly globalCount: number;
  /** 전역 실패가 `PIN_GLOBAL_SLOW_FAILS`를 넘었을 때 호출자가 기다려야 할 밀리초(아니면 0). */
  readonly delayMs: number;
}

/**
 * PIN 확인 전에 기기 또는 IP가 이미 잠금 한도(`PIN_MAX_FAILS` / `PIN_IP_MAX_FAILS`)에 도달했는지 확인한다.
 * 잠겨 있으면 `AppError('E_PIN_LOCKED')`를 던지고, 아니면 현재 전역 감속 지연 시간을 돌려준다.
 */
export function assertPinNotLocked(options: PinRateLimitOptions): { readonly delayMs: number } {
  const { db, product, secrets, deviceId, ip, now } = options;
  const devCount = getRateBucketCount(db, product, 'pin_device', deviceHmac(secrets, deviceId), now);
  if (devCount >= product.PIN_MAX_FAILS) {
    throw new AppError('E_PIN_LOCKED');
  }
  const ipCount = getRateBucketCount(db, product, 'pin_ip', ipHmac(secrets, ip), now);
  if (ipCount >= product.PIN_IP_MAX_FAILS) {
    throw new AppError('E_PIN_LOCKED');
  }
  const globalCount = getRateBucketCount(db, product, 'pin_global', globalPinHmac(secrets), now);
  const delayMs = globalCount > product.PIN_GLOBAL_SLOW_FAILS ? product.PIN_GLOBAL_DELAY_MS : 0;
  return { delayMs };
}

/**
 * PIN(또는 선생님 시작 코드·중복 PIN) 실패를 기록하고 한도를 검사한다(PRD F-15·F-20·16.4).
 * 1) 기기 칸(`pin_device`)을 먼저 세어 `PIN_MAX_FAILS`를 넘으면 즉시 `E_PIN_LOCKED`를 던진다
 *    (잠긴 기기가 계속 눌러도 학교 공용 IP나 전역 칸을 더 올리지 않게 한다).
 * 2) IP 칸(`pin_ip`)을 세어 `PIN_IP_MAX_FAILS`를 넘으면 `E_PIN_LOCKED`를 던진다.
 * 3) 전역 칸(`pin_global`)을 세어 `PIN_GLOBAL_SLOW_FAILS`를 넘으면 `PIN_GLOBAL_DELAY_MS`를 돌려준다.
 */
export function recordPinFailure(options: PinRateLimitOptions): PinRateLimitResult {
  const { db, product, secrets, deviceId, ip, now } = options;
  const devRes = consumeRateBucket({
    db,
    product,
    bucket: 'pin_device',
    keyHmac: deviceHmac(secrets, deviceId),
    now,
  });
  const ipRes = consumeRateBucket({
    db,
    product,
    bucket: 'pin_ip',
    keyHmac: ipHmac(secrets, ip),
    now,
  });
  const globalRes = consumeRateBucket({
    db,
    product,
    bucket: 'pin_global',
    keyHmac: globalPinHmac(secrets),
    now,
  });
  return {
    deviceCount: devRes.count,
    ipCount: ipRes.count,
    globalCount: globalRes.count,
    delayMs: globalRes.delayMs,
  };
}

export const consumePinFailure = recordPinFailure;
export const checkPinRateLimit = recordPinFailure;

export interface DeviceIpRateLimitOptions {
  readonly db: Db;
  readonly product: Readonly<Config>;
  readonly secrets: Pick<Secrets, 'idHmacKey'>;
  readonly deviceId?: string | undefined;
  readonly ip: string;
  readonly now: number;
}

/** 수업방 만들기 속도 제한(`room_create_device` · `room_create_ip`). */
export function checkRoomCreateRateLimit(
  options: DeviceIpRateLimitOptions & { readonly deviceId: string },
): void {
  const { db, product, secrets, deviceId, ip, now } = options;
  consumeRateBucket({
    db,
    product,
    bucket: 'room_create_device',
    keyHmac: deviceHmac(secrets, deviceId),
    now,
  });
  consumeRateBucket({
    db,
    product,
    bucket: 'room_create_ip',
    keyHmac: ipHmac(secrets, ip),
    now,
  });
}

export const consumeRoomCreateRateLimit = checkRoomCreateRateLimit;

/** 입장 코드 조회·입장·이어 쓰기 요청 속도 제한(`code_lookup_device` · `code_lookup_ip`). */
export function checkCodeLookupRateLimit(options: DeviceIpRateLimitOptions): void {
  const { db, product, secrets, deviceId, ip, now } = options;
  if (deviceId) {
    consumeRateBucket({
      db,
      product,
      bucket: 'code_lookup_device',
      keyHmac: deviceHmac(secrets, deviceId),
      now,
    });
  }
  consumeRateBucket({
    db,
    product,
    bucket: 'code_lookup_ip',
    keyHmac: ipHmac(secrets, ip),
    now,
  });
}

export const consumeCodeLookupRateLimit = checkCodeLookupRateLimit;

/** 개인 모드 조회 속도 제한(`personal_device` · `personal_ip`). */
export function checkPersonalRateLimit(
  options: DeviceIpRateLimitOptions & { readonly deviceId: string },
): void {
  const { db, product, secrets, deviceId, ip, now } = options;
  consumeRateBucket({
    db,
    product,
    bucket: 'personal_device',
    keyHmac: deviceHmac(secrets, deviceId),
    now,
  });
  consumeRateBucket({
    db,
    product,
    bucket: 'personal_ip',
    keyHmac: ipHmac(secrets, ip),
    now,
  });
}

export const consumePersonalRateLimit = checkPersonalRateLimit;

export interface TeacherAiRateLimitOptions {
  readonly db: Db;
  readonly product: Readonly<Config>;
  readonly secrets: Pick<Secrets, 'idHmacKey'>;
  readonly teacherSessionKey: string;
  readonly now: number;
}

/** 교사 연결 점검 AI 시험 속도 제한(`check_ai_teacher`, 하루 `CHECK_AI_PER_DAY`). */
export function checkTeacherAiRateLimit(options: TeacherAiRateLimitOptions): void {
  const { db, product, secrets, teacherSessionKey, now } = options;
  consumeRateBucket({
    db,
    product,
    bucket: 'check_ai_teacher',
    keyHmac: teacherHmac(secrets, teacherSessionKey),
    now,
  });
}

export const consumeCheckAiRateLimit = checkTeacherAiRateLimit;
