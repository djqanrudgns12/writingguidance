import { defaultConfig, type Config } from '../config.ts';
import { ko } from '../copy/ko.ts';
import { MS_PER_MINUTE, MS_PER_SECOND } from './clock.ts';
import type { TimerStatus } from './status.ts';

/**
 * 수업방 타이머 상태 기계·알림 시각 계산·재시작 복원(PRD F-19, PLAN §2.3 ⑨·§4.4·§5.2·§7.5).
 *
 * - 상태: `IDLE` · `RUNNING` · `PAUSED`
 * - 동작: 시작(`startTimer`) · 멈춤(`pauseTimer`) · 다시(`resumeTimer`) · 취소(`cancelTimer`)
 * - 알림: 끝나기 `n`분 전(PRD F-19 기본 5분 전·1분 전)과 끝났을 때(`0`분 전).
 *   타이머 길이와 같거나 더 이른 알림, 또는 멈춤·재시작 뒤 이미 과거가 된 알림(`at <= nowMs`)은 건너뛴다.
 */

export type TimerMaxConfig = Pick<Config, 'TIMER_MAX_MIN'>;

/** PRD F-19 기본 사전 알림(끝나기 5분 전·1분 전). */
export const DEFAULT_TIMER_ALERT_MINUTES = [5, 1] as const;

/** PRD F-19 끝났을 때 기본 알림 문구. */
export const DEFAULT_TIMER_END_TEXT: string = ko.teacher.timerEndDefaultText;

export type TimerDurationRejectReason = 'NOT_INTEGER' | 'TOO_SHORT' | 'TOO_LONG';

export type TimerMinutesValidation =
  | { readonly ok: true; readonly minutes: number; readonly durationSec: number }
  | { readonly ok: false; readonly reason: TimerDurationRejectReason };

export type TimerDurationSecValidation =
  | { readonly ok: true; readonly durationSec: number }
  | { readonly ok: false; readonly reason: TimerDurationRejectReason };

export interface TimerState {
  readonly status: TimerStatus;
  readonly endsAt: number | null;
  readonly remainingMs: number | null;
  readonly durationSec: number | null;
  readonly alerts: number[];
  readonly endText: string;
}

export interface StartTimerInput {
  readonly durationSec: number;
  readonly alerts?: readonly number[] | undefined;
  readonly endText?: string | undefined;
}

export interface TimerAlert {
  /** 끝나기 몇 분 전인가(`0`이면 타이머가 끝났을 때). */
  readonly minutesBefore: number;
  /** 알림을 보낼 시각(UTC ms). */
  readonly at: number;
  /** 학생 화면에 띄울 알림 문구. */
  readonly text: string;
}

export interface TimerAlertsFlags {
  readonly m5?: boolean | undefined;
  readonly m1?: boolean | undefined;
  readonly end?: boolean | undefined;
}

export interface StoredTimerInput {
  readonly status: TimerStatus;
  readonly endsAt?: number | null | undefined;
  readonly remainingMs?: number | null | undefined;
  readonly pausedRemainingMs?: number | null | undefined;
  readonly durationSec?: number | null | undefined;
  readonly durationMs?: number | null | undefined;
  readonly alerts?: readonly number[] | TimerAlertsFlags | null | undefined;
  readonly endText?: string | null | undefined;
  readonly startedAt?: number | null | undefined;
}

export interface RestoredTimer {
  readonly state: TimerState;
  readonly pendingAlerts: TimerAlert[];
}

/** 분 단위 타이머 입력이 `1 ~ TIMER_MAX_MIN` 정수인지 검사한다(PRD F-19). */
export function validateTimerMinutes(
  minutes: number,
  config: TimerMaxConfig = defaultConfig,
): TimerMinutesValidation {
  if (!Number.isInteger(minutes)) {
    return { ok: false, reason: 'NOT_INTEGER' };
  }
  if (minutes < 1) {
    return { ok: false, reason: 'TOO_SHORT' };
  }
  if (minutes > config.TIMER_MAX_MIN) {
    return { ok: false, reason: 'TOO_LONG' };
  }
  return { ok: true, minutes, durationSec: minutes * 60 };
}

export function isValidTimerMinutes(minutes: number, config: TimerMaxConfig = defaultConfig): boolean {
  return validateTimerMinutes(minutes, config).ok;
}

