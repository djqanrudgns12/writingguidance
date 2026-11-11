/** 어댑터가 화면·유스케이스에 내보내는 값. 바뀔 때마다 구독자에게 알린다(같은 값이면 알리지 않음). */
export type Unsubscribe = () => void;

export interface Observable<T> {
  get(): T;
  subscribe(listener: (value: T) => void): Unsubscribe;
}

export interface Value<T> extends Observable<T> {
  set(value: T): void;
}

export function value<T>(initial: T, equals: (a: T, b: T) => boolean = Object.is): Value<T> {
  let current = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => current,
    set(next) {
      if (equals(current, next)) return;
      current = next;
      for (const listener of [...listeners]) listener(next);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
