import type { Db } from '../db.ts';

/**
 * 교사 세션(PLAN §5.2 `teacher_sessions`). 토큰은 기기가 만들고 서버는 SHA-256 hex만 가진다(PLAN §7.4).
 * - LINK: 선생님 링크 토큰. 수업방당 하나, 여러 기기가 함께 쓴다(PRD F-23).
 * - PIN: PIN으로 들어온 기기마다 하나(P4).
 */
export type TeacherSessionKind = 'LINK' | 'PIN';

export interface StoredTeacherSession {
  readonly id: string;
  readonly roomId: string;
  readonly kind: TeacherSessionKind;
  readonly deviceId: string | null;
  readonly revokedAt: number | null;
}

export interface NewTeacherSession {
  readonly id: string;
  readonly roomId: string;
  readonly tokenHash: string;
  readonly kind: TeacherSessionKind;
  readonly deviceId: string | null;
  readonly createdAt: number;
}

export interface TeacherSessionRepo {
  /** 같은 토큰 해시가 이미 있으면 SQLite 유일 제약 오류를 던진다. */
  insert(session: NewTeacherSession): void;
  findByTokenHash(tokenHash: string): StoredTeacherSession | undefined;
  touch(id: string, now: number): void;
}

interface Row {
  id: string;
  room_id: string;
  kind: TeacherSessionKind;
  device_id: string | null;
  revoked_at: number | null;
}

export function createTeacherSessionRepo(db: Db): TeacherSessionRepo {
  const insertStmt = db.prepare(
    `INSERT INTO teacher_sessions (id, room_id, token_hash, kind, device_id, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const byHash = db.prepare<[string], Row>(
    'SELECT id, room_id, kind, device_id, revoked_at FROM teacher_sessions WHERE token_hash = ?',
  );
  const touchStmt = db.prepare('UPDATE teacher_sessions SET last_seen_at = ? WHERE id = ?');

  return {
    insert(s) {
      insertStmt.run(s.id, s.roomId, s.tokenHash, s.kind, s.deviceId, s.createdAt, s.createdAt);
    },
    findByTokenHash(tokenHash) {
      const row = byHash.get(tokenHash);
      if (!row) return undefined;
      return {
        id: row.id,
        roomId: row.room_id,
        kind: row.kind,
        deviceId: row.device_id,
        revokedAt: row.revoked_at,
      };
    },
    touch(id, now) {
      touchStmt.run(now, id);
    },
  };
}
