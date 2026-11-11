import { defaultConfig } from '@geulbang/core/config';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../testing/fakeClock.ts';
import { decide, Gate, type FieldState } from './gate.ts';

const T = defaultConfig; // IDLE 500, LONG 2000, MAX_HOLD 10000, RELAXED 300, STUCK 5000, NOTICE 3000
const HAN = '한'.codePointAt(0)!;
const SPACE = ' '.codePointAt(0)!;

function field(p: Partial<Omit<FieldState, 'charBeforeCaret'>> & { before?: number }): FieldState {
  return {
    composing: p.composing ?? false,
    lastActivityAt: p.lastActivityAt ?? 0,
    caretMovedByUser: p.caretMovedByUser ?? false,
    focused: p.focused ?? true,
    charBeforeCaret: () => p.before,
  };
}

describe('decide (PRD 9.3 3~7번)', () => {
  it.each<[string, FieldState[], number | null, number, boolean, string]>([
    ['초점 있는 칸이 없으면 연다', [field({ focused: false })], 0, 100, true, 'open'],
    ['조합 중이면 닫는다(3번)', [field({ composing: true, lastActivityAt: 0 })], 0, 4999, false, 'composing'],
    [
      '조합이 5초 동안 조용하면 끝난 것으로 본다(7번)',
      [field({ composing: true, lastActivityAt: 0, before: SPACE })],
      0,
      5000,
      true,
      'open',
    ],
    [
      '다른 칸의 조합도 막는다(글 단위)',
      [field({ before: SPACE }), field({ focused: false, composing: true, lastActivityAt: 900 })],
      0,
      1000,
      false,
      'composing',
    ],
    [
      '500ms 멈춤 전에는 닫는다(4번)',
      [field({ lastActivityAt: 1000, before: SPACE })],
      1000,
      1499,
      false,
      'idle',
    ],
    [
      '500ms 뒤 띄어쓰기 앞이면 연다(5번)',
      [field({ lastActivityAt: 1000, before: SPACE })],
      1000,
      1500,
      true,
      'open',
    ],
    [
      '500ms 뒤라도 한글 뒤면 닫는다(음절 경계 아님)',
      [field({ lastActivityAt: 1000, before: HAN })],
      1000,
      1500,
      false,
      'syllable',
    ],
    [
      '한글 뒤라도 커서를 옮겼으면 연다',
      [field({ lastActivityAt: 1000, before: HAN, caretMovedByUser: true })],
      1000,
      1500,
      true,
      'open',
    ],
    ['한글 뒤라도 2초 멈추면 연다', [field({ lastActivityAt: 1000, before: HAN })], 1000, 3000, true, 'open'],
    ['커서가 맨 앞이면 경계', [field({ lastActivityAt: 0 })], 0, 600, true, 'open'],
    [
      '보류 10초 뒤에는 300ms 멈춤만 본다(6번)',
      [field({ lastActivityAt: 10_000, before: HAN })],
      0,
      10_300,
      true,
      'open',
    ],
    [
      '보류 10초 뒤라도 300ms 안에는 닫는다',
      [field({ lastActivityAt: 10_000, before: HAN })],
      0,
      10_299,
      false,
      'relaxed-idle',
    ],
    [
      '보류 10초 뒤라도 조합이 열려 있으면 닫는다',
      [field({ composing: true, lastActivityAt: 9_000, before: HAN })],
      0,
      12_000,
      false,
      'composing',
    ],
  ])('%s', (_name, fields, holdSince, now, open, reason) => {
    const d = decide(fields, holdSince, now, T);
    expect(d.open).toBe(open);
    expect(d.reason).toBe(reason);
  });

  it('닫힐 때 다시 볼 시각을 준다', () => {
    expect(decide([field({ lastActivityAt: 1000, before: SPACE })], 1000, 1200, T).recheckAt).toBe(1500);
    expect(decide([field({ lastActivityAt: 1000, before: HAN })], 1000, 1600, T).recheckAt).toBe(3000);
    expect(decide([field({ lastActivityAt: 8000, before: HAN })], 0, 8600, T).recheckAt).toBe(10_000);
  });

  it('선택 범위 끝 앞 글자가 한글이면 맨 앞([0, 1])이어도 음절 경계가 아니다', () => {
    const f: FieldState = {
      composing: false,
      lastActivityAt: 1000,
      caretMovedByUser: false,
      focused: true,
      charBeforeCaret: () => undefined,
      charBeforeSelectionEnd: () => HAN,
    };
    const d = decide([f], 1000, 1600, T);
    expect(d.open).toBe(false);
    expect(d.reason).toBe('syllable');
  });
});

