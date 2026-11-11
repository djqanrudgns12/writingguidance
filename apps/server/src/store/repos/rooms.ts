import { AI_BUTTONS, type RoomDbStatus, type RoomStatus } from '@geulbang/core';
import { z } from 'zod';
import type { Db } from '../db.ts';

/**
 * 수업방 행(PLAN §5.2 `rooms`). PIN은 HMAC·암호문만 있고 원문은 없다.
 * 만료·삭제는 저장하지 않는 상태라 `statusAt`이 시각으로 계산한다(만료 행은 정리 작업이 지운다, PLAN §5.3).
 */

/** 수업방마다 바뀌는 값(PLAN §13.1). 없는 칸은 기본값으로 읽어 옛 행·개발 행도 받는다. */
const settingsSchema = z.object({
  genres: z.array(z.string()).default([]),
  aiButtons: z.array(z.enum(AI_BUTTONS)).default([]),
  // 알림 소리는 기본 끔(PRD F-19)
  sound: z.boolean().default(false),
  // v1은 `보통` 고정(PRD F-10), 설정 화면은 v1.1
  undoLevel: z.enum(['fine', 'normal', 'coarse']).default('normal'),
  diagnostics: z.boolean().default(false),
});
export type StoredRoomSettings = z.output<typeof settingsSchema>;

export interface StoredRoom {
  readonly id: string;
  readonly entryCode: string;
  readonly className: string;
  readonly title: string;
  readonly schoolName: string | null;
  readonly showSchool: boolean;
  readonly settings: StoredRoomSettings;
  readonly retentionDays: number;
  readonly status: RoomDbStatus;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly closedAt: number | null;
}

export interface NewRoom {
  readonly id: string;
  readonly entryCode: string;
  readonly pinHmac: string;
  readonly pinEnc: string;
  readonly className: string;
  readonly title: string;
  readonly schoolName: string | null;
  readonly showSchool: boolean;
  readonly settings: StoredRoomSettings;
  readonly retentionDays: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface RoomRepo {
  /** 유일 제약(`entry_code`·`pin_hmac`)을 어기면 SQLite 오류를 그대로 던진다(부르는 쪽이 `isUniqueViolation`으로 가른다). */
  insert(room: NewRoom): void;
  findById(id: string): StoredRoom | undefined;
  findByEntryCode(entryCode: string): StoredRoom | undefined;
  /**
   * 그 PIN의 행(만료 여부와 상관없이). 새 방 만들기가 만료 행이 PIN을 붙잡고 있는지 볼 때 쓴다(PLAN §2.3 ①-3).
   * 지우기는 여기에 두지 않는다: 만료 방도 공통 삭제(`application/deleteRoom.ts`)로만 지운다(P5-5b 검토 B01).
   */
  findByPinHmac(pinHmac: string): StoredRoom | undefined;
  /** 살아 있는(만료 전) 방만. PIN 입장(PRD F-20) */
  findActiveByPinHmac(pinHmac: string, now: number): StoredRoom | undefined;
  /** `보기`(F-16)용 PIN 암호문 */
  pinEncOf(id: string): string | undefined;
  updateSettings(id: string, settings: StoredRoomSettings): void;
  /** 닫기·다시 열기. 닫을 때만 `closed_at`을 찍는다. */
  setStatus(id: string, status: RoomDbStatus, at: number): void;
  listExpiredIds(now: number): string[];
  /** 외래키 ON DELETE CASCADE로 그 방의 모든 행이 함께 사라진다(PRD F-24). */
  delete(id: string): number;
}

interface Row {
  id: string;
  entry_code: string;
  class_name: string;
  title: string;
  school_name: string | null;
  show_school: number;
  settings_json: string;
  retention_days: number;
  status: RoomDbStatus;
  created_at: number;
  expires_at: number;
  closed_at: number | null;
}

const COLUMNS = `id, entry_code, class_name, title, school_name, show_school, settings_json, retention_days,
                 status, created_at, expires_at, closed_at`;

/** 화면·이벤트에 보이는 상태. 만료 시각이 지났으면 행이 남아 있어도 `EXPIRED`다. */
export function roomStatusAt(room: Pick<StoredRoom, 'status' | 'expiresAt'>, now: number): RoomStatus {
  return room.expiresAt <= now ? 'EXPIRED' : room.status;
}

export function parseRoomSettings(json: string): StoredRoomSettings {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('rooms.settings_json이 JSON이 아님');
  }
  const parsed = settingsSchema.safeParse(value);
  if (!parsed.success) throw new Error('rooms.settings_json 모양이 틀림');
  return parsed.data;
}

