import type { AiButton } from '@geulbang/core';
import type { Db } from '../db.ts';

/**
 * AI 사용 기록(PLAN §5.2 `ai_usage`·`ai_daily`, §8.2). 한도는 **예약으로 센다**: 호출 전에 RESERVED 행을 넣고,
 * 끝나면 OK·FAILED로, 우리 쪽 잘못(제공사 오류·시간 초과·중단)은 REFUNDED로 되돌려 한도에서 뺀다.
 * 본문·응답·별명은 남기지 않는다(PRD 6.6). 메타데이터만.
 */
export type AiUsageStatus = 'RESERVED' | 'OK' | 'FAILED' | 'REFUNDED';
export type AiDailyScope = 'GLOBAL' | 'PERSONAL';

export interface StoredAiUsage {
  readonly id: string;
  readonly commandId: string;
  readonly roomId: string | null;
  readonly participantId: string;
  readonly documentId: string;
  readonly button: AiButton;
  readonly status: AiUsageStatus;
  readonly errorCode: string | null;
  readonly createdAt: number;
}

export interface NewAiUsage {
  readonly id: string;
  readonly commandId: string;
  readonly roomId: string | null;
  readonly participantId: string;
  readonly documentId: string;
  readonly button: AiButton;
  readonly createdAt: number;
}

export interface AiSettlement {
  readonly status: Exclude<AiUsageStatus, 'RESERVED'>;
  readonly errorCode: string | null;
  readonly model: string | null;
  readonly latencyMs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly finishedAt: number;
}

export interface AiUsageRepo {
  findByCommand(commandId: string): StoredAiUsage | undefined;
  /** 쿨다운: 그 버튼의 마지막 요청 시각(상태 무관, 되돌린 것도 요청은 요청이다) */
  lastRequestAt(participantId: string, button: AiButton): number | null;
  /** 하루 한도에 드는 행(RESERVED·OK·FAILED) 수 */
  countParticipantSince(participantId: string, since: number): number;
  countRoomSince(roomId: string, since: number): number;
  /** 전체 하루 칸을 하나 쓴다. 한도에 닿았으면 false(한 문장 upsert, PLAN §5.2) */
  reserveDaily(day: string, scope: AiDailyScope, limit: number): boolean;
  releaseDaily(day: string, scope: AiDailyScope): void;
  insertReserved(u: NewAiUsage): void;
  /** RESERVED일 때만 정산한다(두 번 정산하지 않음). 바뀐 행 수 */
  settle(id: string, s: AiSettlement): number;
  listReserved(): StoredAiUsage[];
  pruneDaily(beforeDay: string): number;
}

interface Row {
  id: string;
  command_id: string;
  room_id: string | null;
  participant_id: string;
  document_id: string;
  button: AiButton;
  status: AiUsageStatus;
  error_code: string | null;
  created_at: number;
}

const COLUMNS =
  'id, command_id, room_id, participant_id, document_id, button, status, error_code, created_at';
const COUNTED = "('RESERVED', 'OK', 'FAILED')";

function toUsage(row: Row): StoredAiUsage {
  return {
    id: row.id,
    commandId: row.command_id,
    roomId: row.room_id,
    participantId: row.participant_id,
    documentId: row.document_id,
    button: row.button,
    status: row.status,
    errorCode: row.error_code,
    createdAt: row.created_at,
  };
}

export function createAiUsageRepo(db: Db): AiUsageRepo {
  const byCommand = db.prepare<[string], Row>(`SELECT ${COLUMNS} FROM ai_usage WHERE command_id = ?`);
  const lastStmt = db.prepare<[string, string], { at: number | null }>(
    'SELECT MAX(created_at) AS at FROM ai_usage WHERE participant_id = ? AND button = ?',
  );
  const countParticipant = db.prepare<[string, number], { n: number }>(
    `SELECT COUNT(*) AS n FROM ai_usage WHERE participant_id = ? AND created_at >= ? AND status IN ${COUNTED}`,
  );
  const countRoom = db.prepare<[string, number], { n: number }>(
    `SELECT COUNT(*) AS n FROM ai_usage WHERE room_id = ? AND created_at >= ? AND status IN ${COUNTED}`,
  );
  const reserveStmt = db.prepare<[string, string, number], { count: number }>(
    `INSERT INTO ai_daily (day, scope, count) VALUES (?, ?, 1)
     ON CONFLICT (day, scope) DO UPDATE SET count = ai_daily.count + 1 WHERE ai_daily.count < ?
     RETURNING count`,
  );
  const releaseStmt = db.prepare(
    'UPDATE ai_daily SET count = count - 1 WHERE day = ? AND scope = ? AND count > 0',
  );
  const insertStmt = db.prepare(
    `INSERT INTO ai_usage (id, command_id, room_id, participant_id, document_id, button, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'RESERVED', ?)`,
  );
  const settleStmt = db.prepare(
    `UPDATE ai_usage SET status = ?, error_code = ?, model = ?, latency_ms = ?, tokens_in = ?, tokens_out = ?,
            finished_at = ?
      WHERE id = ? AND status = 'RESERVED'`,
  );
  const reservedStmt = db.prepare<[], Row>(`SELECT ${COLUMNS} FROM ai_usage WHERE status = 'RESERVED'`);
  const pruneStmt = db.prepare('DELETE FROM ai_daily WHERE day < ?');

  return {
    findByCommand(commandId) {
      const row = byCommand.get(commandId);
      return row ? toUsage(row) : undefined;
    },
    lastRequestAt: (participantId, button) => lastStmt.get(participantId, button)?.at ?? null,
    countParticipantSince: (participantId, since) => countParticipant.get(participantId, since)?.n ?? 0,
    countRoomSince: (roomId, since) => countRoom.get(roomId, since)?.n ?? 0,
    reserveDaily(day, scope, limit) {
      if (limit <= 0) return false;
      return reserveStmt.get(day, scope, limit) !== undefined;
    },
    releaseDaily(day, scope) {
      releaseStmt.run(day, scope);
    },
    insertReserved(u) {
      insertStmt.run(u.id, u.commandId, u.roomId, u.participantId, u.documentId, u.button, u.createdAt);
    },
    settle: (id, s) =>
      settleStmt.run(s.status, s.errorCode, s.model, s.latencyMs, s.tokensIn, s.tokensOut, s.finishedAt, id)
        .changes,
    listReserved: () => reservedStmt.all().map(toUsage),
    pruneDaily: beforeDay => pruneStmt.run(beforeDay).changes,
  };
}
