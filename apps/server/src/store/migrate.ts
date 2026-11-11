import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';

const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface MigrationFile {
  readonly version: string;
  readonly file: string;
  readonly sha256: string;
  readonly sql: string;
}

export interface MigrationReport {
  /** 이번에 적용한 판 */
  readonly applied: readonly string[];
  /** DB에 적용된 가장 높은 판 */
  readonly current: string | null;
  /** DB에는 있는데 이 릴리스에는 없는 판(더 새 릴리스가 적용함). 되돌리기 뒤의 정상 상태다(PLAN §15.4). */
  readonly ahead: readonly string[];
}

/** 폴더의 `NNNN_이름.sql` 파일을 판 순서로 읽는다. 이름 규칙을 어긴 .sql 파일이 있으면 실패. */
export function readMigrations(dir: string): MigrationFile[] {
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  const seen = new Set<string>();
  return files.map(file => {
    const match = FILE_PATTERN.exec(file);
    if (!match?.[1]) throw new Error(`마이그레이션 파일 이름이 규칙과 다름: ${file}`);
    const version = match[1];
    if (seen.has(version)) throw new Error(`같은 판의 마이그레이션이 둘: ${version}`);
    seen.add(version);
    const sql = readFileSync(join(dir, file), 'utf8');
    return { version, file, sql, sha256: createHash('sha256').update(sql).digest('hex') };
  });
}

function ensureLedger(db: Db): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
}

function readLedger(db: Db): Map<string, string> {
  const rows = db.prepare('SELECT version, sha256 FROM schema_migrations ORDER BY version').all() as Array<{
    version: string;
    sha256: string;
  }>;
  return new Map(rows.map(r => [r.version, r.sha256]));
}

/** 아직 적용하지 않은 판. 적용된 파일이 바뀌었으면 실패한다(적용된 파일은 고치지 않는다). */
export function pendingMigrations(db: Db, files: readonly MigrationFile[]): MigrationFile[] {
  ensureLedger(db);
  const ledger = readLedger(db);
  for (const f of files) {
    const recorded = ledger.get(f.version);
    if (recorded !== undefined && recorded !== f.sha256) {
      throw new Error(
        `이미 적용된 마이그레이션 ${f.file}의 내용이 바뀌었습니다. 새 마이그레이션으로 고치세요.`,
      );
    }
  }
  return files.filter(f => !ledger.has(f.version));
}

/** 남은 판을 파일마다 한 트랜잭션으로 적용한다(PLAN §5.1). */
export function migrate(db: Db, dir: string, now: number = Date.now()): MigrationReport {
  const files = readMigrations(dir);
  const pending = pendingMigrations(db, files);
  const record = db.prepare('INSERT INTO schema_migrations (version, sha256, applied_at) VALUES (?, ?, ?)');

  for (const f of pending) {
    db.transaction(() => {
      db.exec(f.sql);
      record.run(f.version, f.sha256, now);
    })();
  }

  const ledger = readLedger(db);
  const known = new Set(files.map(f => f.version));
  const versions = [...ledger.keys()].sort();
  return {
    applied: pending.map(f => f.version),
    current: versions.at(-1) ?? null,
    ahead: versions.filter(v => !known.has(v)),
  };
}
