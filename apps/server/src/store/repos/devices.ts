import type { Db } from '../db.ts';

/**
 * 학생 기기(PLAN §5.2 `devices`). 기기가 만든 토큰의 SHA-256 hex만 저장한다(PLAN §7.4).
 * 교사가 `기기 연결 끊기`를 하면 `revoked_at`이 찍히고, 그 토큰으로는 다시 연결할 수 없다(P4).
 */
export interface StoredDevice {
  readonly id: string;
  readonly participantId: string;
  readonly deviceId: string;
  readonly approvedAt: number;
  readonly lastSeenAt: number;
  readonly revokedAt: number | null;
}

export interface NewDevice {
  readonly id: string;
  readonly participantId: string;
  readonly tokenHash: string;
  readonly deviceId: string;
  readonly approvedAt: number;
}

export interface DeviceRepo {
  /** 같은 토큰 해시가 이미 있으면 SQLite 유일 제약 오류를 던진다. */
  insert(device: NewDevice): void;
  findByTokenHash(tokenHash: string): StoredDevice | undefined;
  findById(id: string): StoredDevice | undefined;
  /** 끊기지 않은 기기만, 승인 순 */
  listActiveByParticipant(participantId: string): StoredDevice[];
  /** 끊기(PRD F-14 "기기 연결 끊기"). 이미 끊겼으면 0 */
  revoke(id: string, at: number): number;
  touch(id: string, now: number): void;
}

interface Row {
  id: string;
  participant_id: string;
  device_id: string;
  approved_at: number;
  last_seen_at: number;
  revoked_at: number | null;
}

const COLUMNS = 'id, participant_id, device_id, approved_at, last_seen_at, revoked_at';

function toDevice(row: Row): StoredDevice {
  return {
    id: row.id,
    participantId: row.participant_id,
    deviceId: row.device_id,
    approvedAt: row.approved_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  };
}

export function createDeviceRepo(db: Db): DeviceRepo {
  const insertStmt = db.prepare(
    `INSERT INTO devices (id, participant_id, token_hash, device_id, approved_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const byHash = db.prepare<[string], Row>(`SELECT ${COLUMNS} FROM devices WHERE token_hash = ?`);
  const byId = db.prepare<[string], Row>(`SELECT ${COLUMNS} FROM devices WHERE id = ?`);
  const byParticipant = db.prepare<[string], Row>(
    `SELECT ${COLUMNS} FROM devices WHERE participant_id = ? AND revoked_at IS NULL ORDER BY approved_at, id`,
  );
  const revokeStmt = db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL');
  const touchStmt = db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?');

  return {
    insert(d) {
      insertStmt.run(d.id, d.participantId, d.tokenHash, d.deviceId, d.approvedAt, d.approvedAt);
    },
    findByTokenHash(tokenHash) {
      const row = byHash.get(tokenHash);
      return row ? toDevice(row) : undefined;
    },
    findById(id) {
      const row = byId.get(id);
      return row ? toDevice(row) : undefined;
    },
    listActiveByParticipant: participantId => byParticipant.all(participantId).map(toDevice),
    revoke: (id, at) => revokeStmt.run(at, id).changes,
    touch(id, now) {
      touchStmt.run(now, id);
    },
  };
}
