import { describe, expect, it } from 'vitest';
import { value } from '../../ports/observable.ts';
import type { CommandError, RoomChannel, RoomChannelState } from '../../ports/realtime.ts';
import { createMemoryStore } from '../local/localDocStore.ts';
import { createOutbox, type OutboxResult } from './outbox.ts';
import { createServerClock } from './serverClock.ts';

type Reply = { ok: true; data: unknown } | { ok: false; error: CommandError };

function fakeChannel(replies: Reply[]) {
  const state = value<RoomChannelState>('connecting');
  const sent: { name: string; commandId: string | undefined }[] = [];
  const channel: Pick<RoomChannel, 'roomId' | 'state' | 'send'> & Omit<RoomChannel, 'queue'> = {
    roomId: 'r1',
    state,
    hello: value(null),
    failure: value(null),
    on: () => () => {},
    async send<T>(name: string, _args: unknown, options?: { commandId?: string }) {
      sent.push({ name, commandId: options?.commandId });
      const r = replies.shift() ?? { ok: true, data: null };
      if (r.ok) return r.data as T;
      throw r.error;
    },
    close() {},
  };
  return { channel, state, sent };
}

const settle = () => new Promise(r => setTimeout(r, 0));

describe('명령 대기열(outbox)', () => {
  it('연결되기 전에는 보내지 않고, 준비되면 글 동기화를 기다린 뒤 같은 commandId로 보낸다', async () => {
    const { channel, state, sent } = fakeChannel([{ ok: true, data: { status: 'SUBMITTED' } }]);
    const store = createMemoryStore();
    const waited: string[] = [];
    const results: OutboxResult[] = [];
    const outbox = createOutbox({
      store: store.outbox,
      channel,
      waitDocSynced: async id => void waited.push(id),
      onResult: r => results.push(r),
      newId: () => 'cmd-1',
    });
    await outbox.enqueue({ docId: 'd1', name: 'doc.submit', args: { docId: 'd1' } });
    await settle();
    expect(sent).toEqual([]);
    state.set('ready');
    await settle();
    await outbox.flush();
    expect(waited).toEqual(['d1']);
    expect(sent).toEqual([{ name: 'doc.submit', commandId: 'cmd-1' }]);
    expect(results[0]?.ok).toBe(true);
    expect(await outbox.pending()).toEqual([]);
    outbox.close();
  });

  it('E_SYNC_PENDING은 남겨 두고 다시 보낸다, E_STALE은 지우고 알린다', async () => {
    const { channel, state, sent } = fakeChannel([
      { ok: false, error: { code: 'E_SYNC_PENDING', retryable: true } },
      { ok: false, error: { code: 'E_STALE', retryable: false } },
    ]);
    const store = createMemoryStore();
    const results: OutboxResult[] = [];
    let n = 0;
    const outbox = createOutbox({
      store: store.outbox,
      channel,
      waitDocSynced: async () => {},
      onResult: r => results.push(r),
      retryDelayMs: 1,
      newId: () => `c${++n}`,
    });
    state.set('ready');
    await outbox.enqueue({ docId: 'd1', name: 'doc.submit', args: {} });
    await outbox.flush();
    expect((await outbox.pending()).length).toBe(1);
    await new Promise(r => setTimeout(r, 10));
    await outbox.flush();
    expect(sent.map(s => s.commandId)).toEqual(['c1', 'c1']);
    expect(results.at(-1)?.error?.code).toBe('E_STALE');
    expect(await outbox.pending()).toEqual([]);
    outbox.close();
  });

  it('붙잡을 거절(동의 판이 지난 제출, P6-consent-block)은 지우지도 알리지도 다시 돌지도 않고, 다음 flush에 같은 commandId로 보낸다', async () => {
    const { channel, state, sent } = fakeChannel([
      { ok: false, error: { code: 'E_INPUT', retryable: false } },
      { ok: true, data: { status: 'SUBMITTED' } },
    ]);
    const store = createMemoryStore();
    const results: OutboxResult[] = [];
    let n = 0;
    const outbox = createOutbox({
      store: store.outbox,
      channel,
      waitDocSynced: async () => {},
      onResult: r => results.push(r),
      holdOn: e => e.code === 'E_INPUT',
      retryDelayMs: 1,
      newId: () => `c${++n}`,
    });
    state.set('ready');
    await outbox.enqueue({ docId: 'd1', name: 'doc.submit', args: {} });
    await outbox.flush();
    await new Promise(r => setTimeout(r, 10));
    // 붙잡힘: 남아 있고, 결과를 알리지 않고, 시간표로 다시 보내지도 않는다.
    expect(sent.map(s => s.commandId)).toEqual(['c1']);
    expect(results).toEqual([]);
    expect((await outbox.pending()).map(e => e.commandId)).toEqual(['c1']);

    // 재동의 뒤 `flush`: 같은 명령으로 보내 제출된다.
    await outbox.flush();
    expect(sent.map(s => s.commandId)).toEqual(['c1', 'c1']);
    expect(results.map(r => [r.entry.commandId, r.ok])).toEqual([['c1', true]]);
    expect(await outbox.pending()).toEqual([]);
    outbox.close();
  });
});

