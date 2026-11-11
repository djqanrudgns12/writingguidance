import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createDeviceMemory, type StudentRoomMemory } from './deviceMemory.ts';
import { openLocalDb } from './idb.ts';
import { createIndexedDbStore, createMemoryStore } from './localDocStore.ts';

const room = (n: number, patch: Partial<StudentRoomMemory> = {}): StudentRoomMemory => ({
  roomId: `00000000-0000-4000-8000-00000000000${n}`,
  entryCode: `48291${n}`,
  className: `${n}반`,
  title: '가을 글쓰기',
  nickname: '하늘고래',
  participantId: `10000000-0000-4000-8000-00000000000${n}`,
  deviceToken: `token-${n}`,
  lastDocId: null,
  lastUsedAt: 1000 + n,
  expiresAt: 10_000,
  ...patch,
});

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

describe('명령 대기열·작은 값 저장소(IndexedDB)', () => {
  it('outbox는 수업방별로 만든 순서대로 돌려주고 지울 수 있다', async () => {
    const store = createIndexedDbStore(await openLocalDb(new IDBFactory()));
    await store.outbox.put({
      commandId: 'b',
      roomId: 'r1',
      docId: 'd',
      name: 'doc.submit',
      args: {},
      createdAt: 2,
    });
    await store.outbox.put({
      commandId: 'a',
      roomId: 'r1',
      docId: 'd',
      name: 'doc.submit',
      args: {},
      createdAt: 1,
    });
    await store.outbox.put({
      commandId: 'c',
      roomId: 'r2',
      docId: 'd',
      name: 'doc.submit',
      args: {},
      createdAt: 0,
    });
    expect((await store.outbox.list('r1')).map(e => e.commandId)).toEqual(['a', 'b']);
    await store.outbox.remove('a');
    expect((await store.outbox.list('r1')).map(e => e.commandId)).toEqual(['b']);
  });

  it('kv는 구조화 값을 그대로 돌려준다', async () => {
    const store = createIndexedDbStore(await openLocalDb(new IDBFactory()));
    await store.kv.set('x', { a: [1, 2] });
    expect(await store.kv.get('x')).toEqual({ a: [1, 2] });
    await store.kv.delete('x');
    expect(await store.kv.get('x')).toBeUndefined();
  });
});

describe('기기 기억(PRD F-23)', () => {
  it('기기 ID는 한 번 만들면 그대로다', async () => {
    let n = 0;
    const mem = createDeviceMemory({ kv: createMemoryStore().kv, storage: null, newId: () => `id-${++n}` });
    expect(await mem.deviceId()).toBe('id-1');
    expect(await mem.deviceId()).toBe('id-1');
  });

  it('최근 수업방은 최근 순·최대 개수, localStorage 사본에는 토큰이 없다', async () => {
    const storage = fakeStorage();
    const mem = createDeviceMemory({ kv: createMemoryStore().kv, storage });
    for (const n of [1, 2, 3]) await mem.rememberStudent(room(n), 2);
    const list = await mem.students(0);
    expect(list.map(e => e.className)).toEqual(['3반', '2반']);
    const copy = storage.map.get('geulbang.recentRooms') ?? '';
    expect(copy).not.toContain('token-');
    expect(mem.recentCardsSync(0).map(e => e.className)).toEqual(['3반', '2반']);
  });

  it('만료된 항목은 읽을 때 빠지고 purge가 지운 방 ID를 알려 준다', async () => {
    const mem = createDeviceMemory({ kv: createMemoryStore().kv, storage: fakeStorage() });
    await mem.rememberStudent(room(1, { expiresAt: 500 }), 5);
    await mem.rememberStudent(room(2, { expiresAt: 5000 }), 5);
    expect((await mem.students(1000)).map(e => e.className)).toEqual(['2반']);
    expect(await mem.purgeExpired(1000)).toEqual([room(1).roomId]);
    expect(await mem.purgeExpired(1000)).toEqual([]);
  });

  it('touch는 마지막 글과 사용 시각을 바꾼다', async () => {
    const mem = createDeviceMemory({ kv: createMemoryStore().kv, storage: null });
    await mem.rememberStudent(room(1), 5);
    await mem.touchStudent(room(1).roomId, {
      lastDocId: '20000000-0000-4000-8000-000000000001',
      lastUsedAt: 9,
    });
    expect((await mem.student(room(1).roomId, 0))?.lastDocId).toBe('20000000-0000-4000-8000-000000000001');
  });

  it('깨진 값이 저장돼 있어도 던지지 않고 빈 목록', async () => {
    const kv = createMemoryStore().kv;
    await kv.set('rooms.student', 'garbage');
    const mem = createDeviceMemory({ kv, storage: { getItem: () => '{not json', setItem: () => {} } });
    expect(await mem.students(0)).toEqual([]);
    expect(mem.recentCardsSync(0)).toEqual([]);
  });
});
