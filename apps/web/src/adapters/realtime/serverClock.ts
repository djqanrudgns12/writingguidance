/**
 * 서버 시각 맞추기(PLAN §4.4 `serverNow`, §4.6 `tick`). 기기 시계가 틀려도 타이머·만료·멈춤 판정이 서버와 같게.
 * - 이벤트 `serverNow`와 REST `X-Server-Now`를 받을 때마다 차이를 갱신한다.
 * - 왕복 시간을 아는 경우(연결 점검 `ping`)는 절반을 더해 더 정확히 맞춘다.
 * - 값이 한두 번 튀어도 흔들리지 않게 최근 값들의 가운데 값을 쓴다.
 */
export interface ServerClock {
  /** 서버 기준 지금(ms) */
  now(): number;
  observe(serverNow: number, roundTripMs?: number): void;
  /** 서버 − 기기(ms). 받은 값이 없으면 0. */
  offset(): number;
}

const WINDOW = 7;

export function createServerClock(localNow: () => number = Date.now): ServerClock {
  const samples: number[] = [];
  let current = 0;
  return {
    now: () => localNow() + current,
    offset: () => current,
    observe(serverNow, roundTripMs) {
      if (!Number.isFinite(serverNow)) return;
      const half = roundTripMs !== undefined && roundTripMs >= 0 ? roundTripMs / 2 : 0;
      samples.push(serverNow + half - localNow());
      if (samples.length > WINDOW) samples.shift();
      const sorted = [...samples].sort((a, b) => a - b);
      current = sorted[Math.floor(sorted.length / 2)] ?? 0;
    },
  };
}
