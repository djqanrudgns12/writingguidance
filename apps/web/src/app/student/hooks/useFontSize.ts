import { useCallback, useEffect, useState } from 'react';
import type { AppDeps } from '../../../application/deps.ts';

const KEY = 'student.fontSize';

/** 글자 크기(PRD F-13): `FONT_SIZES` 중 하나를 기기 `kv`에 기억한다. 기본은 두 번째(보통 18). */
export function useFontSize(deps: Pick<AppDeps, 'config' | 'localStore'>): [number, (size: number) => void] {
  const sizes = deps.config.FONT_SIZES;
  const fallback = sizes[1] ?? sizes[0] ?? 0;
  const [size, setSize] = useState(fallback);

  useEffect(() => {
    let alive = true;
    void deps.localStore.kv.get(KEY).then(
      v => {
        if (alive && typeof v === 'number' && sizes.includes(v)) setSize(v);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [deps, sizes]);

  const change = useCallback(
    (next: number) => {
      if (!sizes.includes(next)) return;
      setSize(next);
      void deps.localStore.kv.set(KEY, next).catch(() => {});
    },
    [deps, sizes],
  );
  return [size, change];
}
