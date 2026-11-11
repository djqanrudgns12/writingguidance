import { bytesToBase64Url } from '@geulbang/core';
import { defaultConfig } from '@geulbang/core/config';
import type { Credential, Hello } from '@geulbang/core/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { startTestServer, type TestServer } from '../../apps/server/test/helpers.ts';
import { createRoom, joinRoom, type JoinedStudent } from '../../apps/server/test/roomClient.ts';
import { createMemoryStore } from '../../apps/web/src/adapters/local/localDocStore.ts';
import { createRealtimeAdapter } from '../../apps/web/src/adapters/realtime/session.ts';
import type { LocalStorePort } from '../../apps/web/src/ports/localStore.ts';
import type { Observable } from '../../apps/web/src/ports/observable.ts';
import type { RealtimeSession, RoomChannel } from '../../apps/web/src/ports/realtime.ts';

/** P5-5a 검토 5번(대기열 복구)·8번(수업방 채널 재인증): 기기 어댑터 + 실제 서버. */
const START_CODE = '12345678';

async function until<T>(source: Observable<T>, wanted: T, label: string, timeoutMs = 8000): Promise<void> {
  if (source.get() === wanted) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`시간 안에 ${label}=${String(wanted)}이 되지 않음 (지금 ${String(source.get())})`));
    }, timeoutMs);
    const off = source.subscribe(v => {
      if (v === wanted) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`시간 안에 되지 않음: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe('기기 수업방 흐름 + 실제 서버', () => {
  let t: TestServer;
  const sessions: RealtimeSession[] = [];
  const channels: RoomChannel[] = [];
  const config = { ...defaultConfig, RECONNECT_BACKOFF_MS: [100, 200, 400], CLIENT_STALE_SEC: 12 };

  const connect = (s: JoinedStudent, store: LocalStorePort) => {
    const adapter = createRealtimeAdapter({
      url: `${t.server.url.replace('http', 'ws')}/ws`,
      config,
      localStore: store,
    });
    const credential = (): Credential => ({ v: 1, kind: 'student', token: s.token, deviceId: s.deviceId });
    const session = adapter.connect(credential);
    sessions.push(session);
    return session;
  };
  const join = (session: RealtimeSession, roomId: string) => {
    const channel = session.joinRoom(roomId);
    channels.push(channel);
    return channel;
  };

  beforeAll(async () => {
    t = await startTestServer({
      TEACHER_START_CODE: START_CODE,
      SERVER_PERSIST_DEBOUNCE_MS: '50',
      SERVER_PERSIST_MAX_WAIT_MS: '200',
      ROOM_CREATE_PER_IP_PER_DAY: '1000',
    });
  });
  afterEach(() => {
    for (const c of channels.splice(0)) c.close();
    for (const s of sessions.splice(0)) s.close();
  });
  afterAll(async () => {
    await t.close();
  });

  it('대기열의 제출은 글이 열려 있지 않으면 열어 기기 사본(지우기만 한 편집)을 올린 뒤 제출한다(검토 5번)', async () => {
    const created = await createRoom(t, START_CODE);
    const s = await joinRoom(t, created.roomId, '하늘고래');
    const store = createMemoryStore();

    const first = connect(s, store);
    const channel = join(first, created.roomId);
    await until(channel.state, 'ready', 'hello');
    const { docId } = await channel.send<{ docId: string }>('doc.create', { genre: 'story' });
    const doc = await first.openDoc(docId);
    doc.netDoc.getText('body').insert(0, '가나다');
    await until(doc.saveState, 'saved', '저장됨');
    doc.close();
    channel.close();
    first.close();

    // 오프라인에서 지우기만 하고 제출을 대기열에 넣었다(기기 사본과 대기열만 있다).
    const offline = new Y.Doc();
    Y.applyUpdate(offline, (await store.loadDoc(docId))!);
    offline.on('update', (u: Uint8Array) => void store.appendUpdate(docId, u));
    offline.getText('body').delete(1, 1);
    await store.outbox.put({
      commandId: crypto.randomUUID(),
      roomId: created.roomId,
      docId,
      name: 'doc.submit',
      args: {
        docId,
        stateVector: bytesToBase64Url(Y.encodeStateVector(offline)),
        snapshot: bytesToBase64Url(Y.encodeSnapshot(Y.snapshot(offline))),
        generation: 0,
      },
      createdAt: Date.now(),
    });

    // 다시 들어오면 화면이 글을 열기 전에 대기열이 보낸다.
    const second = connect(s, store);
    const again = join(second, created.roomId);
    const results: boolean[] = [];
    again.queue.onResult(r => results.push(r.ok));
    await waitFor(() => results.length > 0, '대기열 결과');
    expect(results).toEqual([true]);
    expect(t.server.db.prepare('SELECT status, plain_text FROM documents WHERE id = ?').get(docId)).toEqual({
      status: 'SUBMITTED',
      plain_text: '가다',
    });
  });

  it('서버 인증 훅이 한 번 일반 오류로 실패해도 영구 E_AUTH로 굳지 않고 다시 인증한다(검토 8번)', async () => {
    const created = await createRoom(t, START_CODE);
    const s = await joinRoom(t, created.roomId, '바다별');
    let failOnce = true;
    // 인증 훅 맨 앞에 한 번만 던지는 확장을 끼운다(일시 DB 오류 흉내). Hocuspocus는 permission-denied로 보낸다.
    t.server.hocuspocus.configuration.extensions.unshift({
      async onAuthenticate({ documentName }: { documentName: string }) {
        if (failOnce && documentName.startsWith('room:')) {
          failOnce = false;
          throw new Error('일시 오류');
        }
      },
    });
    try {
      const session = connect(s, createMemoryStore());
      const channel = join(session, created.roomId);
      await until(channel.state, 'ready', '다시 인증해 hello');
      expect(failOnce).toBe(false);
      expect(channel.failure.get()).toBeNull();

      // 소켓은 살아 있는데 방 연결만 닫히면 다시 붙어 hello를 새로 받는다.
      const hellos: Hello[] = [];
      channel.hello.subscribe(h => {
        if (h) hellos.push(h);
      });
      t.server.hocuspocus.closeConnections(`room:${created.roomId}`);
      await waitFor(() => hellos.length > 0, '방 연결만 닫힌 뒤 hello');
      await until(channel.state, 'ready', '다시 준비');
    } finally {
      t.server.hocuspocus.configuration.extensions.shift();
    }
  });
});
