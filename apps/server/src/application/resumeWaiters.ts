/**
 * 이어 쓰기 긴 조회의 대기자 목록(PLAN §2.3 ④-2, PRD F-14). 메모리에만 있다.
 * - 결정·취소가 나면(`notify`) 그 요청을 기다리던 조회가 바로 깨어나 DB의 상태를 다시 읽고 답한다.
 * - 한 요청에 조회가 겹치면 앞의 것을 바로 끝낸다(앞 조회는 그때 상태 `PENDING`으로 답한다).
 * - 기기가 끊으면(신호) 기다림을 거둔다. 서버를 끝낼 때(`close`) 모두 깨운다.
 */
export interface ResumeWaiters {
  wait(requestId: string, ms: number, signal?: AbortSignal): Promise<void>;
  notify(requestId: string): void;
  close(): void;
}

export function createResumeWaiters(): ResumeWaiters {
  const waiting = new Map<string, () => void>();

  return {
    wait(requestId, ms, signal) {
      waiting.get(requestId)?.();
      return new Promise<void>(resolve => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', finish);
          if (waiting.get(requestId) === finish) waiting.delete(requestId);
          resolve();
        };
        const timer = setTimeout(finish, Math.max(0, ms));
        timer.unref();
        signal?.addEventListener('abort', finish, { once: true });
        if (signal?.aborted) finish();
        else waiting.set(requestId, finish);
      });
    },
    notify(requestId) {
      waiting.get(requestId)?.();
    },
    close() {
      for (const finish of [...waiting.values()]) finish();
    },
  };
}
