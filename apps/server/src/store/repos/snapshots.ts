import type { SnapshotAuthor, SnapshotReason } from '@geulbang/core';
import type { SnapshotItem } from '@geulbang/core/protocol';
import type { Db } from '../db.ts';

/**
 * 스냅샷(PLAN §5.2 `snapshots`, PRD F-10). 그 순간의 제목과 본문 글자만 저장한다.
 * 언제 남기고 무엇을 솎을지는 `realtime/snapshots.ts`가 정하고, 여기는 읽고 쓰기만 한다.
 */
export interface NewSnapshot {
  readonly id: string;
  readonly documentId: string;
  readonly createdAt: number;
  readonly reason: SnapshotReason;
  readonly author: SnapshotAuthor;
  readonly titleText: string;
  readonly bodyText: string;
  readonly charCount: number;
}

export interface SnapshotText {
  readonly titleText: string;
  readonly bodyText: string;
  readonly createdAt: number;
}

export interface SnapshotMark {
  readonly id: string;
  readonly createdAt: number;
  readonly reason: SnapshotReason;
}

export interface SnapshotRepo {
  insert(s: NewSnapshot): void;
  /** 가장 최근 스냅샷(이유 무관). 없으면 undefined. */
  latest(documentId: string): SnapshotText | undefined;
  /** 가장 최근 AUTO 스냅샷 시각. 없으면 null. */
  lastAutoAt(documentId: string): number | null;
  count(documentId: string): number;
  /** 솎기 판단용: 시각 순 목록(본문 없이). */
  timeline(documentId: string): SnapshotMark[];
  /** AUTO만 지운다. 다른 이유의 스냅샷은 이 경로로 지워지지 않는다(PRD F-10). */
  deleteAuto(ids: readonly string[]): number;
  /** 시간 되감기 목록(`snapshot.list`), 시각 순 */
  listItems(documentId: string): SnapshotItem[];
  /** 그 글의 스냅샷 하나(다른 글의 ID면 undefined) */
  getText(documentId: string, snapshotId: string): SnapshotText | undefined;
}

export function createSnapshotRepo(db: Db): SnapshotRepo {
  const insertStmt = db.prepare(
    `INSERT INTO snapshots (id, document_id, created_at, reason, author, title_text, body_text, char_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const latestStmt = db.prepare<[string], { title_text: string; body_text: string; created_at: number }>(
    `SELECT title_text, body_text, created_at FROM snapshots WHERE document_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  );
  const lastAutoStmt = db.prepare<[string], { at: number | null }>(
    "SELECT MAX(created_at) AS at FROM snapshots WHERE document_id = ? AND reason = 'AUTO'",
  );
  const countStmt = db.prepare<[string], { n: number }>(
    'SELECT COUNT(*) AS n FROM snapshots WHERE document_id = ?',
  );
  const timelineStmt = db.prepare<[string], { id: string; created_at: number; reason: SnapshotReason }>(
    'SELECT id, created_at, reason FROM snapshots WHERE document_id = ? ORDER BY created_at, rowid',
  );
  const deleteStmt = db.prepare("DELETE FROM snapshots WHERE id = ? AND reason = 'AUTO'");
  const itemsStmt = db.prepare<
    [string],
    { id: string; created_at: number; reason: SnapshotReason; author: SnapshotAuthor; char_count: number }
  >(
    `SELECT id, created_at, reason, author, char_count FROM snapshots WHERE document_id = ?
      ORDER BY created_at, rowid`,
  );
  const getStmt = db.prepare<[string, string], { title_text: string; body_text: string; created_at: number }>(
    'SELECT title_text, body_text, created_at FROM snapshots WHERE document_id = ? AND id = ?',
  );

  return {
    insert(s) {
      insertStmt.run(
        s.id,
        s.documentId,
        s.createdAt,
        s.reason,
        s.author,
        s.titleText,
        s.bodyText,
        s.charCount,
      );
    },
    latest(documentId) {
      const row = latestStmt.get(documentId);
      return row
        ? { titleText: row.title_text, bodyText: row.body_text, createdAt: row.created_at }
        : undefined;
    },
    lastAutoAt: documentId => lastAutoStmt.get(documentId)?.at ?? null,
    count: documentId => countStmt.get(documentId)?.n ?? 0,
    timeline: documentId =>
      timelineStmt.all(documentId).map(r => ({ id: r.id, createdAt: r.created_at, reason: r.reason })),
    listItems: documentId =>
      itemsStmt.all(documentId).map(r => ({
        id: r.id,
        at: r.created_at,
        reason: r.reason,
        author: r.author,
        chars: r.char_count,
      })),
    getText(documentId, snapshotId) {
      const row = getStmt.get(documentId, snapshotId);
      return row
        ? { titleText: row.title_text, bodyText: row.body_text, createdAt: row.created_at }
        : undefined;
    },
    deleteAuto(ids) {
      let n = 0;
      for (const id of ids) n += deleteStmt.run(id).changes;
      return n;
    },
  };
}
