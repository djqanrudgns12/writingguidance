import { createHash } from 'node:crypto';
import type { Config } from '@geulbang/core/config';
import { AppError } from '@geulbang/core/errors';
import type { Db } from '../db.ts';

/**
 * 명령 기록(PLAN §4.4 "명령은 commandId로 멱등", §5.2 `commands`).
 * 같은 `commandId`로 다시 오면 저장한 결과를 그대로 돌려준다(응답이 사라져도 안전).
 * 같은 `commandId`인데 실행 주체·이름·인자 해시 중 하나라도 다르면 `E_INPUT`.
 * 결과에는 비밀(토큰·PIN)을 넣지 않는다. 보관은 `COMMAND_RETENTION_DAYS`(정리 작업이 `prune`을 부른다, P4).
 */
export type CommandActorKind = 'STUDENT' | 'TEACHER' | 'ANON';

export interface CommandKey {
  readonly id: string;
  readonly actorKind: CommandActorKind;
  /** 기기 행 ID·교사 세션 ID·(입장 전) 기기 ID의 HMAC */
  readonly actorId: string;
  readonly name: string;
  readonly argsHash: string;
}

export type CommandOutcome<T> =
  { readonly replayed: false; readonly result: T } | { readonly replayed: true; readonly result: T };

export interface CommandRepo {
  /**
   * 이미 기록이 있으면 같은 명령인지 보고 저장된 결과를 돌려준다(다르면 `E_INPUT`). 없으면 `undefined`.
   * 속도 제한을 세기 전에 불러, 다시 보낸 요청이 칸을 더 쓰지 않게 한다.
   */
  replay<T>(key: CommandKey): CommandOutcome<T> | undefined;
  /**
   * 한 트랜잭션으로 [기록 확인 → 실행 → 결과 기록]. 실행이 던지면 아무것도 남지 않는다(다시 보내면 다시 실행).
   * `roomIdOf`는 실행 결과로 정해지는 수업방(만들기)을 기록 행에 붙일 때 쓴다(방을 지우면 기록도 함께 사라짐).
   */
  runOnce<T>(
    key: CommandKey & { readonly roomId: string | null },
    now: number,
    exec: () => T,
    roomIdOf?: (result: T) => string | null,
  ): CommandOutcome<T>;
  /**
   * 비동기로 끝난 명령(AI)의 결과를 남긴다. 같은 commandId가 이미 있으면 남기지 않는다(앞 결과가 이긴다).
   */
  record(key: CommandKey & { readonly roomId: string | null }, now: number, result: unknown): void;
  /** `created_at < before`인 기록을 지운다. */
  prune(before: number): number;
}

interface Row {
  actor_kind: CommandActorKind;
  actor_id: string;
  name: string;
  args_hash: string;
  result_json: string;
}

/** 키 순서를 정렬한 JSON의 SHA-256 hex. 같은 인자는 늘 같은 해시다. */
export function hashArgs(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(v => stableStringify(v ?? null)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** 정리 작업이 쓸 기준 시각(PLAN §5.3-4). */
export function commandRetentionCutoff(now: number, config: Readonly<Config>): number {
  return now - config.COMMAND_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

export function createCommandRepo(db: Db): CommandRepo {
  const findStmt = db.prepare<[string], Row>(
    'SELECT actor_kind, actor_id, name, args_hash, result_json FROM commands WHERE id = ?',
  );
  const insertStmt = db.prepare(
    `INSERT INTO commands (id, room_id, actor_kind, actor_id, name, args_hash, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertIgnoreStmt = db.prepare(
    `INSERT OR IGNORE INTO commands (id, room_id, actor_kind, actor_id, name, args_hash, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const pruneStmt = db.prepare('DELETE FROM commands WHERE created_at < ?');

  const check = <T>(key: CommandKey): CommandOutcome<T> | undefined => {
    const row = findStmt.get(key.id);
    if (!row) return undefined;
    if (
      row.actor_kind !== key.actorKind ||
      row.actor_id !== key.actorId ||
      row.name !== key.name ||
      row.args_hash !== key.argsHash
    ) {
      throw new AppError('E_INPUT', 'commandId reused with different command', { commandId: 'reused' });
    }
    // 저장된 결과는 이 서버가 같은 명령으로 만든 값이다.
    return { replayed: true, result: JSON.parse(row.result_json) as T };
  };

  return {
    replay: check,
    runOnce(key, now, exec, roomIdOf) {
      return db.transaction(() => {
        const previous = check<ReturnType<typeof exec>>(key);
        if (previous) return previous;
        const result = exec();
        const roomId = roomIdOf ? roomIdOf(result) : key.roomId;
        insertStmt.run(
          key.id,
          roomId,
          key.actorKind,
          key.actorId,
          key.name,
          key.argsHash,
          JSON.stringify(result ?? null),
          now,
        );
        return { replayed: false as const, result };
      })();
    },
    record(key, now, result) {
      insertIgnoreStmt.run(
        key.id,
        key.roomId,
        key.actorKind,
        key.actorId,
        key.name,
        key.argsHash,
        JSON.stringify(result ?? null),
        now,
      );
    },
    prune: before => pruneStmt.run(before).changes,
  };
}
