import { useCallback, useSyncExternalStore } from 'react';

/**
 * PRD 7.3 기준 폭 900px. `Sheet.module.css`·`Dashboard.module.css`의 `@media (min-width: 900px)`와 같은 값이어야 한다
 * (CSS 미디어 쿼리는 변수를 못 써서 여러 곳에 있다. 설정값이 아니라 디자인 기준 폭이다).
 */
export const WIDE_LAYOUT_QUERY = '(min-width: 900px)';

/**
 * `WIDE_LAYOUT_QUERY`의 정확한 반대(900px 미만). 좁은 화면에서만 줄이는 배치에 쓴다: 미디어 쿼리를 모르는 곳
 * (시험 jsdom 등)은 `false`라 줄이지 않은 원래 배치(정보를 모두 보이는 쪽)가 된다.
 */
export const NARROW_LAYOUT_QUERY = 'not all and (min-width: 900px)';

function mediaQuery(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(query);
}

/**
 * 미디어 쿼리가 맞는지(창 폭이 바뀌면 다시 그린다). `matchMedia`가 없는 곳(시험 jsdom 등)은 `false`.
 * 화면 배치가 CSS로 바뀌는 곳에서 그 배치에 맞는 의미(모달 여부·초점 가두기)를 함께 바꿀 때 쓴다.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = mediaQuery(query);
      if (!mql) return () => {};
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = () => mediaQuery(query)?.matches === true;
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
