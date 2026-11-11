import { randomUUID } from 'node:crypto';
import {
  selectSnapshotsToPrune,
  shouldTakeAutoSnapshot,
  type SnapshotAuthor,
  type SnapshotReason,
} from '@geulbang/core';
import type { Config } from '@geulbang/core/config';
import type { Repos } from '../store/repos/index.ts';

/**
 * 스냅샷 남기기(PLAN §4.5, PRD F-10). 언제 남기고 무엇을 솎을지는 `domain/snapshotPolicy.ts`가 정한다.
 * - AUTO: 저장할 때 글이 바뀌었고(가장 최근 스냅샷과 제목·본문이 다름) 마지막 AUTO가 `SNAPSHOT_INTERVAL_SEC` 전이면.
 * - 이벤트(SUBMIT·AI·TEACHER·RESTORE): 부르는 쪽이 정한 순간에 늘 남긴다.
 * - 한 글의 스냅샷이 `SNAPSHOT_MAX`를 넘으면 AUTO만 솎는다(최근 10분은 모두, 1시간까지 1분에 1개, 그 뒤 5분에 1개).
 */
export interface SnapshotText {
  readonly titleText: string;
  readonly bodyText: string;
  readonly charCount: number;
}

export interface Snapshots {
  /** 저장 경로에서 부른다. AUTO를 남겼으면 true. */
  afterSave(docId: string, text: SnapshotText, author: SnapshotAuthor): boolean;
  record(docId: string, reason: SnapshotReason, author: SnapshotAuthor, text: SnapshotText): string;
}

export function createSnapshots(deps: {
  readonly repos: Repos;
  readonly config: Readonly<Config>;
  readonly now: () => number;
}): Snapshots {
  const { repos, config } = deps;
  const store = repos.snapshots;

  const insert = (docId: string, reason: SnapshotReason, author: SnapshotAuthor, text: SnapshotText) => {
    const id = randomUUID();
    const now = deps.now();
    repos.db.transaction(() => {
      store.insert({
        id,
        documentId: docId,
        createdAt: now,
        reason,
        author,
        titleText: text.titleText,
        bodyText: text.bodyText,
        charCount: text.charCount,
      });
      if (store.count(docId) > config.SNAPSHOT_MAX) {
        store.deleteAuto(selectSnapshotsToPrune(store.timeline(docId), now, config));
      }
    })();
    return id;
  };

  return {
    afterSave(docId, text, author) {
      const latest = store.latest(docId);
      const changed =
        (latest?.titleText ?? '') !== text.titleText || (latest?.bodyText ?? '') !== text.bodyText;
      const take = shouldTakeAutoSnapshot(
        { changed, lastAutoAtMs: store.lastAutoAt(docId), nowMs: deps.now() },
        config,
      );
      if (!take) return false;
      insert(docId, 'AUTO', author, text);
      return true;
    },
    record: insert,
  };
}
