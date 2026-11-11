import type { DocStatus, LastInputBy } from '@geulbang/core';
import type { Db } from '../db.ts';

export interface StoredDocument {
  readonly id: string;
  readonly roomId: string | null;
  readonly participantId: string;
  readonly status: DocStatus;
  readonly generation: number;
  readonly state: Uint8Array;
}

/** 글 상태 원본(`ydoc_state`)을 뺀 행. 인증·요약·`hello`처럼 자주 읽는 곳은 큰 BLOB을 읽지 않는다. */
export interface DocumentInfo {
  readonly id: string;
  readonly roomId: string | null;
  readonly participantId: string;
  readonly genre: string;
  readonly subtype: string | null;
  readonly purpose: string | null;
  readonly status: DocStatus;
  readonly generation: number;
  readonly charCount: number;
  readonly lastInputAt: number | null;
  readonly lastInputBy: LastInputBy | null;
  readonly submittedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 저장 때 함께 쓰는 캐시(PLAN §4.5). 원본은 `state`, 나머지는 요약·내려받기·AI용 사본이다. */
export interface DocumentContent {
  readonly state: Uint8Array;
  readonly titleText: string;
  readonly plainText: string;
  readonly charCount: number;
  readonly subtype: string | null;
  readonly updatedAt: number;
  /** 메모리 요약(`roomState`)이 아는 마지막 입력. 모르면 DB 값을 그대로 둔다. */
  readonly lastInputAt?: number | null;
  readonly lastInputBy?: LastInputBy | null;
}

export interface NewDocument {
  readonly id: string;
  readonly roomId: string;
  readonly participantId: string;
  readonly genre: string;
  readonly subtype: string | null;
  readonly purpose: string | null;
  readonly state: Uint8Array;
  readonly createdAt: number;
}

/** 내려받기 한 줄(PRD F-21). 본문·제목은 저장 때 쓴 캐시다(열린 글은 부르는 쪽이 메모리 값으로 바꾼다). */
export interface ExportRow {
  readonly id: string;
  readonly nickname: string;
  readonly genre: string;
  readonly subtype: string | null;
  readonly purpose: string | null;
  readonly titleText: string;
  readonly plainText: string;
  readonly status: DocStatus;
  readonly submittedAt: number | null;
  readonly charCount: number;
}

export interface DocumentRepo {
  find(id: string): StoredDocument | undefined;
  /** 저장된 캐시(제목·본문). 행이 없으면 undefined */
  cachedText(id: string): { readonly titleText: string; readonly plainText: string } | undefined;
  /** 제출: SUBMITTED + 제출 시각. 세대는 그대로. */
  markSubmitted(id: string, at: number): void;
  /** 다시 쓰게 하기: SUBMITTED일 때만 REOPENED + 세대 +1. 바뀐 행 수 */
  markReopened(id: string, at: number): number;
  listForExport(roomId: string, submittedOnly: boolean): ExportRow[];
  findInfo(id: string): DocumentInfo | undefined;
  create(doc: NewDocument): void;
  listByParticipant(participantId: string): DocumentInfo[];
  listByRoom(roomId: string): DocumentInfo[];
  /** 행이 없으면(수업방이 지워짐) false. 지운 글을 저장으로 되살리지 않는다. */
  saveContent(id: string, content: DocumentContent): boolean;
}

interface Row {
  id: string;
  room_id: string | null;
  participant_id: string;
  status: DocStatus;
  submit_generation: number;
  ydoc_state: Buffer;
}

interface InfoRow {
  id: string;
  room_id: string | null;
  participant_id: string;
  genre: string;
  subtype: string | null;
  purpose: string | null;
  status: DocStatus;
  submit_generation: number;
  char_count: number;
  last_input_at: number | null;
  last_input_by: LastInputBy | null;
  submitted_at: number | null;
  created_at: number;
  updated_at: number;
}

const INFO_COLUMNS = `id, room_id, participant_id, genre, subtype, purpose, status, submit_generation, char_count,
                      last_input_at, last_input_by, submitted_at, created_at, updated_at`;

function toInfo(row: InfoRow): DocumentInfo {
  return {
    id: row.id,
    roomId: row.room_id,
    participantId: row.participant_id,
    genre: row.genre,
    subtype: row.subtype,
    purpose: row.purpose,
    status: row.status,
    generation: row.submit_generation,
    charCount: row.char_count,
    lastInputAt: row.last_input_at,
    lastInputBy: row.last_input_by,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDocumentRepo(db: Db): DocumentRepo {
  const findStmt = db.prepare<[string], Row>(
    'SELECT id, room_id, participant_id, status, submit_generation, ydoc_state FROM documents WHERE id = ?',
  );
  const infoStmt = db.prepare<[string], InfoRow>(`SELECT ${INFO_COLUMNS} FROM documents WHERE id = ?`);
  const byParticipant = db.prepare<[string], InfoRow>(
    `SELECT ${INFO_COLUMNS} FROM documents WHERE participant_id = ? ORDER BY created_at, id`,
  );
  const byRoom = db.prepare<[string], InfoRow>(
    `SELECT ${INFO_COLUMNS} FROM documents WHERE room_id = ? ORDER BY created_at, id`,
  );
  const createStmt = db.prepare(
    `INSERT INTO documents (id, room_id, participant_id, genre, subtype, purpose, ydoc_state, status,
                            created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
  );
  // 마지막 입력은 아는 값만 덮는다(COALESCE). 서버가 다시 켜진 뒤 첫 저장이 DB 값을 지우지 않게.
  const cachedStmt = db.prepare<[string], { title_text: string; plain_text: string }>(
    'SELECT title_text, plain_text FROM documents WHERE id = ?',
  );
  const submitStmt = db.prepare("UPDATE documents SET status = 'SUBMITTED', submitted_at = ? WHERE id = ?");
  const reopenStmt = db.prepare(
    `UPDATE documents SET status = 'REOPENED', submit_generation = submit_generation + 1, reopened_at = ?
      WHERE id = ? AND status = 'SUBMITTED'`,
  );
  const exportStmt = db.prepare<
    [string, number],
    {
      id: string;
      nickname: string;
      genre: string;
      subtype: string | null;
      purpose: string | null;
      title_text: string;
      plain_text: string;
      status: DocStatus;
      submitted_at: number | null;
      char_count: number;
    }
  >(
    `SELECT d.id, p.nickname, d.genre, d.subtype, d.purpose, d.title_text, d.plain_text, d.status, d.submitted_at,
            d.char_count
       FROM documents d JOIN participants p ON p.id = d.participant_id
      WHERE d.room_id = ? AND (? = 0 OR d.status = 'SUBMITTED')
      ORDER BY p.created_at, p.id, d.created_at, d.id`,
  );
  const saveStmt = db.prepare(
    `UPDATE documents
        SET ydoc_state = ?, title_text = ?, plain_text = ?, char_count = ?, subtype = ?, updated_at = ?,
            last_input_at = COALESCE(?, last_input_at), last_input_by = COALESCE(?, last_input_by)
      WHERE id = ?`,
  );
  return {
    find(id) {
      const row = findStmt.get(id);
      if (!row) return undefined;
      return {
        id: row.id,
        roomId: row.room_id,
        participantId: row.participant_id,
        status: row.status,
        generation: row.submit_generation,
        state: new Uint8Array(row.ydoc_state),
      };
    },
    cachedText(id) {
      const row = cachedStmt.get(id);
      return row ? { titleText: row.title_text, plainText: row.plain_text } : undefined;
    },
    markSubmitted(id, at) {
      submitStmt.run(at, id);
    },
    markReopened: (id, at) => reopenStmt.run(at, id).changes,
    listForExport: (roomId, submittedOnly) =>
      exportStmt.all(roomId, submittedOnly ? 1 : 0).map(r => ({
        id: r.id,
        nickname: r.nickname,
        genre: r.genre,
        subtype: r.subtype,
        purpose: r.purpose,
        titleText: r.title_text,
        plainText: r.plain_text,
        status: r.status,
        submittedAt: r.submitted_at,
        charCount: r.char_count,
      })),
    findInfo(id) {
      const row = infoStmt.get(id);
      return row ? toInfo(row) : undefined;
    },
    create(d) {
      createStmt.run(
        d.id,
        d.roomId,
        d.participantId,
        d.genre,
        d.subtype,
        d.purpose,
        Buffer.from(d.state),
        d.createdAt,
        d.createdAt,
      );
    },
    listByParticipant: participantId => byParticipant.all(participantId).map(toInfo),
    listByRoom: roomId => byRoom.all(roomId).map(toInfo),
    saveContent(id, c) {
      const result = saveStmt.run(
        Buffer.from(c.state),
        c.titleText,
        c.plainText,
        c.charCount,
        c.subtype,
        c.updatedAt,
        c.lastInputAt ?? null,
        c.lastInputBy ?? null,
        id,
      );
      return result.changes === 1;
    },
  };
}
