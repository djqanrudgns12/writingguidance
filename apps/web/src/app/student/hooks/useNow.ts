import { MS_PER_SECOND } from '@geulbang/core';
import { useEffect, useState } from 'react';

/** 1초마다 다시 그리게 하는 지금 시각(쿨다운 남은 초·타이머·"3분 전"). 시계는 서버 시각 보정값을 준다. */
export function useNow(now: () => number, enabled = true): number {
  const [at, setAt] = useState(now);
  useEffect(() => {
    if (!enabled) return;
    setAt(now());
    const id = setInterval(() => setAt(now()), MS_PER_SECOND);
    return () => clearInterval(id);
  }, [now, enabled]);
  return at;
}
