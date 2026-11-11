import type { ErrorCode } from '@geulbang/core/errors';
import type { CommandName, Credential, Hello, RoomEventData, RoomEventName } from '@geulbang/core/protocol';
import type * as Y from 'yjs';
import type { Observable, Unsubscribe } from './observable.ts';

/**
 * 실시간 포트(PLAN §2.5). 화면·유스케이스는 이 타입만 알고, Hocuspocus는 `adapters/realtime`만 안다.
 * 연결 하나 위에 글 문서(P2)와 수업방 채널(P3-4).
 */

/** 연결 상태. `server-down`은 인터넷은 되는데 서버에 닿지 않을 때(PRD 9.5). */
export type ConnectionState = 'connecting' | 'online' | 'offline' | 'server-down' | 'closed';

/**
 * 저장 상태(PRD F-09, PLAN §6.5).
 * - `local`: 연결 안 됨, 이 기기에만 저장(`여기에만 저장`)
 * - `sending`: 보내는 중이거나, 서버가 받았지만 아직 DB에 쓰기 전, 또는 서버 저장 실패로 다시 시도 중
 * - `saved`: 서버 DB에 이 기기의 상태가 다 들어감(`저장됨`)
 * - `locked`: 제출·닫힘으로 잠김(화면은 `제출 완료` 등). 잠긴 동안 못 보낸 것은 `unsentWhileLocked`
 */
export type SaveState = 'local' | 'sending' | 'saved' | 'locked';

/** 커서 표시용 최소 모양(y-protocols Awareness 중 쓰는 것만). */
export interface AwarenessLike {
  readonly clientID: number;
  getLocalState(): Record<string, unknown> | null;
  setLocalStateField(field: string, value: unknown): void;
  getStates(): Map<number, Record<string, unknown>>;
  on(event: 'change', listener: (...args: unknown[]) => void): void;
  off(event: 'change', listener: (...args: unknown[]) => void): void;
}

export interface SyncedDoc {
  readonly docId: string;
  /** 통신용 문서. 편집기는 이것을 직접 쓰지 않고 자기 편집용 문서와 중계한다(PLAN §6.3). */
  readonly netDoc: Y.Doc;
  readonly awareness: AwarenessLike | null;
  readonly saveState: Observable<SaveState>;
  readonly locked: Observable<boolean>;
  /** 잠긴 동안 서버로 못 보낸 편집이 이 기기에 있다("선생님께 보내지 못한 글이 여기에 있어요"). */
  readonly unsentWhileLocked: Observable<boolean>;
  /** 이 글을 더 열 수 없는 이유(E_AUTH·E_FORBIDDEN 등). 열려 있으면 null. */
  readonly failure: Observable<ErrorCode | null>;
  /** 서버가 이 연결의 편집을 받지 않기 시작함(예: E_DOC_TOO_LARGE). */
  readonly rejected: Observable<ErrorCode | null>;
  /** 기기 저장소에 쓰지 못한 편집이 남아 있다(다음 쓰기 때 다시 쓴다). 화면은 E_STORAGE_BLOCKED 띠를 띄운다. */
  readonly storageFailed: Observable<boolean>;
  /**
   * 기기 저장소에 쓰는 중인 것이 다 끝날 때까지 기다린다(제출 전, PLAN §2.3 ⑥).
   * 못 쓴 편집이 남아 있으면 한 번 더 써 보고, 그래도 남으면 `CommandError`(`E_STORAGE_BLOCKED`)로 거부한다.
   */
  flushLocal(): Promise<void>;
  /**
   * 연결돼 있고 이 기기의 변경이 서버에 다 닿을 때까지(`unsyncedChanges === 0`, 잠겼으면 받을 것까지) 기다린다
   * (outbox가 제출 전에). 글을 닫으면 `E_OFFLINE`(다시 열면 됨), 영구 거절(`failure`·`rejected`)이면 그 코드로 거부한다.
   */
  waitSynced(): Promise<void>;
  close(): void;
}

/** 명령 실패: 서버 오류 코드 또는 기기에서 정한 `E_OFFLINE`(응답 없음·끊김). */
export interface CommandError {
  readonly code: ErrorCode;
  readonly retryable: boolean;
}

/** `ready` = hello를 받음. `gone` = 수업방이 지워지거나 만료됨. `failed` = 인증 실패(`failure`에 이유). */
export type RoomChannelState = 'connecting' | 'ready' | 'failed' | 'gone' | 'closed';

export interface RoomChannel {
  readonly roomId: string;
  readonly state: Observable<RoomChannelState>;
  /** 마지막으로 받은 hello(다시 연결할 때마다 새로 온다) */
  readonly hello: Observable<Hello | null>;
  readonly failure: Observable<ErrorCode | null>;
  on<N extends RoomEventName>(
    name: N,
    listener: (data: RoomEventData<N>, serverNow: number) => void,
  ): Unsubscribe;
  /** 명령을 보내고 `ack`를 기다린다. 실패는 `CommandError`로 거부된다. `commandId`를 주면 그대로 쓴다(멱등 재전송). */
  send<T = unknown>(name: CommandName, args: unknown, options?: { commandId?: string }): Promise<T>;
  readonly queue: CommandQueue;
  close(): void;
}

/** 오프라인에서도 의미가 있는 명령의 대기열(PLAN §6.5 outbox). 지금은 `doc.submit`만. */
export interface CommandQueue {
  /** 기기에 적고 보낼 수 있을 때 보낸다. 같은 `commandId`로 다시 보내므로 한 번만 실행된다. */
  enqueue(entry: {
    readonly docId: string;
    readonly name: 'doc.submit';
    readonly args: unknown;
  }): Promise<string>;
  pending(): Promise<readonly { readonly commandId: string; readonly docId: string | null }[]>;
  onResult(
    listener: (r: {
      readonly commandId: string;
      readonly ok: boolean;
      readonly data?: unknown;
      readonly error?: CommandError;
    }) => void,
  ): Unsubscribe;
}

export interface RealtimeSession {
  readonly state: Observable<ConnectionState>;
  /** 서버 기준 지금(ms). 이벤트·REST 응답의 서버 시각으로 맞춘다. */
  serverNow(): number;
  openDoc(docId: string): Promise<SyncedDoc>;
  joinRoom(roomId: string): RoomChannel;
  close(): void;
}

export interface RealtimePort {
  /** `credential`은 함수: 재연결 때마다 다시 읽는다. */
  connect(credential: () => Credential): RealtimeSession;
}
