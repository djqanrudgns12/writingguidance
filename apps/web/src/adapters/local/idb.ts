/**
 * IndexedDB `geulbang` 판 1(PLAN §5.4). 저장소 다섯 개를 처음부터 모두 만들어 판 올리기를 줄인다.
 * 트랜잭션은 짧게: 그 일에 필요한 저장소만, 안에서 IndexedDB 밖의 작업을 기다리지 않는다
 * (Safari가 오래 걸리는 트랜잭션을 닫는 문제).
 */
export const DB_NAME = 'geulbang';
export const DB_VERSION = 1;

export const STORES = {
  docUpdates: 'doc_updates',
  docState: 'doc_state',
  outbox: 'outbox',
  aiResults: 'ai_results',
  kv: 'kv',
} as const;

export function openLocalDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.docUpdates))
        db.createObjectStore(STORES.docUpdates, { keyPath: ['docId', 'seq'] });
      if (!db.objectStoreNames.contains(STORES.docState))
        db.createObjectStore(STORES.docState, { keyPath: 'docId' });
      if (!db.objectStoreNames.contains(STORES.outbox))
        db.createObjectStore(STORES.outbox, { keyPath: 'commandId' });
      if (!db.objectStoreNames.contains(STORES.aiResults))
        db.createObjectStore(STORES.aiResults, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORES.kv)) db.createObjectStore(STORES.kv);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** 한 글의 업데이트 전체 범위(복합 키 [docId, seq]) */
export function docRange(docId: string, upTo?: number): IDBKeyRange {
  return IDBKeyRange.bound([docId, -Infinity], [docId, upTo ?? Infinity]);
}
