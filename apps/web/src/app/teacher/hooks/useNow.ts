import { MS_PER_SECOND } from '@geulbang/core';
import { useEffect, useRef, useState } from 'react';

/**
 * 1초마다 다시 그리게 하는 지금 시각(PLAN §6.7 T3: 쓰는 중·멈춤·타이머를 기기에서 다시 계산).
 * 시각은 넘겨받은 함수(보통 서버 시각 `session.serverNow`)에서 읽는다.
 */
export function useNow(read: () => number, intervalMs: number = MS_PER_SECOND): number {
  const readRef = useRef(read);
  readRef.current = read;
  const [now, setNow] = useState(() => read());
  useEffect(() => {
    setNow(readRef.current());
    const timer = setInterval(() => setNow(readRef.current()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