/** 초 단위 타이머 길이가 `1 ~ TIMER_MAX_MIN * 60` 정수인지 검사한다. */
export function validateTimerDurationSec(
  durationSec: number,
  config: TimerMaxConfig = defaultConfig,
): TimerDurationSecValidation {
  if (!Number.isInteger(durationSec)) {
    return { ok: false, reason: 'NOT_INTEGER' };
  }
  if (durationSec < 1) {
    return { ok: false, reason: 'TOO_SHORT' };
  }
  if (durationSec > config.TIMER_MAX_MIN * 60) {
    return { ok: false, reason: 'TOO_LONG' };
  }
  return { ok: true, durationSec };
}

export function isValidTimerDurationSec(
  durationSec: number,
  config: TimerMaxConfig = defaultConfig,
): boolean {
  return validateTimerDurationSec(durationSec, config).ok;
}

/**
 * 타이머 길이(`durationSec`)보다 짧은 사전 알림(`n`분 전, `n > 0`)만 골라 큰 값부터 정렬한다.
 * PRD F-19: 타이머 길이와 같거나 더 이른 알림(예: 5분 타이머의 5분 전)은 자동으로 끈다.
 */
export function filterEligibleAlertMinutes(
  durationSec: number,
  alerts: readonly number[] = DEFAULT_TIMER_ALERT_MINUTES,
): number[] {
  const unique = new Set<number>();
  for (const raw of alerts) {
    if (!Number.isInteger(raw) || raw <= 0) continue;
    if (raw * 60 >= durationSec) continue;
    unique.add(raw);
  }
  return [...unique].sort((a, b) => b - a);
}

/** 사전 알림(`n`분 전) 문구를 만든다(예: `5분 남았어요`, `1분 남았어요`). */
export function formatTimerPreAlertText(minutesBefore: number): string {
  return `${String(minutesBefore)}분 남았어요`;
}

/** 현재 시각과 남은 시간(ms)으로 끝나는 시각(UTC ms)을 계산한다. */
export function computeEndsAt(nowMs: number, remainingMs: number): number {
  return nowMs + Math.max(0, remainingMs);
}

/**
 * 타이머의 현재 남은 시간(밀리초, 0 이상)을 계산한다.
 * - `IDLE`: `0`
 * - `PAUSED`: 멈춰 둔 남은 시간(음수 방지)
 * - `RUNNING`: `max(0, endsAt - nowMs)`
 */
export function computeRemainingMs(state: TimerState, nowMs: number): number {
  if (state.status === 'IDLE') return 0;
  if (state.status === 'PAUSED') {
    return Math.max(0, state.remainingMs ?? 0);
  }
  if (state.endsAt === null) return 0;
  return Math.max(0, state.endsAt - nowMs);
}

/** 타이머의 현재 남은 시간(초, 올림 정수, 0 이상)을 계산한다. */
export function computeRemainingSec(state: TimerState, nowMs: number): number {
  const leftMs = computeRemainingMs(state, nowMs);
  if (leftMs <= 0) return 0;
  return Math.ceil(leftMs / MS_PER_SECOND);
}

/** 기본 `IDLE` 타이머 상태를 만든다. */
export function createIdleTimer(endText: string = DEFAULT_TIMER_END_TEXT): TimerState {
  const normalizedEndText = endText.trim();
  return {
    status: 'IDLE',
    endsAt: null,
    remainingMs: null,
    durationSec: null,
    alerts: [],
    endText: normalizedEndText.length > 0 ? normalizedEndText : DEFAULT_TIMER_END_TEXT,
  };
}

/**
 * 타이머를 시작한다(`IDLE`·`RUNNING`·`PAUSED` → `RUNNING`).
 * `durationSec`이 `1 ~ TIMER_MAX_MIN * 60` 범위를 벗어나면 `RangeError`를 던진다.
 */
export function startTimer(
  input: StartTimerInput,
  nowMs: number,
  config: TimerMaxConfig = defaultConfig,
): TimerState {
  const check = validateTimerDurationSec(input.durationSec, config);
  if (!check.ok) {
    throw new RangeError(
      `유효하지 않은 타이머 길이(durationSec=${String(input.durationSec)}, reason=${check.reason})`,
    );
  }

  const durationMs = input.durationSec * MS_PER_SECOND;
  const endsAt = computeEndsAt(nowMs, durationMs);
  const alerts = filterEligibleAlertMinutes(input.durationSec, input.alerts ?? DEFAULT_TIMER_ALERT_MINUTES);
  const endText = input.endText === undefined ? DEFAULT_TIMER_END_TEXT : input.endText.trim();

  return {
    status: 'RUNNING',
    endsAt,
    remainingMs: durationMs,
    durationSec: input.durationSec,
    alerts,
    endText,
  };
}

