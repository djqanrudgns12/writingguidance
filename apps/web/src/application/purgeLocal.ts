import type { StudentRoomMemory } from '../ports/deviceMemory.ts';
import type { Unsubscribe } from '../ports/observable.ts';
import type { RoomChannel } from '../ports/realtime.ts';
import type { AppDeps } from './deps.ts';
import { lookupRoom } from './joinRoom.ts';
import { dropResumeFor, purgeExpiredResume } from './resumeOnDevice.ts';

/**
 * 기기 사본 정리(PRD F-24·§13.2, PLAN §3 `purgeLocal`). 학생 글·AI 결과·대기열은 수업방이 끝나면 기기에서도 지운다.
 * - 앱 시작·화면이 다시 보일 때: 만료된 기기 기억을 지우고 그 방들의 사본, 그리고 만료 시각이 지난 글 사본을 지운다.
 * - 수업방이 지워지거나 만료됐다는 알림(`room.status`)을 받으면 그 방 사본을 바로 지운다.
 * - 이어 쓰기 대기(`resume.pending`)도 만료 시각에 함께 지운다.
 * 수업방이 끝났다고 확인되면 학생·교사 모두 같은 `purgeRoomOnDevice`를 지난다(검토 B04).
 * 실패해도 앱은 계속 쓴다(다음 시작 때 다시 지운다).
 */
export type PurgeDeps = Pick<AppDeps, 'memory' | 'localStore'>;

export async function purgeLocal(deps: PurgeDeps, now: number): Promise<void> {
  // 기기 기억을 지우기 전에 만료된 방의 마지막 글을 알아 둔다(방 ID가 적히지 않은 옛 사본도 지우게).
  const lastDocs = new Map<string, string>();
  for (const e of await deps.memory.students(Number.NEGATIVE_INFINITY)) {
    if (e.expiresAt <= now && e.lastDocId) lastDocs.set(e.roomId, e.lastDocId);
  }
  const rooms = await deps.memory.purgeExpired(now);
  for (const roomId of rooms) {
    const lastDoc = lastDocs.get(roomId);
    await deps.localStore.purgeRoom(roomId, lastDoc ? [lastDoc] : []);
  }
  await deps.localStore.purgeExpired(now);
  await purgeExpiredResume(deps.localStore.kv, now);
}

/**
 * 수업방이 끝났다고 확인됐을 때(삭제·만료): 이 기기의 그 방 글 사본·AI 결과·대기열, 이어 쓰기 대기,
 * 학생·교사 기억을 지운다. 사본을 먼저 지운다: 중간에 실패하면 기억이 남아 다음 정리가 다시 찾는다.
 */
export async function purgeRoomOnDevice(deps: PurgeDeps, roomId: string): Promise<void> {
  const lastDocs = (await deps.memory.students(Number.NEGATIVE_INFINITY)).flatMap(e =>
    e.roomId === roomId && e.lastDocId ? [e.lastDocId] : [],
  );
  await deps.localStore.purgeRoom(roomId, lastDocs);
  await dropResumeFor(deps.localStore.kv, p => p.roomId === roomId);
  await deps.memory.forgetStudent(roomId);
  await deps.memory.forgetTeacher(roomId);
}

const ROOM_GONE_CODES: ReadonlySet<unknown> = new Set(['E_ROOM_NOT_FOUND', 'E_ROOM_EXPIRED']);

/**
 * 학생 토큰이 무효(`E_AUTH`)일 때. 서버는 지워진 방의 토큰도 같은 `E_AUTH`로 답하므로 곧바로 삭제로 보지 않고
 * 입장 코드로 방을 다시 조회해 확인한다(같은 코드가 다른 방에 다시 쓰였으면 옛 방은 없다).
 * - 방이 없거나 끝남 → 그 방 기기 사본까지 모두 지운다(`gone`).
 * - 방이 살아 있거나 확인하지 못함 → 이 기기 토큰만 무효: 기억만 지운다. 글 사본은 적힌 만료 시각에 지운다(`revoked`).
 */
export async function settleInvalidStudentToken(
  deps: Pick<AppDeps, 'api' | 'memory' | 'localStore'>,
  entry: Pick<StudentRoomMemory, 'roomId' | 'entryCode'>,
): Promise<'gone' | 'revoked'> {
  let gone = false;
  try {
    const room = await lookupRoom(deps, entry.entryCode);
    gone = room.roomId !== entry.roomId || room.status === 'EXPIRED' || room.status === 'DELETED';
  } catch (error) {
    gone = ROOM_GONE_CODES.has((error as { code?: unknown } | null)?.code);
  }
  if (gone) {
    await purgeRoomOnDevice(deps, entry.roomId);
    return 'gone';
  }
  await deps.memory.forgetStudent(entry.roomId);
  return 'revoked';
}

/** 화면이 다시 보였는지 알려 주는 것(브라우저는 `document`). */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** 앱 시작 때 한 번, 그리고 화면이 다시 보일 때마다 정리한다. 돌려준 함수로 멈춘다. */
export function startLocalPurge(
  deps: PurgeDeps,
  now: () => number,
  target: VisibilitySource | null = globalThis.document ?? null,
): Unsubscribe {
  let running: Promise<void> | null = null;
  const run = () => {
    if (running) return;
    running = purgeLocal(deps, now())
      .catch(() => {
        // 기기 저장소가 막혀 있으면 지울 것도 없다. 다음 기회에 다시 한다.
      })
      .finally(() => {
        running = null;
      });
  };
  const onVisible = () => {
    if (target?.visibilityState === 'visible') run();
  };
  run();
  target?.addEventListener('visibilitychange', onVisible);
  return () => target?.removeEventListener('visibilitychange', onVisible);
}

/** 수업방이 지워지거나 만료되면(`room.status`) 그 방의 기기 사본과 기억을 지운다(학생·교사 연결 모두). */
export function purgeWhenRoomGone(deps: PurgeDeps, channel: Pick<RoomChannel, 'roomId' | 'on'>): Unsubscribe {
  return channel.on('room.status', ({ status }) => {
    if (status !== 'DELETED' && status !== 'EXPIRED') return;
    void purgeRoomOnDevice(deps, channel.roomId).catch(() => {});
  });
}
