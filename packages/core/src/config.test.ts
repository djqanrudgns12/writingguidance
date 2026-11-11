import { describe, expect, it } from 'vitest';
import { ConfigError, configDefaults, configKeys, defaultConfig, parseConfig } from './config.ts';
import { AppError, errorCatalog, errorCodes, isErrorCode } from './errors.ts';

describe('config', () => {
  it('기본값이 스키마를 지킨다', () => {
    expect(defaultConfig.ROOM_TTL_DAYS).toBe(30);
    expect(Object.keys(defaultConfig).sort()).toEqual([...configKeys].sort());
  });

  it('환경 변수 문자열로 덮는다: 숫자·불리언·목록·묶음', () => {
    const c = parseConfig({
      ROOM_TTL_DAYS: '7',
      PERSONAL_MODE_ENABLED: 'true',
      TIMER_PRESETS_MIN: '3, 6',
      UNDO_GROUP_MS: '{"fine":300,"normal":600,"coarse":1200}',
      MODEL_POLISH: 'claude-sonnet-5-5',
      UNRELATED_ENV: 'ignored',
    });
    expect(c.ROOM_TTL_DAYS).toBe(7);
    expect(c.PERSONAL_MODE_ENABLED).toBe(true);
    expect(c.TIMER_PRESETS_MIN).toEqual([3, 6]);
    expect(c.UNDO_GROUP_MS.coarse).toBe(1200);
    expect(c.MODEL_POLISH).toBe('claude-sonnet-5-5');
    expect(configDefaults.ROOM_TTL_DAYS).toBe(30);
  });

  it('빈 값은 기본값을 쓴다', () => {
    expect(parseConfig({ ROOM_TTL_DAYS: '  ' }).ROOM_TTL_DAYS).toBe(30);
  });

  it('잘못된 값은 모아서 한 번에 알린다', () => {
    let caught: unknown;
    try {
      parseConfig({ ROOM_TTL_DAYS: 'abc', PERSONAL_MODE_ENABLED: 'yes', AI_EFFORT_SPELL: 'max' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const issues = (caught as ConfigError).issues.join('\n');
    expect(issues).toContain('ROOM_TTL_DAYS');
    expect(issues).toContain('PERSONAL_MODE_ENABLED');
    expect(issues).toContain('AI_EFFORT_SPELL');
  });

  it('값 사이의 순서를 지킨다', () => {
    expect(() => parseConfig({ PIN_MIN_LENGTH: '9' })).toThrow(ConfigError);
    expect(() => parseConfig({ HEARTBEAT_SEC: '20' })).toThrow(ConfigError);
    expect(() => parseConfig({ IME_RELAXED_IDLE_MS: '600' })).toThrow(ConfigError);
  });

  it('반환한 설정은 바꿀 수 없다', () => {
    const c = parseConfig({});
    expect(Object.isFrozen(c)).toBe(true);
  });
});

describe('errors', () => {
  it('코드 목록과 성질', () => {
    expect(errorCodes).toContain('E_INTERNAL');
    expect(isErrorCode('E_AUTH')).toBe(true);
    expect(isErrorCode('toString')).toBe(false);
    expect(errorCatalog.E_SYNC_PENDING.silent).toBe(true);
  });

  it('AppError는 코드의 재시도 여부를 따른다', () => {
    expect(new AppError('E_RATE_LIMITED').retryable).toBe(true);
    expect(new AppError('E_INPUT', 'bad', { nickname: 'too_long' }).fields).toEqual({ nickname: 'too_long' });
  });
});
