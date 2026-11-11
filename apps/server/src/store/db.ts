import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

export interface OpenOptions {
  /** 파일이 없을 때 새로 만들어도 되는가. 운영은 처음 한 번(`--init`)만 true(PLAN §15.4). */
  readonly create: boolean;
}

/**
 * SQLite 파일 하나를 열고 PRAGMA를 건다(PLAN §5.1). 걸리지 않은 PRAGMA가 있으면 바로 실패한다
 * (예: secure_delete가 꺼져 있으면 30일 삭제 약속을 못 지킨다).
 */
export function openDatabase(file: string, options: OpenOptions): Db {
  const inMemory = file === ':memory:';
  if (!inMemory) {
    if (!existsSync(file)) {
      if (!options.create) {
        throw new Error(`DB 파일이 없습니다: ${file} (처음 한 번만 --init으로 만든다)`);
      }
      mkdirSync(dirname(file), { recursive: true });
    }
  }

  const db = new Database(file, { fileMustExist: !inMemory && !options.create });
  try {
    if (!inMemory) db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('secure_delete = ON');

    const expected: Record<string, unknown> = { foreign_keys: 1, secure_delete: 1, synchronous: 1 };
    if (!inMemory) expected['journal_mode'] = 'wal';
    for (const [name, want] of Object.entries(expected)) {
      const got = db.pragma(name, { simple: true });
      if (got !== want) throw new Error(`PRAGMA ${name}가 ${String(want)}가 아님: ${String(got)}`);
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * 유일 제약 위반인가(`표.열` 하나를 집어 본다). better-sqlite3는 `code = 'SQLITE_CONSTRAINT_UNIQUE'`(또는
 * `PRIMARYKEY`)와 `UNIQUE constraint failed: rooms.pin_hmac` 같은 메시지를 준다. 어느 열이 겹쳤는지에 따라
 * 다른 오류 코드로 답해야 해서(입장 코드 충돌은 다시 뽑기, PIN 충돌은 `E_PIN_TAKEN`) 열 이름까지 본다.
 */
export function isUniqueViolation(error: unknown, column?: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (code !== 'SQLITE_CONSTRAINT_UNIQUE' && code !== 'SQLITE_CONSTRAINT_PRIMARYKEY') return false;
  return column === undefined || error.message.includes(column);
}

/** 시작할 때 파일이 상하지 않았는지 본다(PLAN §15.4). */
export function quickCheck(db: Db): void {
  const result = db.pragma('quick_check', { simple: true });
  if (result !== 'ok') throw new Error(`SQLite quick_check 실패: ${String(result)}`);
}

export interface CheckpointResult {
  readonly busy: number;
  readonly log: number;
  readonly checkpointed: number;
}

/**
 * WAL에 남은 옛 페이지까지 비운다. 만료 삭제 뒤와 끝낼 때 부른다(PLAN §5.1·§5.3).
 * `busy`가 0이 아니면 다른 읽기가 붙잡고 있어 다 비우지 못한 것이다.
 */
export function checkpoint(db: Db): CheckpointResult {
  const rows = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
    busy: number;
    log: number;
    checkpointed: number;
  }>;
  const row = rows[0] ?? { busy: 0, log: 0, checkpointed: 0 };
  return { busy: row.busy, log: row.log, checkpointed: row.checkpointed };
}
