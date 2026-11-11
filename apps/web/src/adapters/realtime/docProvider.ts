import { base64UrlToBytes } from '@geulbang/core';
import { errorCatalog, isErrorCode, type ErrorCode } from '@geulbang/core/errors';
import { decodeDocEvent, docDocumentName, encodeCredential, type Credential } from '@geulbang/core/protocol';
import { HocuspocusProvider, type HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import type { LocalStorePort } from '../../ports/localStore.ts';
import { value } from '../../ports/observable.ts';
import type { AwarenessLike, CommandError, SaveState, SyncedDoc } from '../../ports/realtime.ts';
import { computeSaveState, persistedCovers, type PersistedMark } from './saveState.ts';

/** 기기 저장소에서 불러온 상태라는 표시. 이 변경은 다시 기기 저장소에 쓰지 않는다. */
const FROM_LOCAL_STORE = Symbol('from-local-store');

/** 기기 저장소에 이만큼 쌓이면 합친다(PLAN §5.4). 저장 공간 관리용 내부 값이다. */
const COMPACT_EVERY = 50;

/** 우리 서버가 정해진 코드로 거부하지 않은 문서 닫힘·인증 실패 뒤 다시 붙이기까지 기다리는 시간 */
const REATTACH_DELAY_MS = 1000;

export interface DocProviderDeps {
  readonly socket: HocuspocusProviderWebsocket;
  readonly localStore: LocalStorePort;
  readonly credential: () => Credential;
  readonly onError?: (error: unknown) => void;
}

/**
 * 글 하나의 통신용 문서와 제공자(PLAN §6.5).
 * 1. 기기 저장소에서 먼저 불러와 통신용 문서에 넣는다(오프라인에서도 바로 쓰기).
 * 2. 통신용 문서의 모든 변경(내 것·남의 것)을 기기 저장소에 쌓는다.
 * 3. 같은 소켓에 제공자를 붙인다(`attach()` 꼭 부름, PLAN §4.7).
 * 4. 글 채널 이벤트로 저장 상태·잠금·거부를 계산한다. 잠금이 풀리면 `forceSync()`.
 * 5. 서버가 이 글 연결만 닫으면(소켓은 살아 있음) 떼었다 다시 붙인다(대응 4). 정해진 오류 코드로
 *    거부되면(E_AUTH·E_FORBIDDEN 등) 다시 붙이지 않고 `failure`로 알린다.
 * 6. 기기 저장소 쓰기가 실패하면 그 업데이트를 메모리에 남겨 다음 쓰기 때 합쳐 먼저 쓰고, `storageFailed`로 알린다.
 *    남은 실패가 있으면 `flushLocal()`이 `E_STORAGE_BLOCKED`로 거부한다(제출이 기기에 없는 글로 넘어가지 않게, 검토 4번).
 * 7. `waitSynced()`는 글을 닫거나 영구 거절(`failure`·`rejected`)되면 거부한다(대기열이 멈추지 않게, 검토 7번).
 */
export async function openDocProvider(docId: string, deps: DocProviderDeps): Promise<SyncedDoc> {
  const { socket, localStore } = deps;
  const report = deps.onError ?? (() => {});
  const netDoc = new Y.Doc();

  const saved = await localStore.loadDoc(docId);
  if (saved) Y.applyUpdate(netDoc, saved, FROM_LOCAL_STORE);

  // 기기 저장소 쓰기를 차례로 잇는다(제출 전에 끝나기를 기다릴 수 있게). 각 쓰기는 거부하지 않는다(실패는 아래에 남김).
  let writes: Promise<void> = Promise.resolve();
  let sinceCompact = 0;
  /** 기기 저장소에 아직 못 쓴 업데이트(하나로 합쳐 둔다). Yjs 다음 증분은 앞 것을 다시 담지 않으므로 버리면 안 된다. */
  let unwritten: Uint8Array | null = null;
  const storageFailed = value(false);

  const writeOne = async (update: Uint8Array | null): Promise<void> => {
    const batch = unwritten && update ? Y.mergeUpdates([unwritten, update]) : (update ?? unwritten);
    if (!batch) return;
    try {
      await localStore.appendUpdate(docId, batch);
    } catch (error) {
      unwritten = batch;
      storageFailed.set(true);
      report(error);
      return;
    }
    unwritten = null;
    storageFailed.set(false);
    if (++sinceCompact >= COMPACT_EVERY) {
      sinceCompact = 0;
      try {
        await localStore.compact(docId);
      } catch (error) {
        // 합치기는 실패해도 쌓인 업데이트가 그대로 남아 글이 사라지지 않는다.
        report(error);
      }
    }
  };
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === FROM_LOCAL_STORE) return;
    writes = writes.then(() => writeOne(update));
  };
  netDoc.on('update', onUpdate);

  const saveState = value<SaveState>('local');
  const locked = value(false);
  const unsentWhileLocked = value(false);
  const failure = value<ErrorCode | null>(null);
  const rejected = value<ErrorCode | null>(null);
  let persisted: PersistedMark | null = null;
  let persistFailed = false;
  let closed = false;

  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: docDocumentName(docId),
    document: netDoc,
    token: () => encodeCredential(deps.credential()),
  });

  interface SyncWaiter {
    readonly resolve: () => void;
    readonly reject: (error: CommandError) => void;
  }
  const syncWaiters = new Set<SyncWaiter>();
  // 잠긴 동안은 서버가 이 기기 편집을 받지 않으므로 더 기다릴 것이 없다(제출 판단은 서버가 한다).
  const syncedNow = () =>
    socket.status === 'connected' && provider.isSynced && (provider.unsyncedChanges === 0 || locked.get());
  /** 더 기다려도 동기화될 수 없는 이유. 없으면 null. */
  const stopReason = (): CommandError | null => {
    if (closed) return { code: 'E_OFFLINE', retryable: true };
    const code = failure.get() ?? rejected.get();
    return code ? { code, retryable: false } : null;
  };
  const settleWaiters = () => {
    if (syncWaiters.size === 0) return;
    const stop = stopReason();
    if (!stop && !syncedNow()) return;
    for (const w of syncWaiters) {
      if (stop) w.reject(stop);
      else w.resolve();
    }
    syncWaiters.clear();
  };
  const recompute = () => {
    settleWaiters();
    if (closed) return;
    const online = socket.status === 'connected' && provider.isSynced;
    const unsynced = provider.unsyncedChanges;
    // 스냅숏 계산은 글 전체를 훑으므로 "저장됨"을 가를 때만 한다.
    const needCoverage = online && unsynced === 0 && !persistFailed && !locked.get();
    saveState.set(
      computeSaveState({
        online,
        unsynced,
        persistedCoversLocal: needCoverage && persistedCovers(persisted, Y.snapshot(netDoc)),
        persistFailed,
        locked: locked.get(),
      }),
    );
    unsentWhileLocked.set(locked.get() && unsynced > 0);
  };

  let reattachTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * 소켓은 살아 있는데 서버가 이 글 연결만 닫았을 때 다시 인증한다(PLAN §4.7 대응 4).
   * `provider.detach()`는 서버에 닫기 메시지를 먼저 보내는데, 서버는 이미 이 글을 잊었으므로 그 메시지가
   * 새로 붙은 연결을 다시 닫아 버린다(4.8.0 소스·시험 확인). 그래서 떼지 않고 소켓에 다시 붙여 인증만 새로 보낸다.
   */
  const reattachSoon = () => {
    if (closed || reattachTimer) return;
    reattachTimer = setTimeout(() => {
      reattachTimer = undefined;
      if (closed || failure.get() || socket.status !== 'connected') return;
      socket.attach(provider);
    }, REATTACH_DELAY_MS);
  };

  provider.on('stateless', ({ payload }: { payload: string }) => {
    const event = decodeDocEvent(payload);
    if (!event) return;
    switch (event.name) {
      case 'doc.persisted': {
        persisted = decodePersisted(event.data) ?? persisted;
        persistFailed = false;
        break;
      }
      case 'doc.persistFailed':
        persistFailed = true;
        break;
      case 'doc.status': {
        const wasLocked = locked.get();
        locked.set(event.data.locked);
        if (wasLocked && !event.data.locked) provider.forceSync();
        break;
      }
      case 'doc.error':
        rejected.set(event.data.code);
        break;
    }
    recompute();
  });
  provider.on('synced', recompute);
  provider.on('unsyncedChanges', recompute);
  provider.on('status', recompute);
  provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
    if (isErrorCode(reason)) {
      failure.set(reason);
      provider.detach();
    } else {
      reattachSoon();
    }
    recompute();
  });
  // 소켓은 살아 있는데 이 글 연결만 닫혔으면 다시 붙인다. 소켓이 끊긴 것이면 소켓이 다시 연결하며 붙인다.
  provider.on('close', () => {
    if (socket.status === 'connected') reattachSoon();
    recompute();
  });
  netDoc.on('update', recompute);

  provider.attach();
  recompute();

  return {
    docId,
    netDoc,
    awareness: (provider.awareness as AwarenessLike | null) ?? null,
    saveState,
    locked,
    unsentWhileLocked,
    failure,
    rejected,
    storageFailed,
    flushLocal: async () => {
      await writes;
      // 앞에서 실패한 것이 남았으면 한 번 더 써 본다(그 사이 저장소가 회복됐을 수 있다).
      if (unwritten) {
        writes = writes.then(() => writeOne(null));
        await writes;
      }
      if (unwritten) throw storageError();
    },
    waitSynced: () => {
      const stop = stopReason();
      if (stop) return Promise.reject(stop);
      if (syncedNow()) return Promise.resolve();
      return new Promise<void>((resolve, reject) => void syncWaiters.add({ resolve, reject }));
    },
    close() {
      closed = true;
      if (reattachTimer) clearTimeout(reattachTimer);
      netDoc.off('update', onUpdate);
      settleWaiters();
      provider.destroy();
    },
  };
}

const storageError = (): CommandError => ({
  code: 'E_STORAGE_BLOCKED',
  retryable: errorCatalog.E_STORAGE_BLOCKED.retryable,
});

/** `doc.persisted` → 저장 표시. 스냅숏이 있으면 그것(지우기 포함), 없으면 상태 벡터(판 N-1 서버). 깨졌으면 null. */
function decodePersisted(data: { readonly stateVector: string; readonly snapshot?: string | undefined }) {
  const snapshotBytes = data.snapshot !== undefined ? base64UrlToBytes(data.snapshot) : null;
  if (snapshotBytes) {
    try {
      return { kind: 'snapshot', snapshot: Y.decodeSnapshot(snapshotBytes) } satisfies PersistedMark;
    } catch {
      // 깨진 스냅숏은 상태 벡터로 내려간다.
    }
  }
  const vectorBytes = base64UrlToBytes(data.stateVector);
  if (!vectorBytes) return null;
  try {
    return { kind: 'vector', vector: Y.decodeStateVector(vectorBytes) } satisfies PersistedMark;
  } catch {
    return null;
  }
}
