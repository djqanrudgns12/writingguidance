import { docDocumentName, roomDocumentName } from '@geulbang/core/protocol';
import type { Connection, Hocuspocus } from '@hocuspocus/server';
import type { TimerScheduler } from '../jobs/timers.ts';
import type { Logger } from '../log.ts';
import type { RealtimeContext } from '../realtime/context.ts';
import type { Persistence } from '../realtime/persistence.ts';
import type { RoomEvents } from '../realtime/roomEvents.ts';
import type { RoomGate } from '../realtime/roomGate.ts';
import type { RoomState } from '../realtime/roomState.ts';
import { checkpoint } from '../store/db.ts';
import type { Repos } from '../store/repos/index.ts';
import type { ResumeWaiters } from './resumeWaiters.ts';

/**
 * 수업방 지우기(PLAN §7.7, 만료·지금 삭제 공통, PRD F-22·F-24). 순서가 중요하다:
 * 1. 지우는 중 표시 → 그 방의 새 인증·명령·AI·이어 쓰기 요청을 `E_ROOM_EXPIRED`로 거부
 * 2. 진행 중 AI 호출 중단, 기다리던 이어 쓰기 조회를 깨움(행이 사라져 `E_ROOM_EXPIRED`로 답한다)
 * 3. `room.status {EXPIRED|DELETED}` 방송 → 그 방 문서 연결을 모두 닫음
 * 4. 그 방 글의 저장 예약은 저장하지 않고 버림(저장 실패 목록·내림 막기에서도 뺌) → 메모리에서 내림
 * 5. `DELETE FROM rooms`(외래키로 나머지 모두) → WAL 체크포인트
 * 6. 방 메모리 상태 제거, 타이머 예약 취소
 */
export type DeleteReason = 'EXPIRED' | 'DELETED';

export interface DeleteRoomDeps {
  readonly repos: Repos;
  readonly gate: RoomGate;
  readonly events: RoomEvents;
  readonly hocuspocus: () => Hocuspocus<RealtimeContext>;
  readonly persistence: Persistence;
  readonly roomState: RoomState;
  readonly timers: TimerScheduler;
  readonly resumeWaiters: ResumeWaiters;
  readonly log: Logger;
}

/** 방이 사라져 서버가 연결을 닫을 때의 닫기 코드(응용 정의 영역). 이유에는 오류 코드를 싣는다. */
const CLOSE_ROOM_GONE = 4410;

/**
 * 행을 지웠으면 true. 같은 방을 이미 지우는 중이면(정리 작업과 새 방 만들기·지금 삭제가 겹침) 새로 시작하지 않고
 * 그 지우기가 끝날 때까지 기다려 같은 결과를 돌려준다. 그래서 돌아온 뒤에는 행이 없다고 믿어도 된다.
 */
export type DeleteRoom = (roomId: string, reason: DeleteReason) => Promise<boolean>;

export function createDeleteRoom(deps: DeleteRoomDeps): DeleteRoom {
  const { repos, gate, log } = deps;
  const running = new Map<string, Promise<boolean>>();

  const run = async (roomId: string, reason: DeleteReason): Promise<boolean> => {
    gate.markClosing(roomId); // 1
    try {
      // 2
      gate.abortAi(roomId);
      const pending = repos.resumeRequests.listPendingIds(roomId);
      const docNames = repos.documents.listByRoom(roomId).map(d => docDocumentName(d.id));

      // 3 (4의 저장 버림을 먼저 걸어 둔다: 연결이 닫히는 순간 Hocuspocus가 저장을 바로 돌리기 때문)
      deps.events.toRoom(roomId, 'room.status', { status: reason });
      for (const name of docNames) deps.persistence.forget(name);
      const hp = deps.hocuspocus();
      const names = [roomDocumentName(roomId), ...docNames];
      for (const name of names) {
        const document = hp.documents.get(name);
        for (const c of (document?.getConnections() ?? []) as Array<Connection<RealtimeContext>>) {
          c.close({ code: CLOSE_ROOM_GONE, reason: 'E_ROOM_EXPIRED' });
        }
      }
      // 4: 연결이 없는 문서는 내린다(저장은 `forget` 때문에 건너뛴다).
      for (const name of names) {
        const document = hp.documents.get(name);
        if (document && document.getConnectionsCount() === 0) await hp.unloadDocument(document);
      }

      // 5
      const deleted = repos.rooms.delete(roomId);
      const cp = checkpoint(repos.db);
      if (cp.busy !== 0) log.warn('checkpoint_busy', { count: cp.busy });

      // 6
      deps.roomState.forgetRoom(roomId);
      deps.timers.cancel(roomId);
      for (const id of pending) deps.resumeWaiters.notify(id);
      log.info('room_deleted', { detail: reason, count: deleted });
      return deleted > 0;
    } finally {
      gate.release(roomId);
    }
  };

  return (roomId, reason) => {
    const current = running.get(roomId);
    if (current) return current;
    const started = run(roomId, reason).finally(() => running.delete(roomId));
    running.set(roomId, started);
    return started;
  };
}
