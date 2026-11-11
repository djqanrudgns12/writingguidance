import { defaultConfig } from '@geulbang/core/config';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { value } from '../../ports/observable.ts';
import type { SyncedDoc } from '../../ports/realtime.ts';
import { FakeClock } from '../../testing/fakeClock.ts';
import { mountEditor, type MountedEditor } from './editor.ts';

/**
 * 편집기 바인딩 성질 시험(PRD 9.3, PLAN §10.3).
 * 기기 2~3개(학생 1~2, 교사 1)가 무작위 입력(한글·영문·공백·줄바꿈·지우기·커서 이동·조합 흉내)과
 * 무작위 시간 진행을 수천 번(최소 numRuns 300 × 단계 30) 해도:
 * ① 끝나고 충분히 기다리면 모든 입력칸·통신용 문서가 같은 글
 * ② 각 입력칸 값 = 그 편집기 viewDoc 글
 * ③ 학생 커서가 자기가 방금 친 글자 뒤
 */

const config = defaultConfig;

interface PeerHarness {
  readonly el: HTMLTextAreaElement;
  readonly editor: MountedEditor;
  readonly netDoc: Y.Doc;
  readonly role: 'student' | 'teacher';
  typeChar(ch: string): void;
  compose(steps: readonly string[], duringFirstStep?: () => void): void;
  deleteBackward(count: number): void;
  moveCaret(ratio: number): void;
  destroy(): void;
}

function fakeSyncedDoc(netDoc: Y.Doc): SyncedDoc {
  return {
    docId: 'prop-test',
    netDoc,
    awareness: null,
    saveState: value('saved' as const),
    locked: value(false),
    unsentWhileLocked: value(false),
    failure: value(null),
    rejected: value(null),
    storageFailed: value(false),
    flushLocal: async () => {},
    waitSynced: async () => {},
    close: () => {},
  };
}

function relayAll(docs: readonly Y.Doc[]): void {
  for (const src of docs) {
    src.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin === 'relay') return;
      for (const dst of docs) {
        if (dst !== src) Y.applyUpdate(dst, u, 'relay');
      }
    });
  }
}

function makePeer(
  clock: FakeClock,
  netDoc: Y.Doc,
  role: 'student' | 'teacher',
  focused: boolean,
): PeerHarness {
  const el = document.createElement('textarea');
  document.body.appendChild(el);

  const editor = mountEditor(
    { body: el },
    fakeSyncedDoc(netDoc),
    { role, readOnly: false, undoGroupMs: config.UNDO_GROUP_MS.normal, diagnosticsEnabled: false },
    { config, clock },
  );

  // jsdom은 같은 문서를 공유하므로 주 학생 칸 하나에만 초점을 준다.
  if (focused) el.focus();

  const fire = (type: string, init: Record<string, unknown> = {}) => {
    const Ctor = type.startsWith('composition')
      ? CompositionEvent
      : type === 'keydown'
        ? KeyboardEvent
        : InputEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, ...init }));
  };

  return {
    el,
    editor,
    netDoc,
    role,
    typeChar(ch) {
      const s = el.selectionStart;
      el.setRangeText(ch, s, el.selectionEnd, 'end');
      fire('input', { inputType: 'insertText', data: ch });
    },
    compose(steps, duringFirstStep) {
      fire('compositionstart');
      const start = el.selectionStart;
      let prevLen = 0;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        el.setRangeText(step, start, start + prevLen, 'end');
        prevLen = step.length;
        fire('compositionupdate', { data: step });
        fire('input', { inputType: 'insertCompositionText', data: step, isComposing: true });
        clock.advance(80);
        if (i === 0) duringFirstStep?.();
      }
      fire('compositionend', { data: steps.at(-1) });
    },
    deleteBackward(count) {
      const s = el.selectionStart;
      const e = el.selectionEnd;
      if (s !== e) {
        el.setRangeText('', s, e, 'end');
      } else if (s > 0) {
        const from = Math.max(0, s - count);
        el.setRangeText('', from, s, 'end');
      } else {
        return;
      }
      fire('input', { inputType: 'deleteContentBackward' });
    },
    moveCaret(ratio) {
      const len = el.value.length;
      const at = len === 0 ? 0 : ratio % (len + 1);
      el.setSelectionRange(at, at);
      fire('keydown', { key: 'ArrowLeft' });
    },
    destroy() {
      editor.destroy();
      el.remove();
    },
  };
}