/**
 * 돌고 있는 타이머를 멈춘다(`RUNNING` → `PAUSED`).
 * `IDLE`이나 이미 `PAUSED`인 상태는 그대로 유지하며, 남은 시간은 절대 음수가 되지 않는다.
 */
export function pauseTimer(state: TimerState, nowMs: number): TimerState {
  if (state.status === 'IDLE') return state;
  if (state.status === 'PAUSED') {
    const clamped = Math.max(0, state.remainingMs ?? 0);
    return clamped === state.remainingMs ? state : { ...state, endsAt: null, remainingMs: clamped };
  }

  const remainingMs = computeRemainingMs(state, nowMs);
  return {
    status: 'PAUSED',
    endsAt: null,
    remainingMs,
    durationSec: state.durationSec,
    alerts: [...state.alerts],
    endText: state.endText,
  };
}

/**
 * 멈춘 타이머를 다시 돌린다(`PAUSED` → `RUNNING`).
 * `IDLE`은 그대로 두고, 이미 `RUNNING`이면 현재 시각 기준 `remainingMs`(0 이상)만 갱신한다.
 */
export function resumeTimer(state: TimerState, nowMs: number): TimerState {
  if (state.status === 'IDLE') return state;
  if (state.status === 'RUNNING') {
    const remainingMs = computeRemainingMs(state, nowMs);
    return {
      ...state,
      remainingMs,
    };
  }

  const remainingMs = Math.max(0, state.remainingMs ?? 0);
  const endsAt = computeEndsAt(nowMs, remainingMs);
  return {
    status: 'RUNNING',
    endsAt,
    remainingMs,
    durationSec: state.durationSec,
    alerts: [...state.alerts],
    endText: state.endText,
  };
}

/** 타이머를 취소해 `IDLE` 상태로 되돌린다(`RUNNING`·`PAUSED`·`IDLE` → `IDLE`). */
export function cancelTimer(state?: TimerState): TimerState {
  return createIdleTimer(state?.endText);
}

/**
 * 지금 시각 기준으로 타이머 상태를 갱신한다.
 * `RUNNING` 타이머의 끝 시각(`endsAt`)이 지났으면 `IDLE`로 전이한다.
 */
export function tickTimer(state: TimerState, nowMs: number): TimerState {
  if (state.status !== 'RUNNING') return state;
  const remainingMs = computeRemainingMs(state, nowMs);
  if (remainingMs <= 0) {
    return createIdleTimer(state.endText);
  }
  return {
    ...state,
    remainingMs,
  };
}

/**
 * 현재 `RUNNING` 타이머에서 앞으로(`at > nowMs`) 보내야 할 알림 시각 목록을 시간순으로 계산한다.
 * - 사전 알림(`alerts`의 `n`분 전): 타이머 전체 길이보다 짧고(`n * 60 < durationSec`), `at > nowMs`인 것만 포함.
 * - 끝 알림(`minutesBefore = 0`): `endsAt > nowMs`이고 `endText`가 비어 있지 않을 때 포함.
 */
export function computeTimerAlerts(
  state: TimerState,
  nowMs: number,
  options?: { readonly includeEnd?: boolean | undefined },
): TimerAlert[] {
  if (state.status !== 'RUNNING' || state.endsAt === null) return [];
  if (nowMs >= state.endsAt) return [];

  const durationSec =
    state.durationSec !== null && state.durationSec > 0
      ? state.durationSec
      : Math.ceil((state.endsAt - nowMs) / MS_PER_SECOND);
  const eligibleMinutes = filterEligibleAlertMinutes(durationSec, state.alerts);

  const items: TimerAlert[] = [];
  for (const minutesBefore of eligibleMinutes) {
    const at = state.endsAt - minutesBefore * MS_PER_MINUTE;
    if (at > nowMs) {
      items.push({
        minutesBefore,
        at,
        text: formatTimerPreAlertText(minutesBefore),
      });
    }
  }

  const endText = state.endText.trim();
  const shouldIncludeEnd =
    options?.includeEnd !== undefined ? options.includeEnd : endText.length > 0 || state.alerts.includes(0);

  if (shouldIncludeEnd && state.endsAt > nowMs) {
    items.push({
      minutesBefore: 0,
      at: state.endsAt,
      text: endText.length > 0 ? endText : DEFAULT_TIMER_END_TEXT,
    });
  }

  items.sort((a, b) => a.at - b.at);
  return items;
}

