import { value } from '../../ports/observable.ts';
import type { PwaPort } from '../../ports/pwa.ts';

/**
 * 서비스 워커 등록(PLAN §6.6). 운영 빌드에서만 `/sw.js`를 등록한다(개발 서버에는 없음).
 * - 새 판이 기다리는 중이면 `updateReady`를 켠다. 앱을 새로 열 때(다음 실행) 기다리는 판이 있으면 바로 적용한다.
 * - 적용: 기다리는 워커에 `SKIP_WAITING` → 워커가 바뀌면(`controllerchange`) 한 번만 다시 불러온다.
 */
export function registerPwa(enabled: boolean): PwaPort {
  const updateReady = value(false);
  let waiting: ServiceWorker | null = null;
  let reloading = false;
  // 우리가 새 판 적용(SKIP_WAITING)을 부탁했을 때만 다시 불러온다. 처음 설치 때의 `clients.claim()`도
  // `controllerchange`를 일으키는데, 그때 다시 불러오면 선생님 링크처럼 주소를 바꾼 화면이 홈으로 돌아간다(e2e 결함 1).
  let requested = false;
  const sw = globalThis.navigator?.serviceWorker;

  const port: PwaPort = {
    updateReady,
    applyIfReady() {
      if (!waiting || reloading) return;
      requested = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
    },
  };
  if (!enabled || !sw) return port;

  sw.addEventListener('controllerchange', () => {
    if (reloading || !requested) return;
    reloading = true;
    globalThis.location.reload();
  });

  const track = (reg: ServiceWorkerRegistration) => {
    const markWaiting = () => {
      if (reg.waiting && sw.controller) {
        waiting = reg.waiting;
        updateReady.set(true);
      }
    };
    markWaiting();
    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      incoming?.addEventListener('statechange', () => {
        if (incoming.state === 'installed') markWaiting();
      });
    });
  };

  void sw
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then(reg => {
      track(reg);
      // 다음 실행: 열자마자 기다리는 판이 있으면 적용(아직 화면에서 아무것도 하지 않은 때)
      if (reg.waiting && sw.controller) port.applyIfReady();
    })
    .catch(() => {
      // 등록 실패(사생활 보호 모드 등)는 앱 동작에 영향이 없다. 오프라인 새로고침만 안 된다.
    });
  return port;
}
