import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MS_PER_MINUTE, MS_PER_SECOND } from './clock.ts';
import { TIMER_STATUSES, type TimerStatus } from './status.ts';
import {
  cancelTimer,
  computeRemainingMs,
  computeRemainingSec,
  computeTimerAlerts,
  createIdleTimer,
  DEFAULT_TIMER_END_TEXT,
  filterEligibleAlertMinutes,
  isValidTimerDurationSec,
  isValidTimerMinutes,
  pauseTimer,
  restoreTimer,
  resumeTimer,
  startTimer,
  tickTimer,
  validateTimerDurationSec,
  validateTimerMinutes,
  type TimerState,
} from './timer.ts';

describe('timer 상태 기계·알림 시각·재시작 복원', () => {
  const baseNow = Date.UTC(2026, 10, 11, 9, 0, 0, 0);
  const cfg = { TIMER_MAX_MIN: 120 };

  it('TIMER_MAX_MIN(120분) 경계와 정수 여부를 정확히 검사한다', () => {
    expect(validateTimerMinutes(0, cfg)).toEqual({ ok: false, reason: 'TOO_SHORT' });
    expect(validateTimerMinutes(1.5, cfg)).toEqual({ ok: false, reason: 'NOT_INTEGER' });
    expect(validateTimerMinutes(1, cfg)).toEqual({ ok: true, minutes: 1, durationSec: 60 });
    expect(validateTimerMinutes(120, cfg)).toEqual({ ok: true, minutes: 120, durationSec: 7200 });
    expect(validateTimerMinutes(121, cfg)).toEqual({ ok: false, reason: 'TOO_LONG' });
    expect(isValidTimerMinutes(20, cfg)).toBe(true);
    expect(isValidTimerMinutes(121, cfg)).toBe(false);

    expect(validateTimerDurationSec(0, cfg)).toEqual({ ok: false, reason: 'TOO_SHORT' });
    expect(validateTimerDurationSec(7200, cfg)).toEqual({ ok: true, durationSec: 7200 });
    expect(validateTimerDurationSec(7201, cfg)).toEqual({ ok: false, reason: 'TOO_LONG' });
    expect(isValidTimerDurationSec(600, cfg)).toBe(true);
    expect(isValidTimerDurationSec(7201, cfg)).toBe(false);

    expect(() => startTimer({ durationSec: 0 }, baseNow, cfg)).toThrow(RangeError);
    expect(() => startTimer({ durationSec: 7201 }, baseNow, cfg)).toThrow(RangeError);
  });

  it('상태 전이 표(IDLE·RUNNING·PAUSED × start·pause·resume·cancel) 전체를 검증한다', () => {
    type Action = 'start' | 'pause' | 'resume' | 'cancel';
    const expectedTable: Readonly<Record<TimerStatus, Readonly<Record<Action, TimerStatus>>>> = {
      IDLE: {
        start: 'RUNNING',
        pause: 'IDLE',
        resume: 'IDLE',
        cancel: 'IDLE',
      },
      RUNNING: {
        start: 'RUNNING',
        pause: 'PAUSED',
        resume: 'RUNNING',
        cancel: 'IDLE',
      },
      PAUSED: {
        start: 'RUNNING',
        pause: 'PAUSED',
        resume: 'RUNNING',
        cancel: 'IDLE',
      },
    };

    const makeFixture = (status: TimerStatus): TimerState => {
      if (status === 'IDLE') return createIdleTimer();
      const running = startTimer({ durationSec: 600, alerts: [5, 1] }, baseNow, cfg);
      if (status === 'RUNNING') return running;
      return pauseTimer(running, baseNow + 60 * MS_PER_SECOND);
    };

    const applyAction = (state: TimerState, action: Action, atMs: number): TimerState => {
      switch (action) {
        case 'start':
          return startTimer({ durationSec: 300, alerts: [5, 1] }, atMs, cfg);
        case 'pause':
          return pauseTimer(state, atMs);
        case 'resume':
          return resumeTimer(state, atMs);
        case 'cancel':
          return cancelTimer(state);
      }
    };

    const actions: readonly Action[] = ['start', 'pause', 'resume', 'cancel'];
    for (const fromStatus of TIMER_STATUSES) {
      for (const action of actions) {
        const initial = makeFixture(fromStatus);
        const next = applyAction(initial, action, baseNow + 120 * MS_PER_SECOND);
        expect(next.status).toBe(expectedTable[fromStatus][action]);
      }
    }
  });

  it('타이머 시작 → 멈춤 → 다시 시작 뒤 남은 시간과 끝나는 시각을 정확히 계산한다', () => {
    // 10분(600초) 시작
    const started = startTimer({ durationSec: 600, alerts: [5, 1] }, baseNow, cfg);
    expect(started.status).toBe('RUNNING');
    expect(started.endsAt).toBe(baseNow + 10 * MS_PER_MINUTE);
    expect(started.remainingMs).toBe(10 * MS_PER_MINUTE);
    expect(computeRemainingSec(started, baseNow + 90_000)).toBe(510);

    // 3분 20초(200초) 경과 시점에 멈춤 → 남은 시간 6분 40초(400초 = 400,000ms)
    const pauseAt = baseNow + 200 * MS_PER_SECOND;
    const paused = pauseTimer(started, pauseAt);
    expect(paused.status).toBe('PAUSED');
    expect(paused.endsAt).toBeNull();
    expect(paused.remainingMs).toBe(400 * MS_PER_SECOND);

    // 멈춘 동안 5분이 흘러도 남은 시간은 그대로 400초
    const resumeAt = pauseAt + 5 * MS_PER_MINUTE;
    expect(computeRemainingMs(paused, resumeAt)).toBe(400 * MS_PER_SECOND);

    // 다시 시작하면 새 끝 시각 = resumeAt + 400초
    const resumed = resumeTimer(paused, resumeAt);
    expect(resumed.status).toBe('RUNNING');
    expect(resumed.remainingMs).toBe(400 * MS_PER_SECOND);
    expect(resumed.endsAt).toBe(resumeAt + 400 * MS_PER_SECOND);

    // 끝 시각 정각에 tickTimer를 부르면 IDLE로 돌아간다
    const finished = tickTimer(resumed, resumeAt + 400 * MS_PER_SECOND);
    expect(finished.status).toBe('IDLE');
    expect(finished.endsAt).toBeNull();
    expect(finished.remainingMs).toBeNull();
  });

  it('타이머 길이와 같거나 이른 알림, 그리고 멈춤·다시 뒤 과거로 간 알림을 건너뛴다', () => {
    // 10분 타이머: 5분 전·1분 전·끝 3개 모두 예약됨
    const t10 = startTimer({ durationSec: 10 * 60, alerts: [5, 1] }, baseNow, cfg);
    expect(t10.alerts).toEqual([5, 1]);
    expect(computeTimerAlerts(t10, baseNow)).toEqual([
      { minutesBefore: 5, at: baseNow + 5 * MS_PER_MINUTE, text: '5분 남았어요' },
      { minutesBefore: 1, at: baseNow + 9 * MS_PER_MINUTE, text: '1분 남았어요' },
      { minutesBefore: 0, at: baseNow + 10 * MS_PER_MINUTE, text: DEFAULT_TIMER_END_TEXT },
    ]);

    // 5분 타이머: '5분 전'은 타이머 길이와 같으므로(과거/현재 시각) 꺼지고 '1분 전'과 '끝'만 남음
    expect(filterEligibleAlertMinutes(5 * 60, [5, 1])).toEqual([1]);
    const t5 = startTimer({ durationSec: 5 * 60, alerts: [5, 1] }, baseNow, cfg);
    expect(t5.alerts).toEqual([1]);
    expect(computeTimerAlerts(t5, baseNow)).toEqual([
      { minutesBefore: 1, at: baseNow + 4 * MS_PER_MINUTE, text: '1분 남았어요' },
      { minutesBefore: 0, at: baseNow + 5 * MS_PER_MINUTE, text: DEFAULT_TIMER_END_TEXT },
    ]);

    // 1분 타이머: '5분 전'·'1분 전' 모두 꺼지고 '끝' 알림만 남음
    const t1 = startTimer({ durationSec: 60, alerts: [5, 1] }, baseNow, cfg);
    expect(t1.alerts).toEqual([]);
    expect(computeTimerAlerts(t1, baseNow)).toEqual([
      { minutesBefore: 0, at: baseNow + MS_PER_MINUTE, text: DEFAULT_TIMER_END_TEXT },
    ]);

    // 10분 타이머가 6분 경과(남은 시간 4분)한 뒤 멈췄다가 다시 시작하면 '5분 전'은 과거이므로 빠지고 '1분 전'·'끝'만 남음
    const pausedAt6Min = pauseTimer(t10, baseNow + 6 * MS_PER_MINUTE);
    const resumeAt = baseNow + 8 * MS_PER_MINUTE;
    const resumedWith4MinLeft = resumeTimer(pausedAt6Min, resumeAt);
    expect(computeTimerAlerts(resumedWith4MinLeft, resumeAt)).toEqual([
      { minutesBefore: 1, at: resumeAt + 3 * MS_PER_MINUTE, text: '1분 남았어요' },
      { minutesBefore: 0, at: resumeAt + 4 * MS_PER_MINUTE, text: DEFAULT_TIMER_END_TEXT },
    ]);
  });

  it('서버 재시작 뒤 저장된 값과 지금 시각으로 상태와 아직 안 보낸 알림만 복원한다', () => {
    const endsAt = baseNow + 10 * MS_PER_MINUTE;

    // 1) 6분 지났을 때(4분 남음) 재시작 → RUNNING 유지, 5분 전 알림은 이미 지났으므로 1분 전·끝만 복원
    const restoredRunning = restoreTimer(
      {
        status: 'RUNNING',
        durationMs: 10 * MS_PER_MINUTE,
        endsAt,
        alerts: { m5: true, m1: true, end: true },
        endText: '마무리해 주세요',
        startedAt: baseNow,
      },
      baseNow + 6 * MS_PER_MINUTE,
      cfg,
    );
    expect(restoredRunning.state).toEqual({
      status: 'RUNNING',
      endsAt,
      remainingMs: 4 * MS_PER_MINUTE,
      durationSec: 600,
      alerts: [5, 1],
      endText: '마무리해 주세요',
    });
    expect(restoredRunning.pendingAlerts).toEqual([
      { minutesBefore: 1, at: endsAt - MS_PER_MINUTE, text: '1분 남았어요' },
      { minutesBefore: 0, at: endsAt, text: '마무리해 주세요' },
    ]);

    // 2) 꺼져 있는 동안 끝 시각이 지났으면 IDLE로 복원되고 남은 알림은 없다
    const restoredExpired = restoreTimer(
      {
        status: 'RUNNING',
        durationSec: 600,
        endsAt,
        alerts: [5, 1],
        endText: DEFAULT_TIMER_END_TEXT,
      },
      endsAt + 1000,
      cfg,
    );
    expect(restoredExpired.state.status).toBe('IDLE');
    expect(restoredExpired.state.endsAt).toBeNull();
    expect(restoredExpired.pendingAlerts).toEqual([]);

    // 3) PAUSED 상태로 저장된 타이머는 남은 시간을 유지한 채 PAUSED로 복원되고 예약 알림은 비어 있다
    const restoredPaused = restoreTimer(
      {
        status: 'PAUSED',
        durationMs: 10 * MS_PER_MINUTE,
        pausedRemainingMs: 180_000,
        alerts: [5, 1],
        endText: DEFAULT_TIMER_END_TEXT,
      },
      baseNow + 30 * MS_PER_MINUTE,
      cfg,
    );
    expect(restoredPaused.state.status).toBe('PAUSED');
    expect(restoredPaused.state.remainingMs).toBe(180_000);
    expect(restoredPaused.pendingAlerts).toEqual([]);
  });

  it('[성질] 타이머 시작·멈춤·다시·취소를 임의의 순서와 시간 간격으로 실행해도 남은 시간은 절대 음수가 되지 않는다', () => {
    const stepArb = fc.record({
      op: fc.constantFrom<'pause' | 'resume' | 'tick' | 'cancel' | 'start'>(
        'pause',
        'resume',
        'tick',
        'cancel',
        'start',
      ),
      deltaMs: fc.integer({ min: 0, max: 30 * MS_PER_MINUTE }),
      nextDurationSec: fc.integer({ min: 1, max: 120 * 60 }),
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 120 * 60 }),
        fc.array(stepArb, { minLength: 1, maxLength: 50 }),
        (initialDurationSec, steps) => {
          let now = baseNow;
          let state = startTimer({ durationSec: initialDurationSec }, now, cfg);

          for (const step of steps) {
            now += step.deltaMs;

            // 상태 전이 전에도 computeRemainingMs는 0 이상이어야 한다
            expect(computeRemainingMs(state, now)).toBeGreaterThanOrEqual(0);
            expect(computeRemainingSec(state, now)).toBeGreaterThanOrEqual(0);

            if (step.op === 'pause') {
              state = pauseTimer(state, now);
            } else if (step.op === 'resume') {
              state = resumeTimer(state, now);
            } else if (step.op === 'tick') {
              state = tickTimer(state, now);
            } else if (step.op === 'cancel') {
              state = cancelTimer(state);
            } else {
              state = startTimer({ durationSec: step.nextDurationSec }, now, cfg);
            }

            // 상태 안의 remainingMs(존재할 때)와 계산된 남은 시간 모두 음수가 될 수 없다
            if (state.remainingMs !== null) {
              expect(state.remainingMs).toBeGreaterThanOrEqual(0);
            }
            expect(computeRemainingMs(state, now)).toBeGreaterThanOrEqual(0);
            expect(computeRemainingSec(state, now)).toBeGreaterThanOrEqual(0);

            // 예약된 모든 알림은 항상 현재 시각보다 미래(at > now)여야 한다
            for (const alert of computeTimerAlerts(state, now)) {
              expect(alert.at).toBeGreaterThan(now);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