describe('명령 대기열: 글 동기화 기다리기가 거부되면(검토 7번)', () => {
  it('글이 닫혀 거부되면 항목을 남긴 채 실행을 끝내고(running 풀림), 잠시 뒤 새 제공자로 다시 보낸다', async () => {
    const { channel, state, sent } = fakeChannel([{ ok: true, data: { status: 'SUBMITTED' } }]);
    const store = createMemoryStore();
    let attempts = 0;
    const outbox = createOutbox({
      store: store.outbox,
      channel,
      waitDocSynced: async () => {
        attempts++;
        // 첫 제공자는 동기화 전에 닫힌다. 다음 시도는 새로 연 제공자가 동기화된다.
        if (attempts === 1) throw { code: 'E_OFFLINE', retryable: true } satisfies CommandError;
      },
      retryDelayMs: 1,
      newId: () => 'cmd-closed',
    });
    state.set('ready');
    await outbox.enqueue({ docId: 'd1', name: 'doc.submit', args: {} });
    await outbox.flush(); // 멈춰 있지 않고 끝난다
    expect(sent).toEqual([]);
    expect((await outbox.pending()).map(e => e.commandId)).toEqual(['cmd-closed']);
    await new Promise(r => setTimeout(r, 10));
    await outbox.flush();
    expect(attempts).toBe(2);
    expect(sent).toEqual([{ name: 'doc.submit', commandId: 'cmd-closed' }]);
    expect(await outbox.pending()).toEqual([]);
    outbox.close();
  });

  it('영구 거절(retryable:false)이면 글 사본은 두고 실패로 알린 뒤 대기열에서 빼고, 뒤의 다른 글 제출을 보낸다(검토 B07)', async () => {
    const { channel, state, sent } = fakeChannel([{ ok: true, data: { status: 'SUBMITTED' } }]);
    const store = createMemoryStore();
    await store.appendUpdate('d1', new Uint8Array([1, 2, 3]));
    const results: OutboxResult[] = [];
    let n = 0;
    let attempts = 0;
    const outbox = createOutbox({
      store: store.outbox,
      channel,
      waitDocSynced: async docId => {
        if (docId !== 'd1') return;
        attempts++;
        throw { code: 'E_DOC_TOO_LARGE', retryable: false } satisfies CommandError;
      },
      onResult: r => results.push(r),
      retryDelayMs: 1,
      newId: () => `c${++n}`,
    });
    await outbox.enqueue({ docId: 'd1', name: 'doc.submit', args: { docId: 'd1' } });
    await outbox.enqueue({ docId: 'd2', name: 'doc.submit', args: { docId: 'd2' } });
    state.set('ready');
    await settle();
    await outbox.flush();
    await new Promise(r => setTimeout(r, 10));

    // A는 실패로 알리고(화면이 제출 잠금을 푼다) 대기열에서 빠진다. 다시 돌지 않는다.
    expect(attempts).toBe(1);
    expect(results.map(r => [r.entry.commandId, r.ok, r.error?.code])).toEqual([
      ['c1', false, 'E_DOC_TOO_LARGE'],
      ['c2', true, undefined],
    ]);
    // B는 막히지 않고 보내졌다.
    expect(sent).toEqual([{ name: 'doc.submit', commandId: 'c2' }]);
    expect(await outbox.pending()).toEqual([]);
    // 글 사본은 그대로 남는다(대기열은 명령만 지운다).
    expect(await store.loadDoc('d1')).not.toBeNull();
    outbox.close();
  });
});

describe('서버 시각', () => {
  it('가운데 값을 써서 한 번 튀는 값에 흔들리지 않는다', () => {
    let local = 1000;
    const clock = createServerClock(() => local);
    clock.observe(6000); // +5000
    clock.observe(6010); // +5010
    clock.observe(99_999); // 튐
    expect(clock.offset()).toBe(5010);
    local = 2000;
    expect(clock.now()).toBe(7010);
  });

  it('왕복 시간을 알면 절반을 더한다', () => {
    const clock = createServerClock(() => 0);
    clock.observe(100, 40);
    expect(clock.offset()).toBe(120);
  });
});