const CHAR_POOL = ['가', '나', '다', '한', '글', '봄', '비', 'a', 'b', ' ', '\n', '.'] as const;
const COMPOSE_SEQUENCES: readonly (readonly string[])[] = [
  ['ㅎ', '하', '한'],
  ['ㄱ', '가', '강'],
  ['ㅂ', '바', '밤'],
  ['ㅅ', '사'],
  ['ㅇ', '아', '안', '않'],
  ['한', '하나'],
  ['글', '글방'],
];

type Step =
  | { readonly kind: 'type'; readonly actor: number; readonly ch: string; readonly waitMs: number }
  | {
      readonly kind: 'compose';
      readonly actor: number;
      readonly steps: readonly string[];
      readonly concurrentActor: number;
      readonly concurrentChar: string | null;
      readonly waitMs: number;
    }
  | { readonly kind: 'delete'; readonly actor: number; readonly count: number; readonly waitMs: number }
  | { readonly kind: 'caret'; readonly actor: number; readonly ratio: number; readonly waitMs: number }
  | { readonly kind: 'advance'; readonly ms: number };

const waitArb = fc.constantFrom(0, 10, 50, 120, 299, 300, 499, 500, 600, 1999, 2000, 2100);

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('type' as const),
      actor: fc.integer({ min: 0, max: 2 }),
      ch: fc.constantFrom(...CHAR_POOL),
      waitMs: waitArb,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('compose' as const),
      actor: fc.integer({ min: 0, max: 2 }),
      steps: fc.constantFrom(...COMPOSE_SEQUENCES),
      concurrentActor: fc.integer({ min: 1, max: 2 }),
      concurrentChar: fc.constantFrom<string | null>(null, '교', '첨', ' ', 'z'),
      waitMs: waitArb,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('delete' as const),
      actor: fc.integer({ min: 0, max: 2 }),
      count: fc.integer({ min: 1, max: 2 }),
      waitMs: waitArb,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('caret' as const),
      actor: fc.integer({ min: 0, max: 2 }),
      ratio: fc.integer({ min: 0, max: 200 }),
      waitMs: waitArb,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('advance' as const),
      ms: fc.constantFrom(1, 100, 299, 300, 301, 499, 500, 501, 1500, 1999, 2000, 2001, 3000, 5000),
    }),
  },
);

