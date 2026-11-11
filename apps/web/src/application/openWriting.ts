import { errorCatalog } from '@geulbang/core/errors';
import type { Hello, MyDoc } from '@geulbang/core/protocol';
import type { StudentRoomMemory } from '../ports/deviceMemory.ts';
import type { RealtimeSession, RoomChannel, RoomChannelState, SyncedDoc } from '../ports/realtime.ts';
import type { AppDeps } from './deps.ts';
import { purgeWhenRoomGone } from './purgeLocal.ts';

/**
 * 학생: 실시간 연결 → hello → (글이 없으면 `doc.create`) → 글 열기(PLAN §2.3 ②-4·③, PRD F-05·F-06).
 * 연결이 없어도 기기 사본으로 바로 쓸 수 있게, 글 열기는 hello를 기다리지 않는다(이미 아는 글이면).
 */
export interface StudentSession {
  readonly session: RealtimeSession;
  readonly channel: RoomChannel;
  close(): void;
}

export function connectStudent(deps: AppDeps, entry: StudentRoomMemory, deviceId: string): StudentSession {
  const session = deps.realtime.connect(() => ({
    v: 1,
    kind: 'student',
    token: entry.deviceToken,
    deviceId,
  }));
  const channel = session.joinRoom(entry.roomId);
  const offGone = purgeWhenRoomGone(deps, channel);
  return {
    session,
    channel,
    close() {
      offGone();
      channel.close();
      session.close();
    },
  };
}

/** hello가 올 때까지 기다린다. 이미 받았으면 바로. 실패·삭제·닫힘이면(이미 그 상태여도) 바로 거부. */
export function waitHello(channel: RoomChannel): Promise<Hello> {
  const ended = (s: RoomChannelState) => s === 'failed' || s === 'gone' || s === 'closed';
  const endError = () => {
    const code = channel.failure.get() ?? 'E_ROOM_NOT_FOUND';
    // 서버 문제로 멈춘 채널(E_SERVER_DOWN)은 다시 해 볼 수 있다.
    return { code, retryable: errorCatalog[code].retryable };
  };
  // 구독은 바뀔 때만 알리므로 지금 상태를 먼저 본다(이미 끝난 채널을 영원히 기다리지 않게).
  if (ended(channel.state.get())) return Promise.reject(endError());
  const now = channel.hello.get();
  if (now) return Promise.resolve(now);
  return new Promise((resolve, reject) => {
    const offHello = channel.hello.subscribe(h => {
      if (!h) return;
      cleanup();
      resolve(h);
    });
    const offState = channel.state.subscribe(s => {
      if (!ended(s)) return;
      cleanup();
      reject(endError());
    });
    const cleanup = () => {
      offHello();
      offState();
    };
  });
}

export interface NewDocChoice {
  readonly genre: string;
  readonly subtype?: string;
  readonly purpose?: string;
  readonly purposeCustom?: string;
}

/** 글 종류를 고른 뒤 새 글을 만든다(PRD F-05). 명령은 같은 commandId로 다시 보낼 수 있다. */
export async function createDoc(
  deps: AppDeps,
  student: StudentSession,
  entry: StudentRoomMemory,
  choice: NewDocChoice,
  commandId: string,
): Promise<string> {
  const { docId } = await student.channel.send<{ docId: string }>('doc.create', choice, { commandId });
  await deps.memory.touchStudent(entry.roomId, { lastDocId: docId, lastUsedAt: deps.now() });
  await deps.localStore.setDocMeta(docId, { roomId: entry.roomId, expiresAt: entry.expiresAt });
  return docId;
}

/** 이어 쓸 글: 기억의 마지막 글이 hello 목록에 있으면 그것, 없으면 가장 최근 글. 하나도 없으면 null(S4로). */
export function pickResumeDoc(entry: StudentRoomMemory, docs: readonly MyDoc[]): MyDoc | null {
  const last = docs.find(d => d.docId === entry.lastDocId);
  if (last) return last;
  return [...docs].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

/**
 * 모든 글 열기 경로(학생 글·이어 쓰기·교사 서랍)가 지나는 곳. 기기 사본에 방·만료 시각을 먼저 적어 두고 연다
 * (그래야 만료 정리가 이 사본을 찾는다, PRD F-24). 적기가 실패해도 글은 연다(저장 실패는 `storageFailed`로 보인다).
 */
export async function openDocForRoom(
  deps: Pick<AppDeps, 'localStore'>,
  session: RealtimeSession,
  docId: string,
  roomId: string,
  expiresAt: number,
): Promise<SyncedDoc> {
  try {
    await deps.localStore.setDocMeta(docId, { roomId, expiresAt });
  } catch {
    // 기기 저장소가 막혀 있다: 글 사본도 쓰지 못하므로 지울 것도 남지 않는다.
  }
  return session.openDoc(docId);
}

/** 학생이 자기 글을 연다(새 글·이어 쓰기 모두). */
export function openDoc(
  deps: Pick<AppDeps, 'localStore'>,
  student: StudentSession,
  entry: Pick<StudentRoomMemory, 'roomId' | 'expiresAt'>,
  docId: string,
): Promise<SyncedDoc> {
  return openDocForRoom(deps, student.session, docId, entry.roomId, entry.expiresAt);
}
