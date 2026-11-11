import type { Config } from '@geulbang/core/config';
import type { Credential } from '@geulbang/core/protocol';
import { openDocProvider } from '../adapters/realtime/docProvider.ts';
import { createSocket } from '../adapters/realtime/socket.ts';
import type { LocalStorePort } from '../ports/localStore.ts';
import { value, type Observable } from '../ports/observable.ts';
import type { ConnectionState, SyncedDoc } from '../ports/realtime.ts';

/**
 * `/dev/editor` 주 편집기 연결.
 * 운영 어댑터(`createSocket` + `openDocProvider`)를 그대로 쓰되,
 * 오프라인 뒤 재접속 시나리오를 한 단추로 시험할 수 있도록 수동 연결 끊기·다시 잇기를 제공한다.
 */
export interface DevPrimaryConnectionDeps {
  readonly url: string;
  readonly config: Readonly<Config>;
  readonly localStore: LocalStorePort;
  readonly credential: () => Credential;
  readonly docId: string;
  readonly isOnline?: () => boolean;
}

export interface DevPrimaryConnection {
  readonly doc: SyncedDoc;
  readonly state: Observable<ConnectionState>;
  readonly manuallyDisconnected: Observable<boolean>;
  disconnect(): void;
  reconnect(): void;
  close(): void;
}

export async function openDevPrimaryConnection(
  deps: DevPrimaryConnectionDeps,
): Promise<DevPrimaryConnection> {
  const socket = createSocket(deps.url, deps.config);
  const state = value<ConnectionState>('connecting');
  const manuallyDisconnected = value(false);
  const isOnline = deps.isOnline ?? (() => globalThis.navigator?.onLine ?? true);
  let closed = false;

  const onStatus = ({ status }: { status: string }) => {
    if (closed) return;
    if (status === 'connected') {
      state.set('online');
      return;
    }
    if (manuallyDisconnected.get()) {
      state.set('offline');
      return;
    }
    if (status === 'connecting') {
      if (state.get() === 'online') state.set('connecting');
      return;
    }
    state.set(isOnline() ? 'server-down' : 'offline');
  };

  socket.on('status', onStatus);

  const doc = await openDocProvider(deps.docId, {
    socket,
    localStore: deps.localStore,
    credential: deps.credential,
  });

  return {
    doc,
    state,
    manuallyDisconnected,
    disconnect() {
      if (closed || manuallyDisconnected.get()) return;
      manuallyDisconnected.set(true);
      socket.cancelWebsocketRetry?.();
      socket.disconnect();
      if (socket.status !== 'disconnected') {
        socket.onClose({ event: { code: 1000, reason: 'manual-offline' } });
      } else {
        state.set('offline');
      }
    },
    reconnect() {
      if (closed || !manuallyDisconnected.get()) return;
      manuallyDisconnected.set(false);
      state.set('connecting');
      void socket.connect();
    },
    close() {
      if (closed) return;
      closed = true;
      socket.off('status', onStatus);
      doc.close();
      socket.destroy();
      state.set('closed');
    },
  };
}
