import { defaultConfig, type Config } from '@geulbang/core/config';
import { randomTokenBase64Url, sha256Hex } from '@geulbang/core/text';
import { createContext, useContext, type ReactNode } from 'react';
import { createHttpApi } from '../adapters/api/http.ts';
import { createLiveConfig } from '../adapters/config/liveConfig.ts';
import { createDeviceMemory } from '../adapters/local/deviceMemory.ts';
import { openLocalStore } from '../adapters/local/localDocStore.ts';
import { createLazyRealtime } from '../adapters/realtime/lazy.ts';
import { createServerClock } from '../adapters/realtime/serverClock.ts';
import { registerPwa } from '../adapters/pwa/register.ts';
import { createDownloadPort } from '../adapters/download/saveFile.ts';
import type { AppDeps } from '../application/deps.ts';
import { startLocalPurge } from '../application/purgeLocal.ts';

/**
 * 앱 전체가 쓰는 어댑터 묶음을 한 번 만든다(PLAN §2.5: 화면은 adapters를 모르고 이 묶음만 훅으로 받는다).
 * 기기 저장소는 열기에 시간이 걸려 앱 시작 때 먼저 연다(`createAppDeps`는 비동기).
 */
export async function createAppDeps(
  baseConfig: Readonly<Config> = defaultConfig,
  options: { readonly serviceWorker: boolean } = { serviceWorker: false },
): Promise<AppDeps> {
  // 서버 hello.config가 오면 덮이는 설정(PLAN §13.1). 모든 어댑터·화면이 이 객체 하나를 함께 본다.
  const live = createLiveConfig(baseConfig);
  const config = live.config;
  const localStore = await openLocalStore();
  const clock = createServerClock();
  const memory = createDeviceMemory({ kv: localStore.kv });
  // 만료된 수업방의 기기 사본을 시작 때와 화면이 다시 보일 때 지운다(PRD F-24). 앱이 살아 있는 동안 계속 돈다.
  // 서버 시각으로 본다(맞추기 전 첫 정리는 기기 시계와 같다. 만료 근처의 차이는 다음 정리에서 잡힌다).
  startLocalPurge({ memory, localStore }, () => clock.now());
  return {
    config,
    api: createHttpApi({ config, clock }),
    // 실시간 어댑터(Hocuspocus 제공자)는 처음 연결할 때 불러온다(첫 화면 묶음을 가볍게).
    realtime: createLazyRealtime({
      serverNow: () => clock.now(),
      onHello: hello => live.apply(hello.config),
      load: async () => {
        const [{ createRealtimeAdapter }, { socketUrlFor }] = await Promise.all([
          import('../adapters/realtime/session.ts'),
          import('../adapters/realtime/socket.ts'),
        ]);
        return createRealtimeAdapter({ url: socketUrlFor(globalThis.location), config, localStore, clock });
      },
    }),
    localStore,
    memory,
    now: () => clock.now(),
    newId: () => crypto.randomUUID(),
    newToken: () => randomTokenBase64Url(32),
    sha256Hex: input => sha256Hex(input),
    pwa: registerPwa(options.serviceWorker),
    download: createDownloadPort(),
  };
}

const DepsContext = createContext<AppDeps | null>(null);

export function AppDepsProvider({ deps, children }: { deps: AppDeps; children: ReactNode }) {
  return <DepsContext.Provider value={deps}>{children}</DepsContext.Provider>;
}

/** 화면에서 유스케이스에 넘길 묶음 */
export function useAppDeps(): AppDeps {
  const deps = useContext(DepsContext);
  if (!deps) throw new Error('AppDepsProvider 밖');
  return deps;
}
