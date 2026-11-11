import { AI_BUTTONS } from '@geulbang/core';
import { z } from 'zod';
import { aiResultSchemas, type AiButtonId } from '../../ports/api.ts';
import type { AiResultRecord, AiResultRecordOf, AiResultStorePort } from '../../ports/localStore.ts';
import { requestResult, STORES, transactionDone } from './idb.ts';

/**
 * 버튼별 마지막 AI 결과 저장소(PLAN §5.4 `ai_results`). 키는 `${docId}:${button}`(저장소 keyPath `key`).
 * 기기 저장은 바깥 입력이라 읽을 때 zod로 다시 본다: 모양이 깨졌거나 옛 판이면 없는 것으로 친다.
 */
export function aiResultKey(docId: string, button: AiButtonId): string {
  return `${docId}:${button}`;
}

/** 한 글의 버튼별 결과 전체 범위. docId는 UUID라 `:`가 없고, 버튼 이름은 영어 대문자다. */
export function aiResultRange(docId: string): IDBKeyRange {
  return IDBKeyRange.bound(`${docId}:`, `${docId}:￿`);
}

const base = {
  docId: z.string().min(1),
  textHash: z.string().min(1),
  receivedAt: z.number(),
  requestText: z.string(),
  truncated: z.boolean(),
};

const recordSchema = z.discriminatedUnion('button', [
  z.object({ ...base, button: z.literal('SPELL'), result: aiResultSchemas.SPELL }),
  z.object({ ...base, button: z.literal('FEEDBACK'), result: aiResultSchemas.FEEDBACK }),
  z.object({ ...base, button: z.literal('DIRECTION'), result: aiResultSchemas.DIRECTION }),
  z.object({ ...base, button: z.literal('POLISH'), result: aiResultSchemas.POLISH }),
]);

/** 저장된 줄을 기록으로. `key` 같은 저장소 필드는 버린다. */
export function parseAiResultRecord(raw: unknown): AiResultRecord | null {
  const r = recordSchema.safeParse(raw);
  return r.success ? r.data : null;
}

function narrow<B extends AiButtonId>(record: AiResultRecord | null, button: B): AiResultRecordOf<B> | null {
  // 판별 필드가 같으면 그 버튼의 기록이다(유니온을 제네릭으로 좁히는 곳은 여기 한 곳).
  return record && record.button === button ? (record as AiResultRecordOf<B>) : null;
}

const byButton = (a: AiResultRecord, b: AiResultRecord) =>
  AI_BUTTONS.indexOf(a.button) - AI_BUTTONS.indexOf(b.button);

export function createIndexedDbAiResults(db: IDBDatabase): AiResultStorePort {
  return {
    async get(docId, button) {
      const tx = db.transaction(STORES.aiResults, 'readonly');
      const row = await requestResult(tx.objectStore(STORES.aiResults).get(aiResultKey(docId, button)));
      return narrow(parseAiResultRecord(row), button);
    },
    async put(record) {
      const tx = db.transaction(STORES.aiResults, 'readwrite');
      tx.objectStore(STORES.aiResults).put({ key: aiResultKey(record.docId, record.button), ...record });
      await transactionDone(tx);
    },
    async list(docId) {
      const tx = db.transaction(STORES.aiResults, 'readonly');
      const rows = (await requestResult(
        tx.objectStore(STORES.aiResults).getAll(aiResultRange(docId)),
      )) as unknown[];
      return rows
        .map(parseAiResultRecord)
        .filter((r): r is AiResultRecord => r !== null && r.docId === docId)
        .sort(byButton);
    },
    async removeDoc(docId) {
      const tx = db.transaction(STORES.aiResults, 'readwrite');
      tx.objectStore(STORES.aiResults).delete(aiResultRange(docId));
      await transactionDone(tx);
    },
  };
}

/** IndexedDB를 못 쓸 때와 시험용. 구조화 복제로 넣고 꺼내 IndexedDB와 같은 약속을 지킨다. */
export function createMemoryAiResults(): AiResultStorePort {
  const rows = new Map<string, unknown>();
  return {
    async get(docId, button) {
      return narrow(parseAiResultRecord(structuredClone(rows.get(aiResultKey(docId, button)))), button);
    },
    async put(record) {
      rows.set(aiResultKey(record.docId, record.button), structuredClone(record));
    },
    async list(docId) {
      return [...rows.values()]
        .map(raw => parseAiResultRecord(structuredClone(raw)))
        .filter((r): r is AiResultRecord => r !== null && r.docId === docId)
        .sort(byButton);
    },
    async removeDoc(docId) {
      for (const key of [...rows.keys()]) if (key.startsWith(`${docId}:`)) rows.delete(key);
    },
  };
}
