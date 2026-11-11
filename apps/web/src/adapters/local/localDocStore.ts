import * as Y from 'yjs';
import type {
  DocMeta,
  KvStorePort,
  LocalStorePort,
  OutboxEntry,
  OutboxStorePort,
} from '../../ports/localStore.ts';
import { aiResultRange, createIndexedDbAiResults, createMemoryAiResults } from './aiResults.ts';
import { docRange, openLocalDb, requestResult, STORES, transactionDone } from './idb.ts';

interface UpdateRow {
  readonly docId: string;
  readonly seq: number;
  readonly update: Uint8Array;
}

interface StateRow {
  readonly docId: string;
  readonly roomId: string | null;
  readonly state: Uint8Array;
  readonly seqUpTo: number;
  readonly updatedAt: number;
  readonly expiresAt: number | null;
}

/**
 * IndexedDB 글 저장소(PLAN §5.4). 업데이트를 `[docId, seq]`로 쌓고 가끔 상태 하나로 합친다.
 * 합치기는 상태 쓰기와 `seq ≤ seqUpTo` 지우기를 한 트랜잭션으로, 여러 탭이 동시에 합치지 않게 `navigator.locks`로
 * 글마다 잠근다. 여러 탭이 같은 seq를 쓰려 하면 `add`가 막으므로 다음 번호로 다시 쓴다.
 */