function normalizeStoredAlerts(rawAlerts: StoredTimerInput['alerts']): {
  readonly minutes: number[];
  readonly includeEnd: boolean | undefined;
} {
  if (rawAlerts === null || rawAlerts === undefined) {
    return { minutes: [...DEFAULT_TIMER_ALERT_MINUTES], includeEnd: undefined };
  }
  if (Array.isArray(rawAlerts)) {
    return { minutes: rawAlerts.filter(n => Number.isInteger(n) && n > 0), includeEnd: undefined };
  }
  const flags = rawAlerts as TimerAlertsFlags;
  const minutes: number[] = [];
  if (flags.m5 !== false) minutes.push(5);
  if (flags.m1 !== false) minutes.push(1);
  return { minutes, includeEnd: flags.end };
}

/**
 * 서버 재시작 뒤 저장된 타이머 행(`timers`)과 현재 시각(`nowMs`)으로
 * 지금 상태(`TimerState`)와 아직 안 보낸 알림 목록(`pendingAlerts`)을 복원한다(PLAN §2.3 ⑨·§7.1-3).
 */
export function restoreTimer(
  stored: StoredTimerInput,
  nowMs: number,
  config: TimerMaxConfig = defaultConfig,
): RestoredTimer {
  const rawEndText = stored.endText?.trim() ?? '';
  const endText = rawEndText.length > 0 ? rawEndText : DEFAULT_TIMER_END_TEXT;
  const { minutes: rawAlertMinutes, includeEnd } = normalizeStoredAlerts(stored.alerts);

  const rawDurationSec =
    stored.durationSec ??
    (stored.durationMs !== null && stored.durationMs !== undefined
      ? Math.round(stored.durationMs / MS_PER_SECOND)
      : null);

  const clampedDurationSec =
    rawDurationSec !== null && rawDurationSec > 0
      ? Math.min(config.TIMER_MAX_MIN * 60, rawDurationSec)
      : null;

  if (stored.status === 'IDLE') {
    return {
      state: createIdleTimer(endText),
      pendingAlerts: [],
    };
  }

  if (stored.status === 'PAUSED') {
    const rawRemaining = stored.pausedRemainingMs ?? stored.remainingMs ?? 0;
    const remainingMs = Math.max(0, rawRemaining);
    if (remainingMs <= 0) {
      return {
        state: createIdleTimer(endText),
        pendingAlerts: [],
      };
    }
    const effectiveDurationSec = clampedDurationSec ?? Math.ceil(remainingMs / MS_PER_SECOND);
    const alerts = filterEligibleAlertMinutes(effectiveDurationSec, rawAlertMinutes);
    return {
      state: {
        status: 'PAUSED',
        endsAt: null,
        remainingMs,
        durationSec: effectiveDurationSec,
        alerts,
        endText,
      },
      pendingAlerts: [],
    };
  }

  // status === 'RUNNING'
  if (stored.endsAt === null || stored.endsAt === undefined || nowMs >= stored.endsAt) {
    return {
      state: createIdleTimer(endText),
      pendingAlerts: [],
    };
  }

  const remainingMs = stored.endsAt - nowMs;
  const effectiveDurationSec =
    clampedDurationSec ??
    (stored.startedAt !== null && stored.startedAt !== undefined && stored.endsAt > stored.startedAt
      ? Math.round((stored.endsAt - stored.startedAt) / MS_PER_SECOND)
      : Math.ceil(remainingMs / MS_PER_SECOND));
  const alerts = filterEligibleAlertMinutes(effectiveDurationSec, rawAlertMinutes);

  const state: TimerState = {
    status: 'RUNNING',
    endsAt: stored.endsAt,
    remainingMs,
    durationSec: effectiveDurationSec,
    alerts,
    endText,
  };

  return {
    state,
    pendingAlerts: computeTimerAlerts(state, nowMs, includeEnd !== undefined ? { includeEnd } : undefined),
  };
}
