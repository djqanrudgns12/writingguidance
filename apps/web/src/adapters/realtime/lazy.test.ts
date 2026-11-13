import type { Hello, RoomEventData } from '@geulbang/core/protocol';
import { describe, expect, it } from 'vitest';
import { value } from '../../ports/observable.ts';
import type {
  ConnectionState,
  RealtimePort,
  RealtimeSession,
  RoomChannel,
  RoomChannelState,
} from '../../ports/realtime.ts';
import { createLazyRealtime } from './lazy.ts';

/** 진짜 어댑터 대신: 채널 하나를 만들어 두고, 시험이 이벤트·상태를 흘린다. */
function fakePort() {
  const listeners = new Map<string, Set<(data: unknown, serverNow: number) => void>>();
  const sent: string[] = [];
  const channelState = value<RoomChannelState>('connecting');
  const channel: RoomChannel = {
    roomId: 'r1',
    state: channelState,
    hello: value<Hello | null>(null),
    failure: value(null),
    on(name, listener) {
      let set = listeners.get(name);
      if (!set) listeners.set(name, (set = new Set()));
      set.add(listener as (data: unknown, serverNow: number) => void);
      return () => set.delete(listener as (data: unknown, serverNow: number) => void);
    },
    async send<T>(name: string) {
      sent.push(name);
      return { ok: name } as T;
    },
    queue: {
      enqueue: async () => 'cmd',
      pending: async () => [],
      flush: async () => {},
      onResult: () => () => {},
    },
    close() {
      channelState.set('closed');
    },
  };
  const sessionState = value<ConnectionState>('connecting');
  let connects = 0;
  const port: RealtimePort = {
    connect(): RealtimeSession {
      connects++;
      return {
        state: sessionState,
        serverNow: () => 42,
        openDoc: async () => {
          throw new Error('시험에서 쓰지 않음');
        },
        joinRoom: () => channel,
        close() {
          sessionState.set('closed');
        },
      };
    },
  };
  const emit = (name: string, data: unknown) => {
    for (const l of listeners.get(name) ?? []) l(data, 0);
  };
  return { port, channelState, sessionState, sent, emit, connects: () => connects };
}

const credential = () => ({
  v: 1 as const,
  kind: 'student' as const,
  token: 't'.repeat(43),
  deviceId: 'device-01',
});

describe('지연 실시간 어댑터', () => {
  it('처음 connect할 때만 불러오고, 불러오기 전에 받은 구독·명령을 진짜 채널로 넘긴다', async () => {
    const fake = fakePort();
    let loads = 0;
    const realtime = createLazyRealtime({
      serverNow: () => 7,
      load: async () => {
        loads++;
        return fake.port;
      },
    });
    expect(loads).toBe(0);
    const session = realtime.connect(credential);
    expect(session.serverNow()).toBe(7); // 불러오기 전에는 같은 시계
    const channel = session.joinRoom('r1');
    const notices: RoomEventData<'notice'>[] = [];
    channel.on('notice', d => notices.push(d));
    const reply = channel.send('ping', { sentAt: 1 });

    await expect(reply).resolves.toEqual({ ok: 'ping' });
    expect(loads).toBe(1);
    expect(session.serverNow()).toBe(42);
    fake.channelState.set('ready');
    expect(channel.state.get()).toBe('ready');
    fake.sessionState.set('online');
    expect(session.state.get()).toBe('online');
    const notice = { noticeId: 'n', text: '모여요', sentAt: 1, sound: false, kind: 'NOTICE' };
    fake.emit('notice', notice);
    expect(notices).toEqual([notice]);

    realtime.connect(credential);
    await Promise.resolve();
    expect(loads).toBe(1);
  });

  it('불러오기가 실패하면 채널은 다시 해 볼 수 있는 실패로 끝나고, 다음 connect에서 다시 불러온다', async () => {
    let loads = 0;
    const fake = fakePort();
    const realtime = createLazyRealtime({
      serverNow: () => 0,
      load: async () => {
        loads++;
        if (loads === 1) throw new Error('내려받기 끊김');
        return fake.port;
      },
    });
    const channel = realtime.connect(credential).joinRoom('r1');
    await expect(channel.send('ping', {})).rejects.toMatchObject({ code: 'E_OFFLINE' });
    expect(channel.state.get()).toBe('failed');
    expect(channel.failure.get()).toBe('E_SERVER_DOWN');

    const again = realtime.connect(credential).joinRoom('r1');
    await expect(again.send('ping', {})).resolves.toEqual({ ok: 'ping' });
    expect(loads).toBe(2);
  });

  it('불러오기 전에 닫은 세션은 진짜로 연결하지 않는다', async () => {
    const fake = fakePort();
    const realtime = createLazyRealtime({ serverNow: () => 0, load: async () => fake.port });
    const session = realtime.connect(credential);
    session.close();
    await new Promise(r => setTimeout(r, 0));
    expect(fake.connects()).toBe(0);
    expect(session.state.get()).toBe('closed');
  });
});
