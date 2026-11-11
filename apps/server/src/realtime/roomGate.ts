import { AppError } from '@geulbang/core/errors';

/**
 * 수업방 문(PLAN §7.7-1·2). 지우는 중인 방은 새 인증·명령·AI·이어 쓰기 요청을 `E_ROOM_EXPIRED`로 거부하고,
 * 진행 중인 AI 호출은 여기 모아 둔 `AbortController`로 한꺼번에 중단한다. 메모리에만 있다(다시 켜지면 비어 있음).
 */
export interface RoomGate {
  isClosing(roomId: string): boolean;
  markClosing(roomId: string): void;
  /** 지우기가 끝났거나 실패했을 때 */
  release(roomId: string): void;
  assertOpen(roomId: string): void;
  /** 진행 중인 AI 호출을 등록한다. 돌려준 함수로 뗀다. */
  trackAi(roomId: string, controller: AbortController): () => void;
  abortAi(roomId: string): number;
  /** 서버를 끝낼 때(PLAN §7.1-6 ③) */
  abortAllAi(): number;
}

export function createRoomGate(): RoomGate {
  const closing = new Set<string>();
  const inflight = new Map<string, Set<AbortController>>();

  return {
    isClosing: roomId => closing.has(roomId),
    markClosing(roomId) {
      closing.add(roomId);
    },
    release(roomId) {
      closing.delete(roomId);
    },
    assertOpen(roomId) {
      if (closing.has(roomId)) throw new AppError('E_ROOM_EXPIRED', 'room is being deleted');
    },
    trackAi(roomId, controller) {
      let set = inflight.get(roomId);
      if (!set) {
        set = new Set();
        inflight.set(roomId, set);
      }
      set.add(controller);
      return () => {
        const current = inflight.get(roomId);
        current?.delete(controller);
        if (current?.size === 0) inflight.delete(roomId);
      };
    },
    abortAi(roomId) {
      const set = inflight.get(roomId);
      if (!set) return 0;
      for (const c of set) c.abort();
      inflight.delete(roomId);
      return set.size;
    },
    abortAllAi() {
      let n = 0;
      for (const set of inflight.values()) {
        for (const c of set) c.abort();
        n += set.size;
      }
      inflight.clear();
      return n;
    },
  };
}
