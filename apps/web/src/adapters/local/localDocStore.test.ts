import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { openLocalDb, STORES } from './idb.ts';
import { createIndexedDbStore, createMemoryStore } from './localDocStore.ts';

const fresh = async () => openLocalDb(new IDBFactory());

function edits(count: number): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  for (let i = 0; i < count; i++) doc.getText('body').insert(i, String.fromCharCode(0xac00 + i));
  return { doc, updates };
}

describe('IndexedDB 글 저장소', () => {
  it('판 1에 저장소 다섯 개를 만든다', async () => {
    const db = await fresh();
    expect([...db.objectStoreNames].sort()).toEqual(Object.values(STORES).sort());
  });

  it('쌓은 업데이트를 불러오면 같은 글이고, 합친 뒤에도 같다', async () => {
    const store = createIndexedDbStore(await fresh());
    const { doc, updates } = edits(30);
    for (const u of updates) await store.appendUpdate('d1', u);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, (await store.loadDoc('d1'))!);
    expect(restored.getText('body').toString()).toBe(doc.getText('body').toString());

    await store.compact('d1');
    doc.getText('body').insert(0, '앞');
    await store.appendUpdate('d1', Y.encodeStateAsUpdate(doc));
    const again = new Y.Doc();
    Y.applyUpdate(again, (await store.loadDoc('d1'))!);
    expect(again.getText('body').toString()).toBe(doc.getText('body').toString());
  });

  it('합치기는 업데이트를 지우고 상태 하나로 남긴다', async () => {
    const db = await fresh();
    const store = createIndexedDbStore(db);
    for (const u of edits(10).updates) await store.appendUpdate('d2', u);
    await store.compact('d2');
    const tx = db.transaction(STORES.docUpdates, 'readonly');
    const count = await new Promise<number>(resolve => {
      const r = tx.objectStore(STORES.docUpdates).count();
      r.onsuccess = () => resolve(r.result);
    });
    expect(count).toBe(0);
  });

  it('두 탭이 같은 글에 써도 번호가 겹치지 않는다', async () => {
    const db = await fresh();
    const tabA = createIndexedDbStore(db);
    const tabB = createIndexedDbStore(db);
    const { doc, updates } = edits(20);
    await tabA.loadDoc('d3');
    await tabB.loadDoc('d3');
    await Promise.all(updates.map((u, i) => (i % 2 ? tabA : tabB).appendUpdate('d3', u)));
    const restored = new Y.Doc();
    Y.applyUpdate(restored, (await tabA.loadDoc('d3'))!);
    expect(restored.getText('body').toString()).toBe(doc.getText('body').toString());
  });

  it('없는 글은 null, 만료된 글은 지운다', async () => {
    const store = createIndexedDbStore(await fresh());
    expect(await store.loadDoc('none')).toBeNull();
    await store.appendUpdate('old', edits(2).updates[0]!);
    await store.setDocMeta('old', { roomId: 'r', expiresAt: 1000 });
    await store.setDocMeta('new', { roomId: 'r', expiresAt: 5000 });
    expect(await store.purgeExpired(2000)).toBe(1);
    expect(await store.loadDoc('old')).toBeNull();
    expect(await store.loadDoc('new')).not.toBeNull();
  });
});

describe('수업방 사본 지우기(검토 6번)', () => {
  const submit = (commandId: string, roomId: string, docId: string) => ({
    commandId,
    roomId,
    docId,
    name: 'doc.submit' as const,
    args: {},
    createdAt: 1,
  });

  it.each([
    ['IndexedDB', async () => createIndexedDbStore(await fresh())],
    ['메모리', async () => createMemoryStore()],
  ])('%s: 방 ID로 사본·대기열을 지우고, 상태 행이 없는 사본은 글 ID로 지운다', async (_name, make) => {
    const store = await make();
    const update = edits(2).updates[0]!;
    for (const id of ['mine', 'queued', 'orphan', 'other']) await store.appendUpdate(id, update);
    await store.setDocMeta('mine', { roomId: 'r1', expiresAt: null });
    await store.setDocMeta('other', { roomId: 'r2', expiresAt: null });
    // 'queued'는 상태 행이 없지만 그 방 대기열에 걸려 있다. 'orphan'은 기기 기억의 마지막 글로만 안다.
    await store.outbox.put(submit('c1', 'r1', 'queued'));
    await store.outbox.put(submit('c2', 'r2', 'other'));

    await store.purgeRoom('r1', ['orphan']);
    for (const id of ['mine', 'queued', 'orphan']) expect(await store.loadDoc(id)).toBeNull();
    expect(await store.loadDoc('other')).not.toBeNull();
    expect(await store.outbox.list('r1')).toEqual([]);
    expect((await store.outbox.list('r2')).map(e => e.commandId)).toEqual(['c2']);
  });

  it('만료된 글을 지울 때 그 글의 대기열 항목도 지운다', async () => {
    const store = createIndexedDbStore(await fresh());
    await store.appendUpdate('old', edits(2).updates[0]!);
    await store.setDocMeta('old', { roomId: 'r', expiresAt: 1000 });
    await store.outbox.put(submit('c-old', 'r', 'old'));
    await store.outbox.put(submit('c-new', 'r', 'new'));
    expect(await store.purgeExpired(2000)).toBe(1);
    expect((await store.outbox.list('r')).map(e => e.commandId)).toEqual(['c-new']);
  });
});

describe('메모리 저장소(IndexedDB를 못 쓸 때)', () => {
  it('같은 약속을 지킨다', async () => {
    const store = createMemoryStore();
    expect(store.volatile).toBe(true);
    const { doc, updates } = edits(5);
    for (const u of updates) await store.appendUpdate('m', u);
    await store.compact('m');
    const restored = new Y.Doc();
    Y.applyUpdate(restored, (await store.loadDoc('m'))!);
    expect(restored.getText('body').toString()).toBe(doc.getText('body').toString());
  });
});