function makeEditorProperty() {
  return fc.property(
    fc.constantFrom<2 | 3>(2, 3),
    fc.array(stepArb, { minLength: 30, maxLength: 36 }),
    fc.constantFrom(...CHAR_POOL),
    fc.constantFrom(...CHAR_POOL),
    (peerCount, steps, finalStudentChar, finalTeacherChar) => {
      const clock = new FakeClock();
      const docs = Array.from({ length: peerCount }, () => new Y.Doc());
      relayAll(docs);

      // 기기 2개: [학생1(초점), 교사1] / 기기 3개: [학생1(초점), 학생2, 교사1]
      const peers: PeerHarness[] = docs.map((doc, idx) => {
        const role = idx === peerCount - 1 ? 'teacher' : 'student';
        const focused = idx === 0;
        return makePeer(clock, doc, role, focused);
      });
      const student = peers[0]!;
      const teacher = peers[peerCount - 1]!;

      try {
        // 학생이 마지막으로 친 글자(다른 기기가 삭제하거나 학생이 커서를 옮기면 null로 초기화)
        let lastStudentTyped: string | null = null;

        const assertViewDocMatches = () => {
          for (const p of peers) {
            expect(p.el.value).toBe(p.editor.viewDoc.getText('body').toString());
            // 범위 선택을 만든 적이 없으므로 비초점 칸도 단일 커서가 유지되어야 한다.
            expect(p.el.selectionEnd).toBe(p.el.selectionStart);
          }
        };

        const assertStudentCaretBehind = (expected: string) => {
          const caret = student.el.selectionStart;
          expect(student.el.selectionEnd).toBe(caret);
          expect(caret).toBeGreaterThanOrEqual(expected.length);
          expect(student.el.value.slice(caret - expected.length, caret)).toBe(expected);
        };

        for (const step of steps) {
          if (step.kind === 'advance') {
            clock.advance(step.ms);
            assertViewDocMatches();
            if (lastStudentTyped !== null) {
              assertStudentCaretBehind(lastStudentTyped);
            }
            continue;
          }

          const target = peers[step.actor % peerCount]!;

          if (step.kind === 'type') {
            target.typeChar(step.ch);
            if (target === student) {
              lastStudentTyped = step.ch;
              assertStudentCaretBehind(lastStudentTyped);
            }
          } else if (step.kind === 'compose') {
            const other = peers[step.concurrentActor % peerCount]!;
            target.compose(step.steps, () => {
              if (step.concurrentChar !== null && other !== target) {
                other.typeChar(step.concurrentChar);
                if (other === student) {
                  lastStudentTyped = step.concurrentChar;
                }
              }
            });
            if (target === student) {
              const finalStep = step.steps.at(-1)!;
              lastStudentTyped = finalStep.slice(-1);
              assertStudentCaretBehind(lastStudentTyped);
            }
          } else if (step.kind === 'delete') {
            target.deleteBackward(step.count);
            // 지우기가 일어나면 이전에 친 글자가 지워졌을 수 있으므로 추적 초기화
            lastStudentTyped = null;
          } else if (step.kind === 'caret') {
            target.moveCaret(step.ratio);
            if (target === student) {
              lastStudentTyped = null;
            }
          }

          // ② 매 단계 직후 각 입력칸 값 = 그 편집기 viewDoc 글
          assertViewDocMatches();

          if (step.waitMs > 0) {
            clock.advance(step.waitMs);
            assertViewDocMatches();
            if (lastStudentTyped !== null) {
              assertStudentCaretBehind(lastStudentTyped);
            }
          }
        }

        // 마지막 단계: 교사가 맨 앞에 끼워 넣고 학생이 자기 커서에 글자를 친 뒤 충분히 기다려 반영
        teacher.moveCaret(0);
        teacher.typeChar(finalTeacherChar);
        student.typeChar(finalStudentChar);
        assertStudentCaretBehind(finalStudentChar);

        // 충분히 시간을 진행해 모든 보류 변경을 반영(flush)
        clock.advance(config.IME_MAX_HOLD_MS + config.IME_STUCK_MS + config.IME_LONG_IDLE_MS);

        // ① 끝나고 충분히 기다리면 모든 입력칸·통신용 문서가 같은 글
        const expectedText = student.el.value;
        for (const p of peers) {
          expect(p.el.value).toBe(expectedText);
          expect(p.netDoc.getText('body').toString()).toBe(expectedText);
          expect(p.editor.pendingRemote()).toBe(false);
        }

        // ② 각 입력칸 값 = 그 편집기 viewDoc 글
        assertViewDocMatches();

        // ③ 원격 반영 후에도 학생 커서가 자기가 방금 친 글자 뒤
        assertStudentCaretBehind(finalStudentChar);
      } finally {
        for (const p of peers) p.destroy();
      }
    },
  );
}

describe('편집기 바인딩 성질 시험 (fast-check, 기기 2~3개)', () => {
  it('재현 반례 회귀(seed -2059837136): 비초점 칸 선택 범위 오염 없이 Yjs clientID 순서와 무관하게 통과한다', () => {
    for (let i = 0; i < 16; i++) {
      fc.assert(makeEditorProperty(), {
        seed: -2059837136,
        path: '8:1:2:2:2:2:2:2:2:1:1:4:4:1:4:3:12:10:2:3:1:3:2:1:1:4:1:1:2:3:1:7:3:3:4:4:4:1:1:2:3:2:2:3:3:3:2:1:2',
        endOnFailure: true,
      });
    }
  });

  it('무작위 입력·조합·지우기·커서 이동·시간 진행(300회 × 30단계 이상) 뒤 수렴·viewDoc 일치·커서 보존', () => {
    const rawSeed = import.meta.env['VITE_FC_SEED'];
    const parsedSeed = rawSeed !== undefined && rawSeed !== '' ? Number(rawSeed) : NaN;
    fc.assert(makeEditorProperty(), {
      numRuns: 320,
      ...(Number.isInteger(parsedSeed) ? { seed: parsedSeed } : {}),
    });
  });
});
