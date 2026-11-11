import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { AiResultRecord, AiResultRecordOf, AiResultStorePort } from '../../ports/localStore.ts';
import { aiResultKey, createIndexedDbAiResults, createMemoryAiResults } from './aiResults.ts';
import { openLocalDb, STORES } from './idb.ts';
import { createIndexedDbStore, createMemoryStore } from './localDocStore.ts';

const DOC = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';

const spell = (docId = DOC, patch: Partial<AiResultRecordOf<'SPELL'>> = {}): AiResultRecordOf<'SPELL'> => ({
  docId,
  button: 'SPELL',
  result: {
    items: [
      {
        original: '되요',
        suggestion: '돼요',
        reason: '되어요를 줄이면 돼요예요',
        kind: '맞춤법',
        context: { before: '정말 ', after: '.' },
      },
    ],
  },
  textHash: 'hash-1',
  receivedAt: 1000,
  requestText: '정말 되요.',
  truncated: false,
  ...patch,
});

const polish = (docId = DOC): AiResultRecordOf<'POLISH'> => ({
  docId,
  button: 'POLISH',
  result: { text: '정말 돼요.', stop: 'end', lengthWarning: false },
  textHash: 'hash-1',
  receivedAt: 2000,
  requestText: '정말 되요.',
  truncated: false,
});

const feedback = (docId = DOC): AiResultRecordOf<'FEEDBACK'> => ({
  docId,
  button: 'FEEDBACK',
  result: { praise: '장면이 잘 보여요.', improve: ['끝맺음을 더해 보면 어때요?'], factCheck: '언제였나요?' },
  textHash: 'hash-1',
  receivedAt: 3000,
  requestText: '정말 되요.',
  truncated: false,
});

const stores: [string, () => Promise<AiResultStorePort>][] = [
  ['IndexedDB', async () => createIndexedDbAiResults(await openLocalDb(new IDBFactory()))],
  ['메모리', async () => createMemoryAiResults()],
];

describe.each(stores)('AI 결과 저장소(%s)', (_name, make) => {
  it('넣은 것을 그대로 꺼내고, 다른 버튼·글은 없다', async () => {
    const store = await make();
    await store.put(spell());
    expect(await store.get(DOC, 'SPELL')).toEqual(spell());
    expect(await store.get(DOC, 'FEEDBACK')).toBeNull();
    expect(await store.get(OTHER, 'SPELL')).toBeNull();
  });

  it('같은 글·버튼은 마지막 결과로 바뀐다', async () => {
    const store = await make();
    await store.put(spell());
    await store.put(spell(DOC, { textHash: 'hash-2', receivedAt: 5000 }));
    expect(await store.get(DOC, 'SPELL')).toMatchObject({ textHash: 'hash-2', receivedAt: 5000 });
    expect(await store.list(DOC)).toHaveLength(1);
  });

  it('글의 결과 목록은 버튼 순서이고, 글마다 지울 수 있다', async () => {
    const store = await make();
    await store.put(polish());
    await store.put(feedback());
    await store.put(spell());
    await store.put(spell(OTHER));
    const list: AiResultRecord[] = await store.list(DOC);
    expect(list.map(r => r.button)).toEqual(['SPELL', 'FEEDBACK', 'POLISH']);
    await store.removeDoc(DOC);
    expect(await store.list(DOC)).toEqual([]);
    expect(await store.get(OTHER, 'SPELL')).toEqual(spell(OTHER));
  });

  it('꺼낸 값을 고쳐도 저장된 값은 그대로', async () => {
    const store = await make();
    await store.put(feedback());
    const got = await store.get(DOC, 'FEEDBACK');
    (got?.result.improve as string[]).push('바뀜');
    expect((await store.get(DOC, 'FEEDBACK'))?.result.improve).toHaveLength(1);
  });
});

describe('IndexedDB AI 결과 저장소', () => {
  it('저장소를 다시 열어도(새로고침) 결과가 남아 있다', async () => {
    const db = await openLocalDb(new IDBFactory());
    await createIndexedDbAiResults(db).put(polish());
    expect(await createIndexedDbAiResults(db).get(DOC, 'POLISH')).toEqual(polish());
  });

  it('키는 `${docId}:${button}`이고, 모양이 깨진 줄은 없는 것으로 친다', async () => {
    const db = await openLocalDb(new IDBFactory());
    const store = createIndexedDbAiResults(db);
    await store.put(spell());
    const tx = db.transaction(STORES.aiResults, 'readwrite');
    tx.objectStore(STORES.aiResults).put({
      key: aiResultKey(DOC, 'FEEDBACK'),
      docId: DOC,
      button: 'FEEDBACK',
    });
    await new Promise(resolve => (tx.oncomplete = resolve));
    const raw = await new Promise(resolve => {
      const r = db.transaction(STORES.aiResults).objectStore(STORES.aiResults).get(`${DOC}:SPELL`);
      r.onsuccess = () => resolve(r.result);
    });
    expect(raw).toMatchObject({ key: `${DOC}:SPELL`, button: 'SPELL' });
    expect(await store.get(DOC, 'FEEDBACK')).toBeNull();
    expect((await store.list(DOC)).map(r => r.button)).toEqual(['SPELL']);
    expect(await store.get(DOC, 'SPELL')).not.toHaveProperty('key');
  });
});

describe('글 사본이 만료되면 AI 결과도 지운다(학생 글이 들어 있어서)', () => {
  it.each([
    ['IndexedDB', async () => createIndexedDbStore(await openLocalDb(new IDBFactory()))],
    ['메모리', async () => createMemoryStore()],
  ])('%s', async (_name, make) => {
    const store = await make();
    await store.setDocMeta(DOC, { roomId: 'r', expiresAt: 1000 });
    await store.setDocMeta(OTHER, { roomId: 'r', expiresAt: 5000 });
    await store.aiResults.put(spell(DOC));
    await store.aiResults.put(polish(DOC));
    await store.aiResults.put(spell(OTHER));
    expect(await store.purgeExpired(2000)).toBe(1);
    expect(await store.aiResults.list(DOC)).toEqual([]);
    expect(await store.aiResults.get(OTHER, 'SPELL')).toEqual(spell(OTHER));
  });
});
