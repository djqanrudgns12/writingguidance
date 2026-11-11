import { configKeys, configSchema, type Config } from '@geulbang/core/config';

/**
 * 서버가 `hello.config`로 내려 주는 설정을 기기 설정에 덮는다(PLAN §13.1: 서버 설정을 바꾸면 앱을 다시 빌드하지
 * 않아도 기기 동작이 바뀐다). 앱 전체가 같은 설정 객체 하나를 계속 들고 있게, 값은 읽을 때마다 지금 값을 돌려주는
 * 읽기 전용 속성으로 만든다(객체 참조가 바뀌지 않아 화면 효과가 다시 돌지 않는다).
 * 모르는 키는 버리고, 합친 결과가 설정 스키마를 통과하지 못하면 통째로 무시한다(빌드 기본값을 지킨다).
 */
export interface LiveConfig {
  readonly config: Readonly<Config>;
  /** 바뀐 값이 있어 덮었으면 `true` */
  apply(values: Readonly<Record<string, unknown>>): boolean;
}

const knownKeys: ReadonlySet<string> = new Set(configKeys);

export function createLiveConfig(base: Readonly<Config>): LiveConfig {
  let current: Readonly<Config> = base;
  const view = {} as Config;
  for (const key of configKeys) {
    Object.defineProperty(view, key, { enumerable: true, get: () => current[key] });
  }
  Object.freeze(view);

  return {
    config: view,
    apply(values) {
      const picked: Record<string, unknown> = {};
      let changed = false;
      for (const [key, v] of Object.entries(values)) {
        if (!knownKeys.has(key)) continue;
        picked[key] = v;
        if (JSON.stringify(v) !== JSON.stringify(current[key as keyof Config])) changed = true;
      }
      if (!changed) return false;
      const result = configSchema.safeParse({ ...current, ...picked });
      if (!result.success) return false;
      current = Object.freeze(result.data);
      return true;
    },
  };
}
