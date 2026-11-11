import type { Config } from '@geulbang/core/config';
import { HocuspocusProviderWebsocket } from '@hocuspocus/provider';

/**
 * 기기마다 웹소켓 하나(PLAN §4.1·§6.5). 그 위에 글·수업방 제공자를 여러 개 붙인다.
 * - 재연결: `RECONNECT_BACKOFF_MS`(1·2·4·8·15초)를 첫 간격·배수·최대로 풀고 흔들기를 켠다(PRD 9.4).
 * - 끊김 감지: `CLIENT_STALE_SEC` 동안 아무 메시지가 없으면 다시 연결한다. 서버가 `HEARTBEAT_SEC`마다
 *   응용 Ping을 보내므로 조용한 연결은 끊기지 않는다(PLAN §4.7 대응 5).
 */
export function createSocket(url: string, config: Readonly<Config>): HocuspocusProviderWebsocket {
  const steps = config.RECONNECT_BACKOFF_MS;
  const first = steps[0] ?? 1000;
  const second = steps[1] ?? first * 2;
  return new HocuspocusProviderWebsocket({
    url,
    delay: first,
    minDelay: first,
    factor: second / first,
    maxDelay: steps.at(-1) ?? first,
    jitter: true,
    maxAttempts: 0,
    messageReconnectTimeout: config.CLIENT_STALE_SEC * 1000,
  });
}

/** 지금 페이지 주소에서 웹소켓 주소를 만든다(`https` → `wss`). 개발은 Vite가 `/ws`를 4461로 넘긴다. */
export function socketUrlFor(location: Pick<Location, 'protocol' | 'host'>): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
