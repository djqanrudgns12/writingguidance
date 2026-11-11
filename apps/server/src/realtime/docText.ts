import { countChars, DOC_KEYS } from '@geulbang/core';
import { docDocumentName } from '@geulbang/core/protocol';
import type { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import type { Repos } from '../store/repos/index.ts';
import type { RealtimeContext } from './context.ts';
import type { SnapshotText } from './snapshots.ts';

/**
 * 서버가 직접 글 내용을 읽을 때(PLAN §4.5): 메모리에 열린 문서가 있으면 그것(가장 새 글), 없으면 SQLite 캐시.
 * AI 스냅샷·복원 스냅샷·내려받기가 쓴다.
 */
export interface DocTextDeps {
  readonly hocuspocus: () => Hocuspocus<RealtimeContext>;
  readonly repos: Repos;
}

export function currentText(deps: DocTextDeps, docId: string): SnapshotText {
  const live = deps.hocuspocus().documents.get(docDocumentName(docId));
  if (live) {
    const bodyText = live.getText(DOC_KEYS.body).toString();
    return { titleText: live.getText(DOC_KEYS.title).toString(), bodyText, charCount: countChars(bodyText) };
  }
  const cached = deps.repos.documents.cachedText(docId);
  const bodyText = cached?.plainText ?? '';
  return { titleText: cached?.titleText ?? '', bodyText, charCount: countChars(bodyText) };
}

/** 글의 `meta`(하위 종류·직접 쓴 용도 등, PLAN §4.2). 원본은 Yjs라 메모리 문서나 저장된 상태에서 읽는다. */
export function docMeta(deps: DocTextDeps, docId: string): ReadonlyMap<string, unknown> {
  const live = deps.hocuspocus().documents.get(docDocumentName(docId));
  if (live) return new Map(live.getMap(DOC_KEYS.meta).entries());
  const stored = deps.repos.documents.find(docId);
  if (!stored) return new Map();
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, stored.state);
    return new Map(doc.getMap(DOC_KEYS.meta).entries());
  } finally {
    doc.destroy();
  }
}

export function metaString(meta: ReadonlyMap<string, unknown>, key: string): string | undefined {
  const value = meta.get(key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
