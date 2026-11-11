import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { E2E_DB_PATH } from './constants.ts';

/**
 * 시험 서버 DB(`.local/e2e/e2e.sqlite`)를 시험 쪽에서 직접 보는 도구. 화면·API로 볼 수 없는 것만 쓴다:
 * - 만료 뒤 행이 정말 사라졌는지(PRD 16.6)
 * - 정책 판이 바뀐 상황 흉내(참가자의 동의 판을 옛 값으로, PRD F-03): 서버 정책 판을 실행 중에 바꿀 수 없어서.
 * 서버는 WAL·busy_timeout을 쓰므로 다른 프로세스의 짧은 읽기·쓰기와 함께 돈다.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const dbFile = resolve(repoRoot, E2E_DB_PATH);

function withDb<T>(readOnly: boolean, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbFile, { readOnly, timeout: 5000 });
  try {
    return run(db);
  } finally {
    db.close();
  }
}

/** 이 방에 남은 행 수(방·교사 세션·참가자·글·스냅샷·알림). 모두 0이면 깨끗이 사라진 것. */
export function roomRowCounts(roomId: string, entryCode: string): Record<string, number> {
  return withDb(true, db => {
    const one = (sql: string, ...args: string[]): number => {
      const row = db.prepare(sql).get(...args) as { n?: number } | undefined;
      return Number(row?.n ?? 0);
    };
    return {
      rooms: one('SELECT COUNT(*) AS n FROM rooms WHERE id = ? OR entry_code = ?', roomId, entryCode),
      teacherSessions: one('SELECT COUNT(*) AS n FROM teacher_sessions WHERE room_id = ?', roomId),
      participants: one('SELECT COUNT(*) AS n FROM participants WHERE room_id = ?', roomId),
      documents: one('SELECT COUNT(*) AS n FROM documents WHERE room_id = ?', roomId),
      snapshots: one(
        'SELECT COUNT(*) AS n FROM snapshots WHERE document_id IN (SELECT id FROM documents WHERE room_id = ?)',
        roomId,
      ),
      notices: one('SELECT COUNT(*) AS n FROM notices WHERE room_id = ?', roomId),
    };
  });
}

/** 참가자가 동의한 정책 판을 옛 값으로 되돌린다(정책 판이 올라간 상황 흉내). 바뀐 행 수를 돌려준다. */
export function setConsentVersion(roomId: string, nickname: string, version: string): number {
  return withDb(false, db => {
    const r = db
      .prepare('UPDATE participants SET consent_version = ? WHERE room_id = ? AND nickname = ?')
      .run(version, roomId, nickname);
    return Number(r.changes);
  });
}

/** 이 글의 스냅샷 수와 이유 목록(시각 순). 되감기 시험이 새 기록이 남았는지 조건으로 기다릴 때 쓴다. */
export function snapshotReasons(documentId: string): string[] {
  return withDb(true, db =>
    (
      db
        .prepare('SELECT reason FROM snapshots WHERE document_id = ? ORDER BY created_at, rowid')
        .all(documentId) as { reason?: string }[]
    ).map(r => String(r.reason ?? '')),
  );
}

/**
 * 이 글의 지금까지 스냅샷을 모두 `ms`만큼 옛날로 옮긴다(시간이 흐른 상황 흉내: "3분 전" 기록을 3분 기다리지 않고 만든다).
 * 옮긴 행 수를 돌려준다.
 */
export function backdateSnapshots(documentId: string, ms: number): number {
  return withDb(false, db => {
    const r = db
      .prepare('UPDATE snapshots SET created_at = created_at - ? WHERE document_id = ?')
      .run(ms, documentId);
    return Number(r.changes);
  });
}