function toRoom(row: Row): StoredRoom {
  return {
    id: row.id,
    entryCode: row.entry_code,
    className: row.class_name,
    title: row.title,
    schoolName: row.school_name,
    showSchool: row.show_school === 1,
    settings: parseRoomSettings(row.settings_json),
    retentionDays: row.retention_days,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    closedAt: row.closed_at,
  };
}

export function createRoomRepo(db: Db): RoomRepo {
  const insertStmt = db.prepare(
    `INSERT INTO rooms (id, entry_code, pin_hmac, pin_enc, class_name, title, school_name, show_school,
                        settings_json, retention_days, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
  );
  const byId = db.prepare<[string], Row>(`SELECT ${COLUMNS} FROM rooms WHERE id = ?`);
  const byCode = db.prepare<[string], Row>(`SELECT ${COLUMNS} FROM rooms WHERE entry_code = ?`);
  const byPinAny = db.prepare<[string], Row>(`SELECT ${COLUMNS} FROM rooms WHERE pin_hmac = ?`);
  const byPin = db.prepare<[string, number], Row>(
    `SELECT ${COLUMNS} FROM rooms WHERE pin_hmac = ? AND expires_at > ?`,
  );
  const pinEncStmt = db.prepare<[string], { pin_enc: string }>('SELECT pin_enc FROM rooms WHERE id = ?');
  const settingsStmt = db.prepare('UPDATE rooms SET settings_json = ? WHERE id = ?');
  const statusStmt = db.prepare(
    "UPDATE rooms SET status = ?, closed_at = CASE WHEN ? = 'CLOSED' THEN ? ELSE NULL END WHERE id = ?",
  );
  const expiredStmt = db.prepare<[number], { id: string }>('SELECT id FROM rooms WHERE expires_at <= ?');
  const deleteStmt = db.prepare('DELETE FROM rooms WHERE id = ?');

  return {
    insert(r) {
      insertStmt.run(
        r.id,
        r.entryCode,
        r.pinHmac,
        r.pinEnc,
        r.className,
        r.title,
        r.schoolName,
        r.showSchool ? 1 : 0,
        JSON.stringify(r.settings),
        r.retentionDays,
        r.createdAt,
        r.expiresAt,
      );
    },
    findById(id) {
      const row = byId.get(id);
      return row ? toRoom(row) : undefined;
    },
    findByEntryCode(code) {
      const row = byCode.get(code);
      return row ? toRoom(row) : undefined;
    },
    findByPinHmac(pinHmac) {
      const row = byPinAny.get(pinHmac);
      return row ? toRoom(row) : undefined;
    },
    findActiveByPinHmac(pinHmac, now) {
      const row = byPin.get(pinHmac, now);
      return row ? toRoom(row) : undefined;
    },
    pinEncOf: id => pinEncStmt.get(id)?.pin_enc,
    updateSettings(id, settings) {
      settingsStmt.run(JSON.stringify(settings), id);
    },
    setStatus(id, status, at) {
      statusStmt.run(status, status, at, id);
    },
    listExpiredIds: now => expiredStmt.all(now).map(r => r.id),
    delete: id => deleteStmt.run(id).changes,
  };
}
