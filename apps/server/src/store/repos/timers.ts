import type { TimerStatus } from '@geulbang/core';
import type { TimerState } from '@geulbang/core/protocol';
import { z } from 'zod';
import type { Db } from '../db.ts';

/**
 * 타이머(PLAN §5.2 `timers`, 수업방마다 한 줄, PRD F-19). 서버에 **끝나는 시각**으로 저장한다(새로고침·늦게 온 기기도
 * 같은 시간). 알림 예약은 메모리(`jobs/timers.ts`)이고, 서버가 다시 켜지면 이 표에서 다시 만든다(PLAN §7.1-3).
 *
 * `alerts_json` = `{"minutes":[5,1]}`(끝나기 몇 분 전 알림). 끝났을 때 알림은 `end_text`가 비어 있지 않을 때다.
 * (스키마 주석의 `{m5, m1, end}` 꼴로 쓴 행도 읽는다.)
 */
export interface StoredTimer {
  readonly roomId: string;
  readonly status: TimerStatus;
  readonly durationMs: number | null;
  readonly endsAt: number | null;
  readonly pausedRemainingMs: number | null;
  readonly alerts: readonly number[];
  readonly endText: string;
  readonly startedAt: number | null;
}

export interface TimerRepo {
  /** 행이 없으면 멈춘 타이머(`IDLE`). */
  get(roomId: string, now: number): TimerState;
  find(roomId: string): StoredTimer | undefined;
  save(timer: StoredTimer): void;
  listRunning(): StoredTimer[];
}

interface Row {
  room_id: string;
  status: TimerStatus;
  duration_ms: number | null;
  ends_at: number | null;
  paused_remaining_ms: number | null;
  alerts_json: string;
  end_text: string;
  started_at: number | null;
}

const alertsSchema = z.union([
  z.object({ minutes: z.array(z.number().int().positive()) }),
  z.object({ m5: z.boolean().optional(), m1: z.boolean().optional() }),
]);
/** 옛 꼴 `{m5, m1}`의 칸 이름이 뜻하는 분 */
const LEGACY_MINUTES = { m5: 5, m1: 1 } as const;

function parseAlerts(json: string): number[] {
  try {
    const parsed = alertsSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return [];
    if ('minutes' in parsed.data) return parsed.data.minutes;
    const legacy = parsed.data;
    return (Object.keys(LEGACY_MINUTES) as Array<keyof typeof LEGACY_MINUTES>)
      .filter(k => legacy[k] === true)
      .map(k => LEGACY_MINUTES[k]);
  } catch {
    return [];
  }
}

function toTimer(row: Row): StoredTimer {
  return {
    roomId: row.room_id,
    status: row.status,
    durationMs: row.duration_ms,
    endsAt: row.ends_at,
    pausedRemainingMs: row.paused_remaining_ms,
    alerts: parseAlerts(row.alerts_json),
    endText: row.end_text,
    startedAt: row.started_at,
  };
}

/** 기기에 보낼 모양(`timer` 이벤트·`hello.timer`) */
export function timerStateOf(timer: StoredTimer | undefined, now: number): TimerState {
  if (!timer || timer.status === 'IDLE') {
    return {
      status: 'IDLE',
      endsAt: null,
      remainingMs: null,
      durationSec: timer?.durationMs == null ? null : Math.round(timer.durationMs / 1000),
      alerts: timer ? [...timer.alerts] : [],
      endText: timer?.endText ?? '',
    };
  }
  const running = timer.status === 'RUNNING' && timer.endsAt !== null;
  return {
    status: timer.status,
    endsAt: running ? timer.endsAt : null,
    remainingMs: running ? Math.max(0, (timer.endsAt ?? now) - now) : timer.pausedRemainingMs,
    durationSec: timer.durationMs === null ? null : Math.round(timer.durationMs / 1000),
    alerts: [...timer.alerts],
    endText: timer.endText,
  };
}

const COLUMNS =
  'room_id, status, duration_ms, ends_at, paused_remaining_ms, alerts_json, end_text, started_at';

export function createTimerRepo(db: Db): TimerRepo {
  const getStmt = db.prepare<[string], Row>(`SELECT ${COLUMNS} FROM timers WHERE room_id = ?`);
  const saveStmt = db.prepare(
    `INSERT INTO timers (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (room_id) DO UPDATE SET status = excluded.status, duration_ms = excluded.duration_ms,
       ends_at = excluded.ends_at, paused_remaining_ms = excluded.paused_remaining_ms,
       alerts_json = excluded.alerts_json, end_text = excluded.end_text, started_at = excluded.started_at`,
  );
  const runningStmt = db.prepare<[], Row>(`SELECT ${COLUMNS} FROM timers WHERE status = 'RUNNING'`);

  const find = (roomId: string): StoredTimer | undefined => {
    const row = getStmt.get(roomId);
    return row ? toTimer(row) : undefined;
  };

  return {
    get: (roomId, now) => timerStateOf(find(roomId), now),
    find,
    save(t) {
      saveStmt.run(
        t.roomId,
        t.status,
        t.durationMs,
        t.endsAt,
        t.pausedRemainingMs,
        JSON.stringify({ minutes: t.alerts }),
        t.endText,
        t.startedAt,
      );
    },
    listRunning: () => runningStmt.all().map(toTimer),
  };
}
