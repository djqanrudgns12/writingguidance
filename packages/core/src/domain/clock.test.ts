import { describe, expect, it } from 'vitest';
import { compactDateKey, dateParts, dayKey } from './clock.ts';

describe('dayKey', () => {
  it('한국 시각 자정에서 날이 바뀐다', () => {
    // 2026-11-10 14:59:59.999Z = 한국 23:59:59.999, 15:00Z = 한국 11일 00:00
    expect(dayKey(Date.UTC(2026, 10, 10, 14, 59, 59, 999), 'Asia/Seoul')).toBe('2026-11-10');
    expect(dayKey(Date.UTC(2026, 10, 10, 15, 0, 0, 0), 'Asia/Seoul')).toBe('2026-11-11');
  });

  it('시간대마다 다른 날을 준다', () => {
    const t = Date.UTC(2026, 0, 1, 3, 0, 0);
    expect(dayKey(t, 'UTC')).toBe('2026-01-01');
    expect(dayKey(t, 'America/Los_Angeles')).toBe('2025-12-31');
  });
});

describe('dateParts / compactDateKey', () => {
  it('한국 시각 자정 경계에서 연·월·일 숫자와 파일용 8자리 날짜를 맞춘다', () => {
    const beforeMidnight = Date.UTC(2026, 11, 31, 14, 59, 59, 999);
    const atMidnight = Date.UTC(2026, 11, 31, 15, 0, 0, 0);

    expect(dateParts(beforeMidnight, 'Asia/Seoul')).toEqual({ year: 2026, month: 12, day: 31 });
    expect(compactDateKey(beforeMidnight, 'Asia/Seoul')).toBe('20261231');

    expect(dateParts(atMidnight, 'Asia/Seoul')).toEqual({ year: 2027, month: 1, day: 1 });
    expect(compactDateKey(atMidnight, 'Asia/Seoul')).toBe('20270101');
  });
});
