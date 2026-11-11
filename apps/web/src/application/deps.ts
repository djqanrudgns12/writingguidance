import type { Config } from '@geulbang/core/config';
import type { ApiPort } from '../ports/api.ts';
import type { DeviceMemory } from '../ports/deviceMemory.ts';
import type { DownloadPort } from '../ports/download.ts';
import type { LocalStorePort } from '../ports/localStore.ts';
import type { PwaPort } from '../ports/pwa.ts';
import type { RealtimePort } from '../ports/realtime.ts';

/**
 * 기기 유스케이스가 받는 것(PLAN §2.5: application은 domain과 port만 안다).
 * 화면은 `app/providers.tsx`가 만든 이 묶음을 훅으로 받아 유스케이스에 넘긴다.
 */
export interface AppDeps {
  readonly config: Readonly<Config>;
  readonly api: ApiPort;
  readonly realtime: RealtimePort;
  readonly localStore: LocalStorePort;
  readonly memory: DeviceMemory;
  readonly now: () => number;
  readonly newId: () => string;
  /** 32바이트 무작위 base64url(기기가 토큰을 만든다, PLAN §7.4) */
  readonly newToken: () => string;
  readonly sha256Hex: (input: string) => Promise<string>;
  /** 앱 업데이트(홈·선생님 홈에서만 적용) */
  readonly pwa: PwaPort;
  /** 파일 내려받기(학생 txt, 교사 zip) */
  readonly download: DownloadPort;
}
