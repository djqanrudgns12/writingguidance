import { defaultConfig } from '@geulbang/core/config';
import { describe, expect, it } from 'vitest';
import { createLiveConfig } from './liveConfig.ts';

describe('createLiveConfig (hello.config 덮기, PLAN §13.1)', () => {
  it('처음에는 빌드 기본값을 보인다', () => {
    const live = createLiveConfig(defaultConfig);
    expect(live.config.AI_COOLDOWN_SEC).toBe(defaultConfig.AI_COOLDOWN_SEC);
  });

  it('서버 값으로 덮어도 같은 객체가 새 값을 보인다', () => {
    const live = createLiveConfig(defaultConfig);
    const held = live.config;
    const next = defaultConfig.AI_COOLDOWN_SEC + 7;
    expect(live.apply({ AI_COOLDOWN_SEC: next })).toBe(true);
    expect(held.AI_COOLDOWN_SEC).toBe(next);
    expect(live.config).toBe(held);
  });

  it('같은 값이면 바뀐 것이 없다고 돌려준다', () => {
    const live = createLiveConfig(defaultConfig);
    expect(live.apply({ AI_COOLDOWN_SEC: defaultConfig.AI_COOLDOWN_SEC })).toBe(false);
  });

  it('모르는 키(IME_DIAGNOSTICS_ENABLED 등 운영 값)는 버린다', () => {
    const live = createLiveConfig(defaultConfig);
    expect(live.apply({ IME_DIAGNOSTICS_ENABLED: true })).toBe(false);
    expect(Object.keys(live.config)).not.toContain('IME_DIAGNOSTICS_ENABLED');
  });

  it('스키마를 통과하지 못하면 통째로 무시한다', () => {
    const live = createLiveConfig(defaultConfig);
    expect(live.apply({ AI_COOLDOWN_SEC: 'not-a-number', NOTICE_SHOW_SEC: 99 })).toBe(false);
    expect(live.config.AI_COOLDOWN_SEC).toBe(defaultConfig.AI_COOLDOWN_SEC);
    expect(live.config.NOTICE_SHOW_SEC).toBe(defaultConfig.NOTICE_SHOW_SEC);
  });

  it('바깥에서 고칠 수 없다', () => {
    const live = createLiveConfig(defaultConfig);
    expect(() => {
      (live.config as { AI_COOLDOWN_SEC: number }).AI_COOLDOWN_SEC = 1;
    }).toThrow();
  });
});
