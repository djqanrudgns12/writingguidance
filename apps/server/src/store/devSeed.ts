import * as Y from 'yjs';
import type { Db } from './db.ts';

/**
 * 개발 전용 고정 행(PLAN §11.5 P2-1). `dev` 자격으로 여는 `doc:dev-*` 글이 외래키(방·참가자)를 지키도록
 * 개발용 수업방·참가자·글 행을 만든다. `DEV_DOCS_ENABLED`일 때만 불리고, 운영에서는 그 설정이 시작을 막는다.
 * 만료 시각을 끝없이 두어 만료 작업이 지우지 않는다.
 */
export const DEV_ROOM_ID = 'dev-room';
export const DEV_PARTICIPANT_ID = 'dev-student';

const NEVER = Number.MAX_SAFE_INTEGER;

export function ensureDevDocument(db: Db, docId: string, now: number): void {
  const empty = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));
  db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO rooms (id, entry_code, pin_hmac, pin_enc, class_name, title, school_name, show_school,
                                    settings_json, retention_days, status, created_at, expires_at)
       VALUES (?, 'dev', 'dev', 'dev', 'dev', 'dev', NULL, 0, '{}', 0, 'ACTIVE', ?, ?)`,
    ).run(DEV_ROOM_ID, now, NEVER);
    db.prepare(
      `INSERT OR IGNORE INTO participants (id, room_id, nickname, nickname_norm, consent_version, consent_at, created_at, last_seen_at)
       VALUES (?, ?, 'dev', 'dev', 'dev', ?, ?, ?)`,
    ).run(DEV_PARTICIPANT_ID, DEV_ROOM_ID, now, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO documents (id, room_id, participant_id, genre, ydoc_state, status, created_at, updated_at)
       VALUES (?, ?, ?, 'dev', ?, 'DRAFT', ?, ?)`,
    ).run(docId, DEV_ROOM_ID, DEV_PARTICIPANT_ID, empty, now, now);
  })();
}
