import { bytesToBase64Url, countChars, DOC_KEYS } from '@geulbang/core';
import { parseDocumentName, type DocEventData } from '@geulbang/core/protocol';
import { AppError } from '@geulbang/core/errors';
import type {
  afterUnloadDocumentPayload,
  beforeUnloadDocumentPayload,
  connectedPayload,
  Document,
  Hocuspocus,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from '@hocuspocus/server';
import * as Y from 'yjs';
import type { LastInputBy, SnapshotAuthor } from '@geulbang/core';
import type { Logger } from '../log.ts';
import type { DocumentRepo } from '../store/repos/documents.ts';
import type { RealtimeContext } from './context.ts';
import { broadcastDocEvent, sendDocEvent } from './docChannel.ts';
import type { SnapshotText } from './snapshots.ts';
import { knownSubtype } from './docMeta.ts';

/**
 * 글 저장(PLAN §4.5, §4.7 대응 2).
 * - 불러오기: SQLite의 `ydoc_state`. `room:*`은 내용이 없어 저장하지 않는다.
 * - 저장: 한 트랜잭션으로 상태와 캐시를 쓰고, 성공하면 `doc.persisted {stateVector, snapshot}`을 그 글의 연결에 보낸다.
 *   새로 붙은 연결에도 DB의 마지막 표시를 한 번 보낸다(`connected`).
 *   Hocuspocus는 저장 실패를 다시 시도하지 않으므로 여기서 세 번 더 시도한다.
 * - 그래도 실패하면 "저장 못 함" 목록에 넣고 `doc.persistFailed`를 보낸다. 그 글은 내리지 않고(기기 사본이 있어도
 *   서버 메모리를 지킨다) `retryFailed`가 주기적으로 다시 시도한다. 목록이 비어 있지 않으면 상태 확인이 실패로 보인다.
 * - 저장할 때 메모리 요약이 아는 마지막 입력(시각·입력자)을 함께 쓰고, 저장이 끝나면 AUTO 스냅샷을 판단한다(§4.5).
 *   스냅샷은 기록일 뿐이라 실패해도 저장을 실패로 치지 않는다(기록만 남김).
 */

/** 저장 재시도 간격. 제품 동작이 아니라 잠깐의 디스크·잠금 경합을 넘기기 위한 내부 값이다(PLAN §4.7 대응 2). */
const RETRY_DELAYS_MS = [500, 1000, 2000] as const;

export interface PersistenceDeps {
  readonly repo: DocumentRepo;
  readonly log: Logger;
  readonly now: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** 메모리 요약(`roomState`)이 아는 마지막 입력 */
  readonly lastInput?: (docId: string) => { readonly at: number; readonly by: LastInputBy } | undefined;
  /** 저장이 끝난 뒤(AUTO 스냅샷 판단) */
  readonly afterSave?: (docId: string, text: SnapshotText, author: SnapshotAuthor) => void;
}

export interface Persistence {
  onLoadDocument(payload: onLoadDocumentPayload<RealtimeContext>): Promise<Uint8Array | undefined>;
  onStoreDocument(payload: onStoreDocumentPayload<RealtimeContext>): Promise<void>;
  beforeUnloadDocument(payload: beforeUnloadDocumentPayload): Promise<void>;
  /** "저장 못 함" 목록을 다시 저장해 본다. 성공하고 연결이 없으면 내린다. */
  retryFailed(hocuspocus: Hocuspocus<RealtimeContext>): Promise<void>;
  failedCount(): number;
  /** 지우는 글은 저장하지 않고 목록에서 뺀다(PLAN §7.7-4). */
  forget(documentName: string): void;
  /**
   * 새로 붙은 글 연결에 DB에 있는 마지막 상태 표시를 보낸다. 서버가 만든 첫 상태(미리 만든 메모 칸·하위 종류)만 있는
   * 새 글은 편집이 없어 저장이 돌지 않으므로, 이것이 없으면 기기는 첫 입력 전까지 `보내는 중`에 머문다.
   */
  connected(payload: connectedPayload<RealtimeContext>): void;
  afterUnloadDocument(payload: afterUnloadDocumentPayload): void;
}

type PersistedMark = DocEventData<'doc.persisted'>;

/** 상태 벡터와 스냅숏(삭제 집합 포함)을 같은 순간에 뜬다(검토 5번). */
function markOf(doc: Y.Doc): PersistedMark {
  return {
    stateVector: bytesToBase64Url(Y.encodeStateVector(doc)),
    snapshot: bytesToBase64Url(Y.encodeSnapshot(Y.snapshot(doc))),
  };
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function createPersistence(deps: PersistenceDeps): Persistence {
  const { repo, log, now } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const failed = new Set<string>();
  const forgotten = new Set<string>();
  /** 문서 이름 → DB에 들어 있는 마지막 상태 표시 */
  const marks = new Map<string, PersistedMark>();

  const docIdOf = (name: string): string | null => {
    const ref = parseDocumentName(name);
    return ref?.kind === 'doc' ? ref.id : null;
  };

  /** 한 번 저장. 상태·벡터를 같은 순간에 떠서 쓰기 때문에 알림의 상태 벡터는 DB 내용과 정확히 같다. */
  const storeOnce = (document: Document, docId: string): boolean => {
    const state = Y.encodeStateAsUpdate(document);
    // 상태 벡터만으로는 지우기를 판정할 수 없어 삭제 집합까지 담은 스냅숏도 같은 순간에 뜬다(검토 5번).
    const mark = markOf(document);
    const body = document.getText(DOC_KEYS.body).toString();
    const title = document.getText(DOC_KEYS.title).toString();
    const subtype = document.getMap(DOC_KEYS.meta).get('subtype');
    const charCount = countChars(body);
    const input = deps.lastInput?.(docId);
    const written = repo.saveContent(docId, {
      state,
      titleText: title,
      plainText: body,
      charCount,
      subtype: knownSubtype(undefined, subtype),
      updatedAt: now(),
      lastInputAt: input?.at ?? null,
      lastInputBy: input?.by ?? null,
    });
    if (!written) {
      // 행이 없다 = 수업방이 지워졌다. 다시 만들지 않고, 실패로도 세지 않는다.
      log.info('store_skipped_missing', { detail: 'document row is gone' });
      return true;
    }
    marks.set(document.name, mark);
    broadcastDocEvent(document, 'doc.persisted', mark, now());
    if (deps.afterSave) {
      try {
        deps.afterSave(docId, { titleText: title, bodyText: body, charCount }, input?.by ?? 'SYSTEM');
      } catch (error) {
        log.error('snapshot_failed', { error });
      }
    }
    return true;
  };

  const storeWithRetry = async (document: Document, docId: string, name: string): Promise<boolean> => {
    for (let attempt = 0; ; attempt++) {
      try {
        if (forgotten.has(name)) return true;
        storeOnce(document, docId);
        failed.delete(name);
        return true;
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          log.error('store_failed', { error, count: attempt + 1 });
          return false;
        }
        log.warn('store_retry', { error, count: attempt + 1 });
        await sleep(delay);
      }
    }
  };

  return {
    async onLoadDocument({ documentName }) {
      const docId = docIdOf(documentName);
      if (!docId) return undefined;
      const row = repo.find(docId);
      if (!row) throw new AppError('E_FORBIDDEN', 'document not found');
      forgotten.delete(documentName);
      const loaded = new Y.Doc();
      try {
        Y.applyUpdate(loaded, row.state);
        marks.set(documentName, markOf(loaded));
      } finally {
        loaded.destroy();
      }
      return row.state;
    },

    connected({ connection, documentName }) {
      const mark = marks.get(documentName);
      if (mark) sendDocEvent(connection, 'doc.persisted', mark, now());
    },

    afterUnloadDocument({ documentName }) {
      marks.delete(documentName);
    },

    async onStoreDocument({ document, documentName }) {
      const docId = docIdOf(documentName);
      if (!docId || forgotten.has(documentName)) return;
      const ok = await storeWithRetry(document, docId, documentName);
      if (!ok) {
        failed.add(documentName);
        broadcastDocEvent(document, 'doc.persistFailed', {}, now());
      }
    },

    async beforeUnloadDocument({ documentName }) {
      if (failed.has(documentName)) {
        throw new Error('저장하지 못한 글은 메모리에서 내리지 않는다');
      }
    },

    async retryFailed(hocuspocus) {
      for (const name of [...failed]) {
        const document = hocuspocus.documents.get(name);
        const docId = docIdOf(name);
        if (!document || !docId) {
          failed.delete(name);
          continue;
        }
        try {
          storeOnce(document, docId);
          failed.delete(name);
          log.info('store_recovered');
          if (document.getConnectionsCount() === 0) await hocuspocus.unloadDocument(document);
        } catch (error) {
          log.error('store_failed', { error });
        }
      }
    },

    failedCount: () => failed.size,

    forget(documentName) {
      forgotten.add(documentName);
      failed.delete(documentName);
    },
  };
}