describe('Gate 조정자', () => {
  const setup = () => {
    const clock = new FakeClock();
    const state = {
      composing: false,
      lastActivityAt: 0,
      caretMovedByUser: false,
      focused: true,
      before: HAN as number | undefined,
    };
    const f: FieldState = {
      get composing() {
        return state.composing;
      },
      get lastActivityAt() {
        return state.lastActivityAt;
      },
      get caretMovedByUser() {
        return state.caretMovedByUser;
      },
      get focused() {
        return state.focused;
      },
      charBeforeCaret: () => state.before,
    };
    const log: string[] = [];
    const gate: Gate = new Gate(
      T,
      {
        onFlush: () => {
          log.push(`flush@${clock.t}`);
          gate.flushed();
        },
        onHoldChange: h => log.push(`hold:${h}@${clock.t}`),
      },
      clock,
    );
    gate.addField(f);
    const type = (before: number) => {
      state.lastActivityAt = clock.t;
      state.before = before;
      state.caretMovedByUser = false;
      gate.poke();
    };
    return { clock, state, gate, log, type };
  };

  it('계속 한글을 치면 기다리다 띄어쓰기 뒤 500ms에 반영한다', () => {
    const { clock, gate, log, type } = setup();
    gate.markPending();
    for (let i = 0; i < 6; i++) {
      clock.advance(200);
      type(HAN);
    }
    expect(log).toEqual([]);
    clock.advance(200);
    type(SPACE);
    clock.advance(499);
    expect(log).toEqual([]);
    clock.advance(1);
    expect(log).toEqual([`flush@${clock.t}`]);
  });

  it('쉬지 않고 쳐도 10초가 지나면 300ms 멈춤에서 반영하고, 3초부터 알림을 띄운다', () => {
    const { clock, gate, log, type } = setup();
    gate.markPending();
    for (let i = 0; i < 60; i++) {
      clock.advance(200);
      type(HAN);
    }
    expect(log).toEqual(['hold:true@3000']);
    clock.advance(300);
    expect(log.at(-2)).toBe(`flush@${clock.t}`);
    expect(log.at(-1)).toBe(`hold:false@${clock.t}`);
  });

  it('0.3초도 쉬지 않으면 10초가 지나도 기다린다(한글 보호 우선)', () => {
    const { clock, gate, log, type } = setup();
    gate.markPending();
    for (let i = 0; i < 100; i++) {
      clock.advance(250);
      type(HAN);
    }
    expect(log.filter(l => l.startsWith('flush'))).toEqual([]);
  });

  it('앱이 하는 변경은 조합이 끝나고 500ms 멈춘 뒤에 된다', async () => {
    const { clock, state, gate } = setup();
    state.composing = true;
    state.lastActivityAt = 0;
    let done = false;
    void gate.whenIdle().then(() => (done = true));
    clock.advance(1000);
    await Promise.resolve();
    expect(done).toBe(false);
    state.composing = false;
    state.lastActivityAt = clock.t;
    gate.poke();
    clock.advance(500);
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it('whenOpen은 한글 뒤에서 500ms가 아닌 2초 음절 경계까지 기다리고, 5초 고착 시 조합 플래그를 내린다', async () => {
    const { clock, state, gate } = setup();
    let cleared = 0;
    gate.addField({
      get composing() {
        return state.composing;
      },
      get lastActivityAt() {
        return state.lastActivityAt;
      },
      caretMovedByUser: false,
      focused: false,
      charBeforeCaret: () => undefined,
      clearStuckComposing: () => {
        state.composing = false;
        cleared++;
      },
    });

    state.composing = true;
    state.lastActivityAt = 0;
    state.before = HAN;
    let opened = false;
    void gate.whenOpen().then(() => (opened = true));

    clock.advance(4999);
    await Promise.resolve();
    expect(opened).toBe(false);
    expect(state.composing).toBe(true);

    // 5000ms 고착 해제 정각에 clearStuckComposing이 불리고(idle 5000 >= 2000) 문이 열린다
    clock.advance(1);
    await Promise.resolve();
    expect(cleared).toBe(1);
    expect(state.composing).toBe(false);
    expect(opened).toBe(true);

    // 한글 입력 직후에는 600ms가 지나도 안 열리고 2000ms에 열린다
    state.lastActivityAt = clock.t;
    state.before = HAN;
    let openedAfterHangul = false;
    void gate.whenOpen().then(() => (openedAfterHangul = true));
    clock.advance(600);
    await Promise.resolve();
    expect(openedAfterHangul).toBe(false);
    clock.advance(1400);
    await Promise.resolve();
    expect(openedAfterHangul).toBe(true);
  });
});
