import type { ErrorCode } from '@geulbang/core/errors';
import type { Credential, Hello } from '@geulbang/core/protocol';
import { value, type Observable, type Unsubscribe, type Value } from '../../ports/observable.ts';
import type {
  CommandError,
  CommandQueue,
  ConnectionState,
  RealtimePort,
  RealtimeSession,
  RoomChannel,
  RoomChannelState,
} from '../../ports/realtime.ts';

/**
 * 실시간 포트를 처음 `connect`할 때 불러오는 지연 래퍼. Hocuspocus 제공자 묶음이 첫 화면 묶음에 들어가지 않게
 * `app/providers.tsx`가 진짜 어댑터를 동적 import로 넘긴다. 바깥 모양(`RealtimePort`)은 그대로라 화면·유스케이스는
 * 차이를 모른다. 불러오는 동안 받은 구독·명령은 진짜 세션·채널이 생기면 그대로 넘긴다.
 * 이 파일은 타입 말고는 실시간 어댑터를 가져오지 않는다(그래야 지연이 된다).
 */
export interface LazyRealtimeDeps {
  readonly load: () => Promise<RealtimePort>;
  /** 진짜 세션이 생기기 전의 서버 기준 지금(같은 시계를 넘긴다) */
  readonly serverNow: () => number;
  readonly onError?: (error: unknown) => void;
  /** hello를 받을 때마다(다시 연결 포함) 다른 구독보다 먼저 부른다(서버 설정을 먼저 덮으려고). */
  readonly onHello?: (hello: Hello) => void;
}

const offline = (): CommandError => ({ code: 'E_OFFLINE', retryable: true });

export function createLazyRealtime(deps: LazyRealtimeDeps): RealtimePort {
  let port: Promise<RealtimePort> | null = null;
  const loadOnce = () => (port ??= deps.load());

  return {
    connect(credential: () => Credential): RealtimeSession {
      const state = value<ConnectionState>('connecting');
      let closed = false;
      let real: RealtimeSession | null = null;
      const session: Promise<RealtimeSession | null> = loadOnce().then(
        p => {
          if (closed) return null;
          real = p.connect(credential);
          mirror(real.state, state);
          return real;
        },
        (error: unknown) => {
          // 불러오기 실패(내려받기 끊김 등): 연결이 없는 것과 같다. 다음 connect에서 다시 불러온다.
          port = null;
          deps.onError?.(error);
          if (!closed) state.set('server-down');
          return null;
        },
      );

      return {
        state,
        serverNow: () => real?.serverNow() ?? deps.serverNow(),
        async openDoc(docId) {
          const s = await session;
          if (!s) throw offline();
          return s.openDoc(docId);
        },
        joinRoom: roomId => lazyChannel(roomId, session, deps.onHello),
        close() {
          closed = true;
          real?.close();
          state.set('closed');
        },
      };
    },
  };
}

/** 진짜 값이 생기면 따라가게 한다. */
function mirror<T>(source: Observable<T>, target: Value<T>): void {
  target.set(source.get());
  source.subscribe(v => target.set(v));
}

type Listener = Parameters<RoomChannel['on']>[1];
type ResultListener = Parameters<CommandQueue['onResult']>[0];

function lazyChannel(
  roomId: string,
  session: Promise<RealtimeSession | null>,
  onHello?: (hello: Hello) => void,
): RoomChannel {
  const state = value<RoomChannelState>('connecting');
  const hello = value<Hello | null>(null);
  const failure = value<ErrorCode | null>(null);
  let closed = false;
  let real: RoomChannel | null = null;
  // 진짜 채널이 생기기 전에 받은 구독. 생기면 붙이고, 그 해제 함수를 기억한다.
  const waitingOn = new Map<{ name: string; listener: Listener }, Unsubscribe | null>();
  const waitingResults = new Map<ResultListener, Unsubscribe | null>();

  const channel: Promise<RoomChannel | null> = session.then(s => {
    if (!s || closed) {
      // 실시간 어댑터를 불러오지 못했다: 서버에 닿지 않는 것과 같게 알린다(다시 해 볼 수 있음).
      if (!closed) {
        failure.set('E_SERVER_DOWN');
        state.set('failed');
      }
      return null;
    }
    const c = s.joinRoom(roomId);
    real = c;
    if (onHello) {
      // 바깥 hello 값보다 먼저 알린다: hello를 기다리던 쪽이 깨어날 때 설정이 이미 덮여 있게.
      const first = c.hello.get();
      if (first) onHello(first);
      c.hello.subscribe(h => {
        if (h) onHello(h);
      });
    }
    mirror(c.state, state);
    mirror(c.hello, hello);
    mirror(c.failure, failure);
    for (const key of waitingOn.keys()) {
      waitingOn.set(key, c.on(key.name as Parameters<RoomChannel['on']>[0], key.listener));
    }
    for (const listener of waitingResults.keys()) waitingResults.set(listener, c.queue.onResult(listener));
    return c;
  });
  const ready = async (): Promise<RoomChannel> => {
    const c = await channel;
    if (!c || closed) throw offline();
    return c;
  };

  return {
    roomId,
    state,
    hello,
    failure,
    on(name, listener) {
      if (real) return real.on(name, listener);
      const key = { name, listener: listener as Listener };
      waitingOn.set(key, null);
      return () => {
        waitingOn.get(key)?.();
        waitingOn.delete(key);
      };
    },
    async send<T = unknown>(
      name: Parameters<RoomChannel['send']>[0],
      args: unknown,
      options?: { commandId?: string },
    ) {
      return (await ready()).send<T>(name, args, options);
    },
    queue: {
      enqueue: async entry => (await ready()).queue.enqueue(entry),
      pending: async () => (await ready()).queue.pending(),
      flush: async () => {
        // 아직 연결 전이면 보낼 것도 없다(연결되면 대기열이 스스로 보낸다).
        if (real) await real.queue.flush();
      },
      onResult(listener) {
        if (real) return real.queue.onResult(listener);
        waitingResults.set(listener, null);
        return () => {
          waitingResults.get(listener)?.();
          waitingResults.delete(listener);
        };
      },
    },
    close() {
      closed = true;
      real?.close();
      state.set('closed');
    },
  };
}
