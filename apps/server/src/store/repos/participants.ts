import type { Db } from '../db.ts';

/**
 * 참가자(PLAN §5.2 `participants`). 수업방 안에서 `nickname_norm`이 유일하다(부분 유일 색인).
 * 개인 모드(`room_id` NULL)는 v1.1이라 여기서는 수업방 참가자만 다룬다.
 */
export interface StoredParticipant {
  readonly id: string;
  readonly roomId: string | null;
  readonly nickname: string;
  readonly nicknameNorm: string;
  readonly consentVersion: string;
  readonly consentAt: number;
  readonly createdAt: number;
}

export interface NewParticipant {
  readonly id: string;
  readonly roomId: string;
  readonly nickname: string;
  readonly nicknameNorm: string;
  readonly consentVersion: string;
  readonly createdAt: number;
}

export interface ParticipantRepo {
  /** 같은 방에 같은 `nickname_norm`이 있으면 SQLite 유일 제약 오류를 던진다. */
  insert(p: NewParticipant): void;
  findById(id: string): StoredParticipant | undefined;
  findByNickname(roomId: string, nicknameNorm: string): StoredParticipant | undefined;
  countInRoom(roomId: string): number;
  listInRoom(roomId: string): StoredParticipant[];
  updateConsent(id: string, consentVersion: string, at: number): void;
  touch(id: string, now: number): void;
}

interface Row {
  id: string;
  room_id: string | null;
  nickname: string;
  nickname_norm: string;
  consent_version: string;
  consent_at: number;
  created_at: number;
}

const COLUMNS = 'id, room_id, nickname, nickname_norm, consent_version, consent_at, created_at';

function toParticipant(row: Row): StoredParticipant {
  return {
    id: row.id,
    roomId: row.room_id,
    nickname: row.nickname,
    nicknameNorm: row.nickname_norm,
    consentVersion: row.consent_version,
    consentAt: row.consent_at,
    createdAt: row.created_at,
  };
}

export function createParticipantRepo(db: Db): ParticipantRepo {
  const insertStmt = db.prepare(
    `INSERT INTO participants (id, room_id, nickname, nickname_norm, consent_version, consent_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byId = db.prepare<[string], Row>(`SELECT ${COLUMNS} FROM participants WHERE id = ?`);
  const byNick = db.prepare<[string, string], Row>(
    `SELECT ${COLUMNS} FROM participants WHERE room_id = ? AND nickname_norm = ?`,
  );
  const countStmt = db.prepare<[string], { n: number }>(
    'SELECT COUNT(*) AS n FROM participants WHERE room_id = ?',
  );
  const listStmt = db.prepare<[string], Row>(
    `SELECT ${COLUMNS} FROM participants WHERE room_id = ? ORDER BY created_at, id`,
  );
  const consentStmt = db.prepare('UPDATE participants SET consent_version = ?, consent_at = ? WHERE id = ?');
  const touchStmt = db.prepare('UPDATE participants SET last_seen_at = ? WHERE id = ?');

  return {
    insert(p) {
      insertStmt.run(
        p.id,
        p.roomId,
        p.nickname,
        p.nicknameNorm,
        p.consentVersion,
        p.createdAt,
        p.createdAt,
        p.createdAt,
      );
    },
    findById(id) {
      const row = byId.get(id);
      return row ? toParticipant(row) : undefined;
    },
    findByNickname(roomId, norm) {
      const row = byNick.get(roomId, norm);
      return row ? toParticipant(row) : undefined;
    },
    countInRoom: roomId => countStmt.get(roomId)?.n ?? 0,
    listInRoom: roomId => listStmt.all(roomId).map(toParticipant),
    updateConsent(id, version, at) {
      consentStmt.run(version, at, id);
    },
    touch(id, now) {
      touchStmt.run(now, id);
    },
  };
}
