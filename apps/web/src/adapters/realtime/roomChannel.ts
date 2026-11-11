import { HocuspocusProvider, type HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import type { Config } from '@geulbang/core/config';
import { errorCatalog, isErrorCode, type ErrorCode } from '@geulbang/core/errors';
import {
  decodeRoomMessage,
  encodeCommand,
  encodeCredential,
  roomDocumentName,
  type CommandName,
  type Credential,
  type Hello,
  type RoomEvent,
  type RoomEventName,
} from '@geulbang/core/protocol';
import * as Y from 'yjs';
import { value } from '../../ports/observable.ts';
import type { CommandError, RoomChannel, RoomChannelState } from '../../ports/realtime.ts';
import type { ServerClock } from './serverClock.ts';

export interface RoomChannelDeps {
  readonly socket: HocuspocusProviderWebsocket;
  readonly config: Readonly<Config>;
  readonly credential: () => Credential;
  readonly clock: ServerClock;
  readonly newId?: () => string;
  /** 기기 쪽 끊김 감지: `tick`이 이만큼 없으면 소켓을 다시 연결한다(PRD F-17, `CLIENT_STALE_SEC`). */
  readonly reconnect?: () => void;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
}

interface Pending {
  readonly resolve: (data: unknown) => void;
  readonly reject: (error: CommandError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** 우리 오류 코드가 아닌 인증 실패(서버 훅의 일시 오류 등)·연결만 닫힘 뒤 다시 인증하기까지 기다리는 시간(docProvider와 같음) */
const REATTACH_DELAY_MS = 1000;
/** 그런 실패가 hello 없이 이만큼 이어지면 서버 문제로 보고 멈춘다(소켓이 다시 붙으면 다시 인증한다). 내부 값이다. */
const REATTACH_MAX_ATTEMPTS = 5;

const commandError = (code: ErrorCode, retryable?: boolean): CommandError => ({
  code,
  retryable: retryable ?? errorCatalog[code].retryable,
});

/**
 * 수업방 채널(PLAN §6.5). `room:{roomId}` 제공자 하나를 같은 소켓에 붙이고, 무상태 메시지로 명령을 보내
 * `ack`를 `COMMAND_ACK_TIMEOUT_MS` 기다린다. 이벤트는 이름별로 구독자에게 나눠 준다. `serverNow`로 시각을 맞춘다.
 * `room:*` 문서는 비어 있다(내용 없음, 서버도 저장하지 않음).
 */
export function openRoomChannel(roomId: string, deps: RoomChannelDeps): Omit<RoomChannel, 'queue'> {
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const state = value<RoomChannelState>('connecting');
  const hello = value<Hello | null>(null);
  const failure = value<ErrorCode | null>(null);
  const listeners = new Map<RoomEventName, Set<(data: never, serverNow: number) => void>>();
  const pending = new Map<string, Pending>();
  let closed = false;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;
  let reattachTimer: ReturnType<typeof setTimeout> | undefined;
  let reattachAttempts = 0;

  const provider = new HocuspocusProvider({
    websocketProvider: deps.socket,
    name: roomDocumentName(roomId),
    document: new Y.Doc(),
    token: () => encodeCredential(deps.credential()),
  });

  const armStale = () => {
    if (staleTimer) clearTimer(staleTimer);
    if (closed || !deps.reconnect) return;
    staleTimer = setTimer(() => {
      if (!closed && state.get() === 'ready') deps.reconnect?.();
    }, deps.config.CLIENT_STALE_SEC * 1000);
  };

  const emit = (event: RoomEvent) => {
    const set = listeners.get(event.name);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as (data: unknown, serverNow: number) => void)(event.data, event.serverNow);
      } catch {
        // 구독자 하나의 오류가 다른 구독자와 채널을 멈추지 않게 한다.
      }
    }
  };

  provider.on('stateless', ({ payload }: { payload: string }) => {
    const msg = decodeRoomMessage(payload);
    if (!msg) return;
    if (msg.kind === 'ack') {
      const p = pending.get(msg.ack.id);
      if (!p) return;
      pending.delete(msg.ack.id);
      clearTimer(p.timer);
      if (msg.ack.ok) p.resolve(msg.ack.data);
      else p.reject(commandError(msg.ack.error.code, msg.ack.error.retryable));
      return;
    }
    deps.clock.observe(msg.evt.serverNow);
    armStale();
    if (msg.evt.name === 'hello') {
      reattachAttempts = 0;
      if (state.get() === 'failed') failure.set(null); // 서버 문제로 멈췄다가 다시 붙음
      hello.set(msg.evt.data);
      state.set('ready');
    }
    if (
      msg.evt.name === 'room.status' &&
      (msg.evt.data.status === 'DELETED' || msg.evt.data.status === 'EXPIRED')
    ) {
      state.set('gone');
    }
    emit(msg.evt);
  });

  /**
   * 소켓은 살아 있는데 이 방 연결만 닫혔거나, 서버가 우리 코드 없이 거부했을 때(훅의 일시 오류는 Hocuspocus가
   * `permission-denied`로 보낸다) 잠시 뒤 다시 인증한다(PLAN §4.7 대응 4, 검토 8번). docProvider처럼 떼지 않고
   * 소켓에 다시 붙인다(떼면 닫기 메시지가 새 연결을 다시 닫는다). hello 없이 계속되면 서버 문제로 보고 멈춘다.
   */
  // 영구 실패·수업방이 사라진 뒤에는 다시 붙이지 않는다.
  const finished = () => closed || state.get() === 'failed' || state.get() === 'gone';
  const reattachSoon = () => {
    if (reattachTimer || finished()) return;
    if (reattachAttempts >= REATTACH_MAX_ATTEMPTS) {
      failure.set('E_SERVER_DOWN');
      state.set('failed');
      return;
    }
    reattachAttempts++;
    reattachTimer = setTimer(() => {
      reattachTimer = undefined;
      if (finished() || deps.socket.status !== 'connected') return;
      deps.socket.attach(provider);
    }, REATTACH_DELAY_MS);
  };

  provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
    rejectAll(isErrorCode(reason) ? reason : 'E_OFFLINE');
    if (!isErrorCode(reason)) {
      // 우리 서버가 정한 코드가 아니면 영구 거부가 아니다(DB 일시 오류 등).
      if (state.get() === 'ready') state.set('connecting');
      reattachSoon();
      return;
    }
    failure.set(reason);
    state.set('failed');
    provider.detach();
  });

  // 소켓이 끊겼다가 다시 붙으면 서버가 hello를 다시 보낸다. 그 사이 보낸 명령은 응답을 받지 못하므로 다시 보내게 알린다.
  // 소켓은 살아 있는데 이 방 연결만 닫혔으면 다시 붙인다. 소켓이 끊긴 것이면 소켓이 다시 연결하며 붙인다.
  provider.on('close', () => {
    if (closed) return;
    if (state.get() === 'ready') state.set('connecting');
    rejectAll('E_OFFLINE');
    if (deps.socket.status === 'connected') reattachSoon();
  });

  const rejectAll = (code: ErrorCode) => {
    for (const [id, p] of pending) {
      clearTimer(p.timer);
      p.reject(commandError(code));
      pending.delete(id);
    }
  };

  provider.attach();

  return {
    roomId,
    state,
    hello,
    failure,
    on(name, listener) {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(listener as (data: never, serverNow: number) => void);
      return () => set.delete(listener as (data: never, serverNow: number) => void);
    },
    send<T = unknown>(name: CommandName, args: unknown, options?: { commandId?: string }): Promise<T> {
      if (closed) return Promise.reject(commandError('E_OFFLINE'));
      if (state.get() !== 'ready') return Promise.reject(commandError('E_OFFLINE'));
      const id = options?.commandId ?? newId();
      return new Promise<T>((resolve, reject) => {
        const timer = setTimer(() => {
          pending.delete(id);
          reject(commandError('E_OFFLINE', true));
        }, deps.config.COMMAND_ACK_TIMEOUT_MS);
        pending.set(id, { resolve: resolve as (d: unknown) => void, reject, timer });
        provider.sendStateless(encodeCommand(id, name, args));
      });
    },
    close() {
      closed = true;
      if (staleTimer) clearTimer(staleTimer);
      if (reattachTimer) clearTimer(reattachTimer);
      rejectAll('E_OFFLINE');
      state.set('closed');
      provider.destroy();
    },
  };
}
