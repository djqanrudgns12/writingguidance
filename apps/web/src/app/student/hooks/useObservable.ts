import { useCallback, useSyncExternalStore } from 'react';
import type { Observable } from '../../../ports/observable.ts';

/** 어댑터가 내보내는 값(`Observable`)을 화면 상태로 읽는다. 값이 없을 때(`null`)는 `fallback`. */
export function useObservable<T>(source: Observable<T> | null | undefined, fallback: T): T {
  const subscribe = useCallback(
    (onChange: () => void) => (source ? source.subscribe(() => onChange()) : () => {}),
    [source],
  );
  const read = () => (source ? source.get() : fallback);
  return useSyncExternalStore(subscribe, read, read);
}
