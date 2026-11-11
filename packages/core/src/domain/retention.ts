import { defaultConfig, type Config } from '../config.ts';
import { dateParts, dayKey, MS_PER_DAY, MS_PER_MINUTE, type DateParts } from './clock.ts';

/**
 * 보관 정책 한 곳(PRD F-24 `RetentionPolicy`, PRD F-17, PLAN §5.3).
 * 보관 일수나 경고 기준이 바뀔 때 `config` 수치만 따라가도록 순수 계산을 여기에 모은다.
 */

export type RoomRetentionConfig = Pick<Config, 'ROOM_TTL_DAYS'>;
export type PersonalRetentionConfig = Pick<Config, 'PERSONAL_TTL_DAYS'>;
export type ExpiryWarningConfig = Pick<Config, 'EXPIRY_WARNING_DAYS'>;
export type CommandRetentionConfig = Pick<Config, 'COMMAND_RETENTION_DAYS'>;
export type TimeZoneConfig = Pick<Config, 'TIMEZONE'>;

/** 만든 시각과 보관 일수로 만료 시각(UTC ms)을 계산한다. */
export function computeExpiresAtFromDays(createdAtMs: number, ttlDays: number): number {
  return createdAtMs + ttlDays * MS_PER_DAY;
}

/**
 * 수업방 만료 시각 계산(PRD F-24).
 * 시험 환경에서 분 단위 덮어쓰기(`ttlMinutesOverride`, PLAN §10.5)가 주어지면 그것을 우선한다.
 */
export function computeRoomExpiresAt(
  createdAtMs: number,
  config: RoomRetentionConfig = defaultConfig,
  ttlMinutesOverride?: number | undefined,
): number {
  if (ttlMinutesOverride !== undefined) {
    return createdAtMs + ttlMinutesOverride * MS_PER_MINUTE;
  }
  return computeExpiresAtFromDays(createdAtMs, config.ROOM_TTL_DAYS);
}

/** 개인 모드 보관 만료 시각 계산(PRD F-24·F-25). */
export function computePersonalExpiresAt(
  createdAtMs: number,
  config: PersonalRetentionConfig = defaultConfig,
): number {
  return computeExpiresAtFromDays(createdAtMs, config.PERSONAL_TTL_DAYS);
}

/** 멱등 명령 기록 정리 기준 시각(이 시각보다 이전 기록은 지움, PLAN §5.3). */
export function computeCommandCutoffMs(
  nowMs: number,
  config: CommandRetentionConfig = defaultConfig,
): number {
  return nowMs - config.COMMAND_RETENTION_DAYS * MS_PER_DAY;
}

/** 삭제 예정 경고 띠가 켜지는 시각(만료 `EXPIRY_WARNING_DAYS`일 전, PRD F-17). */
export function computeExpiryWarningAt(
  expiresAtMs: number,
  config: ExpiryWarningConfig = defaultConfig,
): number {
  return expiresAtMs - config.EXPIRY_WARNING_DAYS * MS_PER_DAY;
}

/** 만료 시각에 도달했거나 지났는지 판단한다(PLAN §5.3 `expires_at <= :now`). */
export function isExpired(expiresAtMs: number, nowMs: number): boolean {
  return nowMs >= expiresAtMs;
}

/**
 * 삭제 예정 경고 기간 안인지 판단한다(PRD F-17: 삭제 3일 전부터 만료 직전까지).
 * `EXPIRY_WARNING_DAYS`가 0이거나 이미 만료된 뒤에는 경고 띠를 띄우지 않는다.
 */
export function isInExpiryWarningWindow(
  expiresAtMs: number,
  nowMs: number,
  config: ExpiryWarningConfig = defaultConfig,
): boolean {
  if (config.EXPIRY_WARNING_DAYS <= 0) return false;
  if (isExpired(expiresAtMs, nowMs)) return false;
  return nowMs >= computeExpiryWarningAt(expiresAtMs, config);
}

/** 만료 시각이 속한 삭제 예정일(`YYYY-MM-DD`, 설정 시간대 기준, PRD F-16·F-17·13.1). */
export function expiryDateKey(expiresAtMs: number, config: TimeZoneConfig = defaultConfig): string {
  return dayKey(expiresAtMs, config.TIMEZONE);
}

/** 만료 시각의 삭제 예정일 연·월·일(설정 시간대 기준). */
export function expiryDateParts(expiresAtMs: number, config: TimeZoneConfig = defaultConfig): DateParts {
  return dateParts(expiresAtMs, config.TIMEZONE);
}

export const RetentionPolicy = {
  computeExpiresAtFromDays,
  computeRoomExpiresAt,
  computePersonalExpiresAt,
  computeCommandCutoffMs,
  computeExpiryWarningAt,
  isExpired,
  isInExpiryWarningWindow,
  expiryDateKey,
  expiryDateParts,
} as const;