export function createIndexedDbStore(db: IDBDatabase, now: () => number = Date.now): LocalStorePort {
  const nextSeq = new Map<string, number>();

  const maxSeq = async (docId: string): Promise<number> => {
    const tx = db.transaction(STORES.docUpdates, 'readonly');
    const cursor = await requestResult(
      tx.objectStore(STORES.docUpdates).openKeyCursor(docRange(docId), 'prev'),
    );
    const key = cursor?.primaryKey as [string, number] | undefined;
    return key ? key[1] : 0;
  };

  const withLock = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    if (!locks) return fn();
    return locks.request(name, fn) as Promise<T>;
  };

  const outbox: OutboxStorePort = {
    async put(entry) {
      const tx = db.transaction(STORES.outbox, 'readwrite');
      tx.objectStore(STORES.outbox).put(entry);
      await transactionDone(tx);
    },
    async list(roomId) {
      const tx = db.transaction(STORES.outbox, 'readonly');
      const rows = (await requestResult(tx.objectStore(STORES.outbox).getAll())) as OutboxEntry[];
      return rows.filter(r => r.roomId === roomId).sort((a, b) => a.createdAt - b.createdAt);
    },
    async remove(commandId) {
      const tx = db.transaction(STORES.outbox, 'readwrite');
      tx.objectStore(STORES.outbox).delete(commandId);
      await transactionDone(tx);
    },
  };
  const kv: KvStorePort = {
    async get(key) {
      const tx = db.transaction(STORES.kv, 'readonly');
      return (await requestResult(tx.objectStore(STORES.kv).get(key))) as unknown;
    },
    async set(key, value) {
      const tx = db.transaction(STORES.kv, 'readwrite');
      tx.objectStore(STORES.kv).put(value, key);
      await transactionDone(tx);
    },
    async delete(key) {
      const tx = db.transaction(STORES.kv, 'readwrite');
      tx.objectStore(STORES.kv).delete(key);
      await transactionDone(tx);
    },
  };

  /**
   * 고른 글 사본(상태·업데이트·AI 결과)과 대기열 항목을 한 트랜잭션으로 지운다. AI 결과·대기열에도 학생 글이 들어 있어
   * 글 사본과 함께 지운다(PRD F-24·§13.2). 지운 글 수를 돌려준다.
   */
  const purgeWhere = async (
    pick: (
      rows: readonly StateRow[],
      entries: readonly OutboxEntry[],
    ) => { docs: ReadonlySet<string>; commands: readonly OutboxEntry[] },
  ): Promise<number> => {
    const tx = db.transaction(
      [STORES.docState, STORES.docUpdates, STORES.aiResults, STORES.outbox],
      'readwrite',
    );
    const states = tx.objectStore(STORES.docState);
    const outboxStore = tx.objectStore(STORES.outbox);
    const [rows, entries] = (await Promise.all([
      requestResult(states.getAll()),
      requestResult(outboxStore.getAll()),
    ])) as [StateRow[], OutboxEntry[]];
    const { docs, commands } = pick(rows, entries);
    for (const docId of docs) {
      states.delete(docId);
      tx.objectStore(STORES.docUpdates).delete(docRange(docId));
      tx.objectStore(STORES.aiResults).delete(aiResultRange(docId));
      nextSeq.delete(docId);
    }
    for (const e of commands) outboxStore.delete(e.commandId);
    await transactionDone(tx);
    return docs.size;
  };

  return {
    volatile: false,
    outbox,
    kv,
    aiResults: createIndexedDbAiResults(db),

    async loadDoc(docId) {
      const tx = db.transaction([STORES.docState, STORES.docUpdates], 'readonly');
      // 읽기 둘을 먼저 함께 걸어 둔다(트랜잭션이 기다리는 사이에 닫히지 않게).
      const [stateRow, rows] = (await Promise.all([
        requestResult(tx.objectStore(STORES.docState).get(docId)),
        requestResult(tx.objectStore(STORES.docUpdates).getAll(docRange(docId))),
      ])) as [StateRow | undefined, UpdateRow[]];
      const last = rows.at(-1)?.seq ?? stateRow?.seqUpTo ?? 0;
      nextSeq.set(docId, Math.max(last, stateRow?.seqUpTo ?? 0) + 1);
      const parts = [...(stateRow ? [stateRow.state] : []), ...rows.map(r => r.update)];
      if (parts.length === 0) return null;
      return parts.length === 1 ? (parts[0] ?? null) : Y.mergeUpdates(parts);
    },

    async appendUpdate(docId, update) {
      if (!nextSeq.has(docId)) nextSeq.set(docId, (await maxSeq(docId)) + 1);
      for (;;) {
        const seq = nextSeq.get(docId) ?? 1;
        nextSeq.set(docId, seq + 1);
        const tx = db.transaction(STORES.docUpdates, 'readwrite');
        const request = tx.objectStore(STORES.docUpdates).add({ docId, seq, update } satisfies UpdateRow);
        try {
          await transactionDone(tx);
          return;
        } catch (error) {
          // 다른 탭이 같은 번호를 먼저 썼다 → 마지막 번호를 다시 읽고 다음 번호로. 오류는 요청 쪽에 실린다.
          if (request.error?.name !== 'ConstraintError') throw error;
          nextSeq.set(docId, (await maxSeq(docId)) + 1);
        }
      }
    },

    async compact(docId) {
      await withLock(`geulbang-compact-${docId}`, async () => {
        const tx = db.transaction([STORES.docState, STORES.docUpdates], 'readwrite');
        const states = tx.objectStore(STORES.docState);
        const updates = tx.objectStore(STORES.docUpdates);
        const [stateRow, rows] = (await Promise.all([
          requestResult(states.get(docId)),
          requestResult(updates.getAll(docRange(docId))),
        ])) as [StateRow | undefined, UpdateRow[]];
        const lastRow = rows.at(-1);
        if (!lastRow) return;
        const merged = Y.mergeUpdates([...(stateRow ? [stateRow.state] : []), ...rows.map(r => r.update)]);
        states.put({
          docId,
          roomId: stateRow?.roomId ?? null,
          expiresAt: stateRow?.expiresAt ?? null,
          state: merged,
          seqUpTo: lastRow.seq,
          updatedAt: now(),
        } satisfies StateRow);
        updates.delete(docRange(docId, lastRow.seq));
        await transactionDone(tx);
      });
    },

    async setDocMeta(docId, meta: DocMeta) {
      const tx = db.transaction(STORES.docState, 'readwrite');
      const store = tx.objectStore(STORES.docState);
      const row = (await requestResult(store.get(docId))) as StateRow | undefined;
      store.put({
        docId,
        state: row?.state ?? Y.encodeStateAsUpdate(new Y.Doc()),
        seqUpTo: row?.seqUpTo ?? 0,
        updatedAt: now(),
        roomId: meta.roomId,
        expiresAt: meta.expiresAt,
      } satisfies StateRow);
      await transactionDone(tx);
    },

    async purgeExpired(at) {
      return purgeWhere((rows, entries) => {
        const docs = new Set<string>();
        for (const r of rows) if (r.expiresAt !== null && r.expiresAt <= at) docs.add(r.docId);
        return { docs, commands: entries.filter(e => e.docId !== null && docs.has(e.docId)) };
      });
    },

    async purgeRoom(roomId, docIds = []) {
      return purgeWhere((rows, entries) => {
        const docs = new Set(docIds);
        for (const r of rows) if (r.roomId === roomId) docs.add(r.docId);
        const commands = entries.filter(e => e.roomId === roomId);
        // 상태 행이 없이 업데이트만 있는 사본도 대기열에 걸려 있으면 함께 지운다.
        for (const e of commands) if (e.docId !== null) docs.add(e.docId);
        return { docs, commands };
      });
    },
  };
}

