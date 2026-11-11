import type { Config } from '@geulbang/core/config';
import type { Credential } from '@geulbang/core/protocol';
import type { LocalStorePort } from '../../ports/localStore.ts';
import { value } from '../../ports/observable.ts';
import type {
  ConnectionState,
  RealtimePort,
  RealtimeSession,
  RoomChannel,
  SyncedDoc,
} from '../../ports/realtime.ts';
import { createOutbox, type OutboxResult } from './outbox.ts';
import { openDocProvider } from './docProvider.ts';
import { openRoomChannel } from './roomChannel.ts';
import { createServerClock, type ServerClock } from './serverClock.ts';
import { createSocket } from './socket.ts';

export interface RealtimeAdapterDeps {
  readonly url: string;
  readonly config: Readonly<Config>;
  readonly localStore: LocalStorePort;
  /** 인터넷 자체가 끊겼는가. 브라우저는 `navigator.onLine`. */
  readonly isOnline?: () => boolean;
  readonly onError?: (error: unknown) => void;
  /** 여러 세션이 같은 시계를 쓰게 할 때(REST 응답 `X-Server-Now`도 같은 시계에 넣는다) */
  readonly clock?: ServerClock;
}

/** 실시간 포트 구현(PLAN §6.5). 연결 하나에 글 제공자 여러 개. */
export function createRealtimeAdapter(deps: RealtimeAdapterDeps): RealtimePort {
  return {
    connect(credential: () => Credential): RealtimeSession {
      const socket = createSocket(deps.url, deps.config);
      const clock = deps.clock ?? createServerClock();
      const state = value<ConnectionState>('connecting');
      const isOnline = deps.isOnline ?? (() => globalThis.navigator?.onLine ?? true);
      let closed = false;
      const openDocs = new Map<string, SyncedDoc>();
      /** 대기열이 제출하려고 연 글(화면이 열지 않은 글). 세션을 닫을 때 같이 닫는다(검토 5번). */
      const queueDocs = new Map<string, Promise<SyncedDoc>>();

      const openProvider = (docId: string) =>
        openDocProvider(docId, {
          socket,
          localStore: deps.localStore,
          credential,
          ...(deps.onError ? { onError: deps.onError } : {}),
        });

      /**
       * 제출 전 그 글의 기기 변경이 서버에 다 닿기를 기다린다. 화면이 연 글이 없으면 직접 열어 기기 사본을 올리고
       * 동기화한다(안 그러면 기기에만 있는 지우기를 서버가 모른 채 옛 글이 제출될 수 있다).
       */
      const waitDocSynced = async (docId: string): Promise<void> => {
        const open = openDocs.get(docId);
        if (open) return open.waitSynced();
        let opening = queueDocs.get(docId);
        if (!opening) {
          opening = openProvider(docId);
          queueDocs.set(docId, opening);
        }
        const doc = await opening.catch((error: unknown) => {
          queueDocs.delete(docId);
          throw error;
        });
        try {
          await doc.waitSynced();
        } catch (error) {
          // 영구 거절된 제공자는 버리고, 다음 시도는 새로 연다.
          if (queueDocs.get(docId) === opening) {
            queueDocs.delete(docId);
            doc.close();
          }
          throw error;
        }
      };

      const onStatus = ({ status }: { status: string }) => {
        if (closed) return;
        if (status === 'connected') state.set('online');
        // 처음 연결 중이면 'connecting' 그대로, 끊긴 뒤 다시 시도하는 중이면 끊김 표시를 유지한다.
        else if (status === 'connecting') {
          if (state.get() === 'online') state.set('connecting');
        } else state.set(isOnline() ? 'server-down' : 'offline');
      };
      socket.on('status', onStatus);

      return {
        state,
        serverNow: () => clock.now(),
        joinRoom: roomId => {
          const base = openRoomChannel(roomId, {
            socket,
            config: deps.config,
            credential,
            clock,
            // tick이 끊기면 소켓을 끊었다 다시 붙인다(제공자들은 소켓이 다시 붙을 때 함께 다시 인증한다).
            // `disconnect()`는 "다시 연결하지 말 것"(shouldConnect=false)을 켜서, 끊긴 뒤 다시 붙지 않는다(e2e 결함 2).
            // 라이브러리가 신호 끊김 때 쓰는 강제 닫기 경로를 그대로 써서 정리 + 재연결 예약을 한다.
            reconnect: () => {
              if (socket.status === 'disconnected') {
                void socket.connect();
                return;
              }
              const stale = socket.webSocket;
              socket.onClose({ event: { code: 4408, reason: 'stale' } as CloseEvent });
              try {
                stale?.close(); // 처리기는 위에서 떼어졌으니 옛 소켓만 닫힌다
              } catch {
                // 이미 닫힘
              }
            },
          });
          const listeners = new Set<(r: OutboxResult) => void>();
          const channel: RoomChannel = {
            ...base,
            queue: {
              enqueue: entry => outbox.enqueue(entry),
              pending: () => outbox.pending(),
              onResult: listener => {
                const wrap = (r: OutboxResult) =>
                  listener({
                    commandId: r.entry.commandId,
                    ok: r.ok,
                    ...(r.data !== undefined ? { data: r.data } : {}),
                    ...(r.error ? { error: r.error } : {}),
                  });
                listeners.add(wrap);
                return () => listeners.delete(wrap);
              },
            },
            close() {
              outbox.close();
              base.close();
            },
          };
          const outbox = createOutbox({
            store: deps.localStore.outbox,
            channel,
            waitDocSynced,
            onResult: r => {
              for (const l of listeners) l(r);
            },
          });
          return channel;
        },
        openDoc: async docId => {
          // 대기열이 이미 열어 둔 글이면 그 제공자를 넘겨받는다(같은 소켓에 같은 글을 두 번 붙이지 않게).
          const queued = queueDocs.get(docId);
          if (queued) queueDocs.delete(docId);
          const doc = queued ? await queued : await openProvider(docId);
          openDocs.set(docId, doc);
          return {
            ...doc,
            close() {
              openDocs.delete(docId);
              doc.close();
            },
          };
        },
        close() {
          closed = true;
          for (const opening of queueDocs.values()) {
            void opening.then(
              doc => doc.close(),
              () => {},
            );
          }
          queueDocs.clear();
          socket.off('status', onStatus);
          socket.destroy();
          state.set('closed');
        },
      };
    },
  };
}
