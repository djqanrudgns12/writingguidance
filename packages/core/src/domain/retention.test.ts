import { describe, expect, it } from 'vitest';
import { MS_PER_DAY, MS_PER_MINUTE } from './clock.ts';
import {
  computeCommandCutoffMs,
  computeExpiresAtFromDays,
  computeExpiryWarningAt,
  computePersonalExpiresAt,
  computeRoomExpiresAt,
  expiryDateKey,
  expiryDateParts,
  isExpired,
  isInExpiryWarningWindow,
  RetentionPolicy,
} from './retention.ts';

describe('RetentionPolicy 만료·경고 시각 계산', () => {
  const baseMs = Date.UTC(2026, 10, 1, 0, 0, 0, 0);

  it('수업방 만료 시각은 ROOM_TTL_DAYS를 따르고 분 단위 덮어쓰기가 있으면 우선한다', () => {
    expect(computeRoomExpiresAt(baseMs, { ROOM_TTL_DAYS: 30 })).toBe(baseMs + 30 * MS_PER_DAY);
    expect(computeRoomExpiresAt(baseMs, { ROOM_TTL_DAYS: 14 })).toBe(baseMs + 14 * MS_PER_DAY);
    expect(computeRoomExpiresAt(baseMs, { ROOM_TTL_DAYS: 30 }, 5)).toBe(baseMs + 5 * MS_PER_MINUTE);
    expect(RetentionPolicy.computeExpiresAtFromDays(baseMs, 7)).toBe(computeExpiresAtFromDays(baseMs, 7));
  });

  it('개인 모드 보관 기간과 멱등 명령 정리 기준 시각을 설정값으로 계산한다', () => {
    expect(computePersonalExpiresAt(baseMs, { PERSONAL_TTL_DAYS: 90 })).toBe(baseMs + 90 * MS_PER_DAY);
    expect(computeCommandCutoffMs(baseMs, { COMMAND_RETENTION_DAYS: 7 })).toBe(baseMs - 7 * MS_PER_DAY);
  });

  it('만료 경계값(expiresAt - 1ms vs expiresAt)을 정확히 구분한다', () => {
    const expiresAt = baseMs + 30 * MS_PER_DAY;
    expect(isExpired(expiresAt, expiresAt - 1)).toBe(false);
    expect(isExpired(expiresAt, expiresAt)).toBe(true);
    expect(isExpired(expiresAt, expiresAt + 1)).toBe(true);
  });

  it('삭제 예정 경고 창은 만료 3일 전 정각부터 만료 1ms 전까지만 켜진다', () => {
    const expiresAt = baseMs + 30 * MS_PER_DAY;
    const warningAt = computeExpiryWarningAt(expiresAt, { EXPIRY_WARNING_DAYS: 3 });

    expect(warningAt).toBe(expiresAt - 3 * MS_PER_DAY);
    expect(isInExpiryWarningWindow(expiresAt, warningAt - 1, { EXPIRY_WARNING_DAYS: 3 })).toBe(false);
    expect(isInExpiryWarningWindow(expiresAt, warningAt, { EXPIRY_WARNING_DAYS: 3 })).toBe(true);
    expect(isInExpiryWarningWindow(expiresAt, expiresAt - 1, { EXPIRY_WARNING_DAYS: 3 })).toBe(true);
    expect(isInExpiryWarningWindow(expiresAt, expiresAt, { EXPIRY_WARNING_DAYS: 3 })).toBe(false);
    expect(isInExpiryWarningWindow(expiresAt, warningAt, { EXPIRY_WARNING_DAYS: 0 })).toBe(false);
  });

  it('삭제 예정일 문자열과 연·월·일은 한국 시간대(Asia/Seoul) 자정을 따른다', () => {
    // 2026-12-01 14:59:59.999Z = KST 2026-12-01 23:59:59.999
    const kstDec1End = Date.UTC(2026, 11, 1, 14, 59, 59, 999);
    // 2026-12-01 15:00:00.000Z = KST 2026-12-02 00:00:00.000
    const kstDec2Start = Date.UTC(2026, 11, 1, 15, 0, 0, 0);

    expect(expiryDateKey(kstDec1End, { TIMEZONE: 'Asia/Seoul' })).toBe('2026-12-01');
    expect(expiryDateParts(kstDec1End, { TIMEZONE: 'Asia/Seoul' })).toEqual({
      year: 2026,
      month: 12,
      day: 1,
    });

    expect(expiryDateKey(kstDec2Start, { TIMEZONE: 'Asia/Seoul' })).toBe('2026-12-02');
    expect(expiryDateParts(kstDec2Start, { TIMEZONE: 'Asia/Seoul' })).toEqual({
      year: 2026,
      month: 12,
      day: 2,
    });
  });
});
