import type { ResumeStatus } from '@geulbang/core';
import type { ResumePending } from '@geulbang/core/protocol';
import type { Db } from '../db.ts';

/**
 * 다른 기기 이어 쓰기 요청(PLAN §2.3 ④, §5.2 `resume_requests`, PRD F-14).
 * 새 기기가 만든 토큰의 해시만 둔다. 허용되면 그 해시가 `devices`로 옮겨 간다(서버가 토큰을 건네지 않는다).
 * 결정은 `WHERE status = 'PENDING'`을 먼저 통과한 하나만 남는다(취소·허용·거절이 겹쳐도).
 */
export interface StoredResumeRequest {
  readonly id: string;
  readonly roomId: string;
  readonly participantId: string;
  readonly deviceId: string;
  readonly deviceTokenHash: string;
  readonly status: ResumeStatus;
  readonly createdAt: number;
}

export interface NewResumeRequest {
  readonly id: string;
  readonly roomId: string;
  readonly participantId: string;
  readonly deviceId: string;
  readonly deviceTokenHash: string;
  readonly createdAt: number;
}

export interface ResumeRequestRepo {
  insert(r: NewResumeRequest): void;
  findById(id: string): StoredResumeRequest | undefined;
  findPending(participantId: string, deviceId: string): StoredResumeRequest | undefined;
  listPending(roomId: string): ResumePending[];
  listPendingIds(roomId: string): string[];
  /** PENDING일 때만 바꾼다. 바뀐 행 수 */
  decide(id: string, roomId: string, status: Exclude<ResumeStatus, 'PENDING'>, at: number): number;
}

interface Row {
  id: string;
  room_id: string;
  participant_id: string;
  device_id: string;
  device_token_hash: string;
  status: ResumeStatus;
  created_at: number;
}

const COLUMNS = 'id, room_id, participant_id, device_id, device_token_hash, status, created_at';

function toRequest(row: Row): StoredResumeRequest {
  return {
    id: row.id,
    roomId: row.room_id,
    participantId: row.participant_id,
    deviceId: row.device_id,
    deviceTokenHash: row.device_token_hash,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function createResumeRequestRepo(db: Db): ResumeRequestRepo {
  const insertStmt = db.prepare(
    `INSERT INTO resume_requests (id, room_id, participant_id, device_id, device_token_hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
  );
  const byId = db.prepare<[string], Row>(`SELECT ${COLUMNS} FROM resume_requests WHERE id = ?`);
  const pendingStmt = db.prepare<[string, string], Row>(
    `SELECT ${COLUMNS} FROM resume_requests WHERE participant_id = ? AND device_id = ? AND status = 'PENDING'`,
  );
  const listStmt = db.prepare<
    [string],
    { id: string; participant_id: string; nickname: string; created_at: number }
  >(
    `SELECT r.id, r.participant_id, p.nickname, r.created_at
       FROM resume_requests r JOIN participants p ON p.id = r.participant_id
      WHERE r.room_id = ? AND r.status = 'PENDING'
      ORDER BY r.created_at, r.id`,
  );
  const decideStmt = db.prepare(
    "UPDATE resume_requests SET status = ?, decided_at = ? WHERE id = ? AND room_id = ? AND status = 'PENDING'",
  );

  return {
    insert(r) {
      insertStmt.run(r.id, r.roomId, r.participantId, r.deviceId, r.deviceTokenHash, r.createdAt);
    },
    findById(id) {
      const row = byId.get(id);
      return row ? toRequest(row) : undefined;
    },
    findPending(participantId, deviceId) {
      const row = pendingStmt.get(participantId, deviceId);
      return row ? toRequest(row) : undefined;
    },
    listPending: roomId =>
      listStmt.all(roomId).map(r => ({
        requestId: r.id,
        participantId: r.participant_id,
        nickname: r.nickname,
        requestedAt: r.created_at,
      })),
    listPendingIds: roomId => listStmt.all(roomId).map(r => r.id),
    decide: (id, roomId, status, at) => decideStmt.run(status, at, id, roomId).changes,
  };
}