/**
 * IndexedDB를 열 수 없을 때(사파리 개인 정보 보호 등) 쓰는 메모리 저장소. 새로고침하면 사라진다.
 * 화면은 `volatile`을 보고 E_STORAGE_BLOCKED 띠를 띄운다(PLAN §2.4). 시험에서도 쓴다.
 */
export function createMemoryStore(): LocalStorePort {
  const docs = new Map<string, { parts: Uint8Array[]; meta: DocMeta }>();
  const entry = (docId: string) => {
    let e = docs.get(docId);
    if (!e) {
      e = { parts: [], meta: { roomId: null, expiresAt: null } };
      docs.set(docId, e);
    }
    return e;
  };
  const outboxRows = new Map<string, OutboxEntry>();
  const kvRows = new Map<string, unknown>();
  const aiResults = createMemoryAiResults();
  const removeDocs = async (
    targets: ReadonlySet<string>,
    commands: readonly OutboxEntry[],
  ): Promise<number> => {
    let removed = 0;
    for (const docId of targets) {
      if (docs.delete(docId)) removed++;
      await aiResults.removeDoc(docId);
    }
    for (const r of commands) outboxRows.delete(r.commandId);
    return removed;
  };
  return {
    volatile: true,
    aiResults,
    outbox: {
      async put(e) {
        outboxRows.set(e.commandId, e);
      },
      async list(roomId) {
        return [...outboxRows.values()]
          .filter(r => r.roomId === roomId)
          .sort((a, b) => a.createdAt - b.createdAt);
      },
      async remove(commandId) {
        outboxRows.delete(commandId);
      },
    },
    kv: {
      async get(key) {
        return kvRows.get(key);
      },
      async set(key, v) {
        kvRows.set(key, structuredClone(v));
      },
      async delete(key) {
        kvRows.delete(key);
      },
    },
    async loadDoc(docId) {
      const parts = docs.get(docId)?.parts ?? [];
      return parts.length === 0 ? null : Y.mergeUpdates(parts);
    },
    async appendUpdate(docId, update) {
      entry(docId).parts.push(update);
    },
    async compact(docId) {
      const e = docs.get(docId);
      if (e && e.parts.length > 1) e.parts = [Y.mergeUpdates(e.parts)];
    },
    async setDocMeta(docId, meta) {
      entry(docId).meta = meta;
    },
    async purgeExpired(at) {
      const gone = [...docs]
        .filter(([, e]) => e.meta.expiresAt !== null && e.meta.expiresAt <= at)
        .map(([docId]) => docId);
      return removeDocs(
        new Set(gone),
        [...outboxRows.values()].filter(r => r.docId !== null && gone.includes(r.docId)),
      );
    },
    async purgeRoom(roomId, docIds = []) {
      const targets = new Set(docIds);
      for (const [docId, e] of docs) if (e.meta.roomId === roomId) targets.add(docId);
      const commands = [...outboxRows.values()].filter(r => r.roomId === roomId);
      for (const r of commands) if (r.docId !== null) targets.add(r.docId);
      return removeDocs(targets, commands);
    },
  };
}

/** IndexedDB를 먼저 열어 보고, 안 되면 메모리 저장소로. */
export async function openLocalStore(): Promise<LocalStorePort> {
  try {
    return createIndexedDbStore(await openLocalDb());
  } catch {
    return createMemoryStore();
  }
}
