import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeDeps, teacherEntry } from '../app/teacher/testFakes.ts';
import { connectionCheck, connectTeacher, type CheckResult } from './teacher.ts';

const never = <T>(signal?: AbortSignal) =>
  new Promise<T>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject({ code: 'E_OFFLINE', retryable: true }));
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('연결 점검 10초 기한(검토 B11, PRD 16.4)', () => {
  it('REST·실시간·AI가 끝나지 않아도 기한에 모든 단계를 실패로 확정하고 끝난다', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const deps = createFakeDeps({
      teacherRoom: (_roomId, _token, signal) => {
        if (signal) signals.push(signal);
        return never(signal);
      },
      checkAi: (_roomId, _token, signal) => {
        if (signal) signals.push(signal);
        return never(signal);
      },
    });
    const entry = teacherEntry();
    const t = connectTeacher(deps, entry, 'device-1');
    t.channel.send = () => never();
    const steps: CheckResult[] = [];
    let done: readonly CheckResult[] | null = null;
    void connectionCheck(
      deps,
      t,
      entry,
      s => steps.push(s),
      () => deps.newId(),
    ).then(r => {
      done = r;
    });

    await vi.advanceTimersByTimeAsync(deps.config.COMMAND_ACK_TIMEOUT_MS - 1);
    expect(done).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).not.toBeNull();
    const byStep = new Map(steps.map(s => [s.step, s.ok]));
    expect(byStep).toEqual(
      new Map([
        ['server', false],
        ['realtime', false],
        ['ai', false],
        ['storage', true],
      ]),
    );
    expect(steps).toHaveLength(4);
    // 기한이 되면 남은 요청도 끊는다.
    expect(signals.length).toBe(2);
    expect(signals.every(s => s.aborted)).toBe(true);
  });

  it('세 항목을 함께 돌린다(PRD F-16): 서버 응답·AI가 늦어도 실시간 결과는 바로 알린다', async () => {
    vi.useFakeTimers();
    const deps = createFakeDeps({
      teacherRoom: (_r, _t, signal) => never(signal),
      checkAi: (_r, _t, signal) => never(signal),
    });
    const entry = teacherEntry();
    const t = connectTeacher(deps, entry, 'device-1');
    const steps: CheckResult[] = [];
    void connectionCheck(
      deps,
      t,
      entry,
      s => steps.push(s),
      () => deps.newId(),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(steps.find(s => s.step === 'realtime')?.ok).toBe(true);
    expect(steps.find(s => s.step === 'ai')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(deps.config.COMMAND_ACK_TIMEOUT_MS);
    expect(steps.find(s => s.step === 'ai')?.ok).toBe(false);
  });

  it('부르는 쪽이 취소하면(화면을 떠남) 기한 전이라도 끝난다', async () => {
    const deps = createFakeDeps({
      teacherRoom: (_r, _t, signal) => never(signal),
      checkAi: (_r, _t, signal) => never(signal),
    });
    const entry = teacherEntry();
    const t = connectTeacher(deps, entry, 'device-1');
    t.channel.send = () => never();
    const controller = new AbortController();
    const result = connectionCheck(
      deps,
      t,
      entry,
      () => {},
      () => deps.newId(),
      controller.signal,
    );
    controller.abort();
    const results = await result;
    expect(
      results
        .filter(r => !r.ok)
        .map(r => r.step)
        .sort(),
    ).toEqual(['ai', 'realtime', 'server']);
  });
});
