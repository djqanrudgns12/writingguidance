import { defaultConfig } from '@geulbang/core/config';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { value } from '../../ports/observable.ts';
import type { SyncedDoc } from '../../ports/realtime.ts';
import { FakeClock } from '../../testing/fakeClock.ts';
import { mountEditor, type MountedEditor } from './editor.ts';

/**
 * 반영 문이 닫혀 있는 동안 입력칸 쓰기 0회 단언 시험(PRD 9.3-11, PLAN §6.3·§10.3).
 * 감시 대상: `value` 설정, `setRangeText`, `setSelectionRange`, `focus`, `blur`, `readOnly` 설정,
 * 그리고 입력칸 요소의 분리·이동(DOM childList 변경).
 */

const config = defaultConfig;

export interface WriteCounts {
  value: number;
  setRangeText: number;
  setSelectionRange: number;
  focus: number;
  blur: number;
  readOnly: number;
  domMove: number;
  readonly total: number;
}

interface WatchedField<E extends HTMLTextAreaElement | HTMLInputElement> {
  readonly el: E;
  readonly counts: () => WriteCounts;
  readonly resetCounts: () => void;
  readonly asUser: (fn: () => void) => void;
  readonly disconnect: () => void;
}

function watchElement<E extends HTMLTextAreaElement | HTMLInputElement>(el: E): WatchedField<E> {
  let userActing = false;
  const log = {
    value: 0,
    setRangeText: 0,
    setSelectionRange: 0,
    focus: 0,
    blur: 0,
    readOnly: 0,
    domMove: 0,
  };

  const wrapMethod = (name: 'setRangeText' | 'setSelectionRange' | 'focus' | 'blur') => {
    const orig = el[name] as (...args: unknown[]) => unknown;
    (el as unknown as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
      if (!userActing) log[name]++;
      return orig.apply(this, args);
    };
  };
  wrapMethod('setRangeText');
  wrapMethod('setSelectionRange');
  wrapMethod('focus');
  wrapMethod('blur');

  const proto = Object.getPrototypeOf(el) as object;
  for (const prop of ['value', 'readOnly'] as const) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop)!;
    Object.defineProperty(el, prop, {
      configurable: true,
      get() {
        return desc.get!.call(el);
      },
      set(v: unknown) {
        if (!userActing) log[prop]++;
        desc.set!.call(el, v);
      },
    });
  }

  const observer = new MutationObserver(records => {
    for (const r of records) {
      for (const n of [...r.addedNodes, ...r.removedNodes]) {
        if (n === el && !userActing) log.domMove++;
      }
    }
  });
  if (el.parentElement) {
    observer.observe(el.parentElement, { childList: true });
  }

  return {
    el,
    counts: () => ({
      ...log,
      get total() {
        return (
          log.value +
          log.setRangeText +
          log.setSelectionRange +
          log.focus +
          log.blur +
          log.readOnly +
          log.domMove
        );
      },
    }),
    resetCounts: () => {
      log.value = 0;
      log.setRangeText = 0;
      log.setSelectionRange = 0;
      log.focus = 0;
      log.blur = 0;
      log.readOnly = 0;
      log.domMove = 0;
    },
    asUser: fn => {
      userActing = true;
      try {
        fn();
      } finally {
        userActing = false;
      }
    },
    disconnect: () => observer.disconnect(),
  };
}

const ZERO_COUNTS: WriteCounts = {
  value: 0,
  setRangeText: 0,
  setSelectionRange: 0,
  focus: 0,
  blur: 0,
  readOnly: 0,
  domMove: 0,
  total: 0,
};

function fakeSyncedDoc(netDoc: Y.Doc): SyncedDoc {
  return {
    docId: 'write-zero-test',
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

function relay(a: Y.Doc, b: Y.Doc): void {
  a.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(b, u, 'relay');
  });
  b.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(a, u, 'relay');
  });
}

interface TestRig {
  readonly clock: FakeClock;
  readonly studentBody: WatchedField<HTMLTextAreaElement>;
  readonly studentTitle: WatchedField<HTMLInputElement>;
  readonly studentMemo: WatchedField<HTMLTextAreaElement>;
  readonly studentEditor: MountedEditor;
  readonly studentNet: Y.Doc;
  readonly teacherNet: Y.Doc;
  readonly typeIn: (
    field: WatchedField<HTMLTextAreaElement | HTMLInputElement>,
    text: string,
    stepMs?: number,
  ) => void;
  readonly startCompose: (
    field: WatchedField<HTMLTextAreaElement | HTMLInputElement>,
    firstStep?: string,
  ) => void;
  readonly updateCompose: (
    field: WatchedField<HTMLTextAreaElement | HTMLInputElement>,
    replaceFrom: number,
    prevLen: number,
    step: string,
  ) => void;
  readonly endCompose: (
    field: WatchedField<HTMLTextAreaElement | HTMLInputElement>,
    finalData?: string,
  ) => void;
  readonly teacherInsertBody: (index: number, text: string) => void;
  readonly teacherInsertTitle: (index: number, text: string) => void;
  readonly resetAllCounts: () => void;
  readonly expectZeroWritesAll: () => void;
  readonly destroy: () => void;
}

const activeRigs: TestRig[] = [];
afterEach(() => {
  for (const r of activeRigs.splice(0)) r.destroy();
});

function setupRig(): TestRig {
  const clock = new FakeClock();
  const studentNet = new Y.Doc();
  const teacherNet = new Y.Doc();
  relay(studentNet, teacherNet);

  const container = document.createElement('div');
  const bodyEl = document.createElement('textarea');
  const titleEl = document.createElement('input');
  const memoEl = document.createElement('textarea');
  container.append(titleEl, bodyEl, memoEl);
  document.body.appendChild(container);

  const studentBody = watchElement(bodyEl);
  const studentTitle = watchElement(titleEl);
  const studentMemo = watchElement(memoEl);

  const studentEditor = mountEditor(
    {
      body: bodyEl,
      title: titleEl,
      memos: new Map([['q1', memoEl]]),
    },
    fakeSyncedDoc(studentNet),
    { role: 'student', readOnly: false, undoGroupMs: config.UNDO_GROUP_MS.normal, diagnosticsEnabled: true },
    { config, clock },
  );

  studentBody.asUser(() => bodyEl.focus());
  studentBody.resetCounts();
  studentTitle.resetCounts();
  studentMemo.resetCounts();

  const fire = (
    el: HTMLTextAreaElement | HTMLInputElement,
    type: string,
    init: Record<string, unknown> = {},
  ) => {
    const Ctor = type.startsWith('composition')
      ? CompositionEvent
      : type === 'keydown'
        ? KeyboardEvent
        : InputEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, ...init }));
  };

  const rig: TestRig = {
    clock,
    studentBody,
    studentTitle,
    studentMemo,
    studentEditor,
    studentNet,
    teacherNet,
    typeIn(field, text, stepMs = 100) {
      for (const ch of text) {
        field.asUser(() => {
          const s = field.el.selectionStart ?? 0;
          const e = field.el.selectionEnd ?? s;
          field.el.setRangeText(ch, s, e, 'end');
        });
        fire(field.el, 'input', { inputType: 'insertText', data: ch });
        if (stepMs > 0) clock.advance(stepMs);
      }
    },
    startCompose(field, firstStep) {
      fire(field.el, 'compositionstart');
      if (firstStep !== undefined) {
        const s = field.el.selectionStart ?? 0;
        field.asUser(() => field.el.setRangeText(firstStep, s, s, 'end'));
        fire(field.el, 'compositionupdate', { data: firstStep });
        fire(field.el, 'input', { inputType: 'insertCompositionText', data: firstStep, isComposing: true });
      }
    },
    updateCompose(field, replaceFrom, prevLen, step) {
      field.asUser(() => field.el.setRangeText(step, replaceFrom, replaceFrom + prevLen, 'end'));
      fire(field.el, 'compositionupdate', { data: step });
      fire(field.el, 'input', { inputType: 'insertCompositionText', data: step, isComposing: true });
    },
    endCompose(field, finalData = '') {
      fire(field.el, 'compositionend', { data: finalData });
    },
    teacherInsertBody(index, text) {
      teacherNet.transact(() => {
        teacherNet.getText('body').insert(index, text);
      }, 'teacher');
    },
    teacherInsertTitle(index, text) {
      teacherNet.transact(() => {
        teacherNet.getText('title').insert(index, text);
      }, 'teacher');
    },
    resetAllCounts() {
      studentBody.resetCounts();
      studentTitle.resetCounts();
      studentMemo.resetCounts();
    },
    expectZeroWritesAll() {
      expect(studentBody.counts()).toEqual(ZERO_COUNTS);
      expect(studentTitle.counts()).toEqual(ZERO_COUNTS);
      expect(studentMemo.counts()).toEqual(ZERO_COUNTS);
    },
    destroy() {
      studentEditor.destroy();
      studentBody.disconnect();
      studentTitle.disconnect();
      studentMemo.disconnect();
      container.remove();
    },
  };

  activeRigs.push(rig);
  return rig;
}

describe('반영 문이 닫혀 있는 동안 입력칸 쓰기 0회 단언 (PRD 9.3-11, PLAN §10.3)', () => {
  it('사례 1(조합 중): ㅎ→하→한 조합 도중과 5초 고착 직전(4999ms)까지 원격 변경이 와도 모든 쓰기가 0회다', () => {
    const rig = setupRig();
    rig.typeIn(rig.studentBody, '봄 ', 100);
    rig.clock.advance(600);
    rig.resetAllCounts();

    const composeAt = rig.studentBody.el.selectionStart;
    rig.startCompose(rig.studentBody, 'ㅎ');
    rig.teacherInsertBody(0, '[교사 머리말] ');
    rig.teacherInsertTitle(0, '새 제목');
    rig.expectZeroWritesAll();

    rig.clock.advance(150);
    rig.updateCompose(rig.studentBody, composeAt, 1, '하');
    rig.teacherInsertBody(rig.teacherNet.getText('body').length, ' [교사 꼬리말]');
    rig.expectZeroWritesAll();

    rig.clock.advance(150);
    rig.updateCompose(rig.studentBody, composeAt, 1, '한');
    rig.expectZeroWritesAll();

    // 마지막 조합 입력 뒤 4999ms(5초 고착 1ms 전)까지도 쓰기 0회
    rig.clock.advance(config.IME_STUCK_MS - 1);
    rig.expectZeroWritesAll();
    expect(rig.studentBody.el.value).toBe('봄 한');
    expect(rig.studentTitle.el.value).toBe('');

    // 조합이 끝나고 2초가 지나면 비로소 반영
    rig.endCompose(rig.studentBody, '한');
    rig.clock.advance(config.IME_LONG_IDLE_MS - 1);
    rig.expectZeroWritesAll();

    rig.clock.advance(1);
    expect(rig.studentBody.el.value).toBe(rig.studentNet.getText('body').toString());
    expect(rig.studentBody.el.value).toContain('[교사 머리말] ');
    expect(rig.studentBody.el.value).toContain('[교사 꼬리말]');
    expect(rig.studentBody.el.value).toContain('한');
    expect(rig.studentTitle.el.value).toBe('새 제목');
  });

  it.each([
    ['완성형 한글(한)', '한'],
    ['완성형 한글(가)', '가'],
    ['호환 자모(ㄱ)', 'ㄱ'],
    ['첫가끝 자모(ᄀ)', '\u1100'],
    ['확장 자모 A(ꥠ)', '\ua960'],
    ['확장 자모 B(ힰ)', '\ud7b0'],
  ])('사례 2(한글 뒤 500ms~2초): %s 입력 뒤 0ms·499ms·500ms·501ms·1999ms 동안 쓰기가 0회다', (_label, ch) => {
    const rig = setupRig();
    rig.typeIn(rig.studentBody, ch, 0);
    rig.resetAllCounts();

    rig.teacherInsertBody(0, '앞-');
    rig.expectZeroWritesAll();

    // 499ms (500ms - 1ms)
    rig.clock.advance(config.IME_IDLE_MS - 1);
    rig.expectZeroWritesAll();

    // 500ms (정각: idle은 지났으나 음절 경계가 아니므로 닫혀 있음)
    rig.clock.advance(1);
    rig.expectZeroWritesAll();

    // 501ms (500ms + 1ms)
    rig.clock.advance(1);
    rig.expectZeroWritesAll();

    // 1999ms (2초 - 1ms)
    rig.clock.advance(config.IME_LONG_IDLE_MS - config.IME_IDLE_MS - 2);
    expect(rig.clock.t).toBe(config.IME_LONG_IDLE_MS - 1);
    rig.expectZeroWritesAll();
    expect(rig.studentBody.el.value).toBe(ch);

    // 2000ms 정각에 반영
    rig.clock.advance(1);
    expect(rig.studentBody.el.value).toBe(`앞-${ch}`);
  });

  it('사례 3(쉬지 않고 치는 10초 동안): 250ms 간격으로 12초 동안 계속 치면 보류 알림이 켜지고 10초가 지나도 쓰기가 0회다', () => {
    const rig = setupRig();
    const holdStates: boolean[] = [];
    rig.studentEditor.onHoldChange(h => holdStates.push(h));

    // 첫 글자 입력 직후 교사가 수정 → 보류 시작(t = 0)
    rig.typeIn(rig.studentBody, '가', 0);
    rig.resetAllCounts();
    rig.teacherInsertBody(0, '선생님: ');
    rig.expectZeroWritesAll();

    // 250ms 간격(< 300ms 완화된 멈춤)으로 12초(48회) 동안 쉬지 않고 입력
    const syllables = ['나', '다', '라', '마', '바', '사', '아', '자'];
    for (let i = 0; i < 48; i++) {
      rig.clock.advance(250);
      rig.typeIn(rig.studentBody, syllables[i % syllables.length]!, 0);
      if (i % 10 === 0) rig.teacherInsertBody(0, '!');
      rig.expectZeroWritesAll();
    }

    expect(rig.clock.t).toBe(12_000);
    expect(holdStates).toEqual([true]); // 3초에 보류 알림 켜짐
    expect(rig.studentEditor.pendingRemote()).toBe(true);

    // 멈춘 뒤 299ms(300ms - 1ms)까지도 쓰기 0회
    rig.clock.advance(config.IME_RELAXED_IDLE_MS - 1);
    rig.expectZeroWritesAll();

    // 300ms 정각에 반영되고 보류 알림 꺼짐
    rig.clock.advance(1);
    expect(rig.studentEditor.pendingRemote()).toBe(false);
    expect(holdStates).toEqual([true, false]);
    expect(rig.studentBody.el.value.startsWith('!!!!!선생님: 가나다라마바사아')).toBe(true);
  });

  it('사례 4(다른 칸 조합): 본문은 멈춰 있어도 메모나 제목 칸이 조합 중이면 모든 칸의 쓰기가 0회다', () => {
    const rig = setupRig();
    rig.typeIn(rig.studentBody, '본문입니다. ', 100);
    rig.clock.advance(600);
    rig.resetAllCounts();

    // 메모 칸에서 조합 시작
    rig.startCompose(rig.studentMemo, 'ㅁ');
    rig.teacherInsertBody(0, '교사 추가 ');
    rig.teacherInsertTitle(0, '교사 제목');

    rig.clock.advance(config.IME_STUCK_MS - 1);
    rig.expectZeroWritesAll();

    // 메모 조합이 끝나고 본문(초점 칸)은 이미 충분히 멈춘 상태이므로 즉시 반영
    rig.endCompose(rig.studentMemo, '메');
    expect(rig.studentBody.el.value).toBe('교사 추가 본문입니다. ');
    expect(rig.studentTitle.el.value).toBe('교사 제목');
  });

  it('사례 5(닫힌 동안 undo·redo 호출): 조합 중에는 undo()·redo()·단축키·beforeinput을 불러도 쓰기가 0회다', () => {
    const rig = setupRig();
    rig.typeIn(rig.studentBody, '첫단어 ', 100);
    rig.clock.advance(config.UNDO_GROUP_MS.normal + 200);
    rig.resetAllCounts();

    // 조합 시작 후 교사 원격 변경 도착
    rig.startCompose(rig.studentBody, 'ㅎ');
    rig.teacherInsertBody(0, '교사: ');
    rig.expectZeroWritesAll();

    // 조합 중에 undo / redo 메서드 직접 호출
    rig.studentEditor.undo();
    rig.studentEditor.redo();
    rig.expectZeroWritesAll();

    // 조합 중에 Ctrl+Z keydown 및 historyUndo beforeinput 발생
    rig.studentBody.el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    rig.studentBody.el.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'historyUndo',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    rig.expectZeroWritesAll();
    expect(rig.studentBody.el.value).toBe('첫단어 ㅎ');
  });

  it('사례 6(조합 중 applyAppEdit·setReadOnly·select 호출): 조합이 열린 동안에는 대기하며 쓰기가 0회다', async () => {
    const rig = setupRig();
    rig.typeIn(rig.studentBody, '노래 ', 100);
    rig.clock.advance(600);
    rig.resetAllCounts();

    rig.startCompose(rig.studentBody, 'ㄱ');
    rig.teacherInsertBody(0, '(전주) ');

    let appEditResolved = false;
    let selectResolved = false;
    const appEditPromise = rig.studentEditor
      .applyAppEdit(doc => doc.getText('body').insert(0, '[1절] '))
      .then(() => {
        appEditResolved = true;
      });
    rig.studentEditor.setReadOnly(true);
    const selectPromise = rig.studentEditor.select({ field: 'body', start: 0, end: 2 }).then(() => {
      selectResolved = true;
    });

    // 조합이 열려 있는 동안(4999ms까지) 마이크로태스크를 비워도 쓰기 0회
    rig.clock.advance(config.IME_STUCK_MS - 1);
    await Promise.resolve();
    await Promise.resolve();

    rig.expectZeroWritesAll();
    expect(appEditResolved).toBe(false);
    expect(selectResolved).toBe(false);
    expect(rig.studentBody.el.readOnly).toBe(false);

    // 조합을 끝내도 499ms까지는 아직 대기하며 쓰기 0회
    rig.updateCompose(rig.studentBody, 3, 1, '가');
    rig.endCompose(rig.studentBody, '가');
    rig.clock.advance(config.IME_IDLE_MS - 1);
    await Promise.resolve();
    rig.expectZeroWritesAll();
    expect(appEditResolved).toBe(false);
    expect(selectResolved).toBe(false);

    // 500ms 정각: 조합은 끝났지만 한글 '가' 뒤라 음절 경계 전이다. 앱이 하는 변경·선택·읽기 전용 바꾸기는
    // 모두 반영 문이 완전히 열릴 때까지 기다리고 그 전에는 쓰지 않는다(PRD 9.3-11, ADR-054).
    rig.clock.advance(1);
    await Promise.resolve();
    await Promise.resolve();
    rig.expectZeroWritesAll();
    expect(appEditResolved).toBe(false);
    expect(selectResolved).toBe(false);
    expect(rig.studentBody.el.readOnly).toBe(false);
    // 마지막 입력 뒤 IME_LONG_IDLE_MS(2초)가 되면 한꺼번에 적용된다.
    rig.clock.advance(config.IME_LONG_IDLE_MS - config.IME_IDLE_MS);
    await Promise.all([appEditPromise, selectPromise]);
    expect(appEditResolved).toBe(true);
    expect(selectResolved).toBe(true);
    expect(rig.studentBody.el.readOnly).toBe(true);
    expect(rig.studentBody.el.value).toBe('[1절] (전주) 노래 가');
    expect(rig.studentBody.el.selectionStart).toBe(0);
    expect(rig.studentBody.el.selectionEnd).toBe(2);
  });

  it('사례 7(쉬지 않고 치는 10초 동안 applyAppEdit·setReadOnly·select 호출): 500ms 멈춤 전까지 10초 내내 쓰기가 0회다', async () => {
    const rig = setupRig();
    rig.typeIn(rig.studentBody, '시작', 0);
    rig.resetAllCounts();

    rig.teacherInsertBody(0, '머리: ');
    const editDone = rig.studentEditor.applyAppEdit(doc => doc.getText('body').insert(0, '[도입] '));
    rig.studentEditor.setReadOnly(true);
    const selectDone = rig.studentEditor.select({ field: 'body', start: 0, end: 1 });

    // 250ms 간격(< 300ms IME_RELAXED_IDLE_MS)으로 10.5초(42회) 동안 계속 입력
    for (let i = 0; i < 42; i++) {
      rig.clock.advance(250);
      rig.typeIn(rig.studentBody, '가', 0);
      await Promise.resolve();
      rig.expectZeroWritesAll();
      expect(rig.studentBody.el.readOnly).toBe(false);
    }

    expect(rig.clock.t).toBe(10_500);
    // 마지막 입력 뒤 299ms(300ms - 1ms)까지도 원격 반영·whenIdle 모두 대기하며 쓰기 0회
    rig.clock.advance(config.IME_RELAXED_IDLE_MS - 1);
    await Promise.resolve();
    rig.expectZeroWritesAll();

    // 멈춤이 500ms를 채우면 모두 완료
    rig.clock.advance(config.IME_IDLE_MS - (config.IME_RELAXED_IDLE_MS - 1));
    await Promise.all([editDone, selectDone]);
    expect(rig.studentBody.el.readOnly).toBe(true);
    expect(rig.studentBody.el.value.startsWith('[도입] 머리: 시작')).toBe(true);
  });

  it('사례 8(10초 완화 뒤에도 조합이 열려 있는 동안): 10초가 지났어도 조합 중이면 원격 변경·undo·applyAppEdit·setReadOnly·select 모두 쓰기 0회다', async () => {
    const rig = setupRig();
    rig.typeIn(rig.studentBody, '본문 ', 0);
    rig.resetAllCounts();

    rig.teacherInsertBody(0, '교사: ');
    // 250ms 간격으로 10초 동안 입력하여 보류 10초 완화 구간에 진입
    for (let i = 0; i < 40; i++) {
      rig.clock.advance(250);
      rig.typeIn(rig.studentBody, '가', 0);
      rig.expectZeroWritesAll();
    }
    expect(rig.clock.t).toBe(config.IME_MAX_HOLD_MS);

    // 10초가 지난 시점에 조합 시작
    rig.startCompose(rig.studentBody, 'ㅎ');
    rig.studentEditor.undo();
    const editPromise = rig.studentEditor.applyAppEdit(doc => doc.getText('body').insert(0, '[추가] '));
    rig.studentEditor.setReadOnly(true);
    const selectPromise = rig.studentEditor.select({ field: 'body', start: 0, end: 2 });

    // 조합이 열려 있으면 300ms·2000ms·4999ms가 지나도 쓰기 0회
    rig.clock.advance(config.IME_RELAXED_IDLE_MS);
    await Promise.resolve();
    rig.expectZeroWritesAll();

    rig.clock.advance(config.IME_STUCK_MS - config.IME_RELAXED_IDLE_MS - 1);
    await Promise.resolve();
    rig.expectZeroWritesAll();
    expect(rig.studentBody.el.readOnly).toBe(false);

    // 5000ms 고착 해제 정각에 반영
    rig.clock.advance(1);
    await Promise.all([editPromise, selectPromise]);
    expect(rig.studentBody.el.readOnly).toBe(true);
    expect(rig.studentBody.el.value.startsWith('[추가] 교사: 본문 ')).toBe(true);
  });

  it('사례 9(입력 직후 499ms 동안 개별 호출): 공백 뒤라도 500ms 전에는 applyAppEdit·setReadOnly·select가 쓰기를 하지 않는다', async () => {
    const rig = setupRig();
    rig.typeIn(rig.studentBody, '안녕 ', 0);
    rig.resetAllCounts();

    const editPromise = rig.studentEditor.applyAppEdit(doc => doc.getText('body').insert(0, '머리 '));
    rig.studentEditor.setReadOnly(true);
    const selectPromise = rig.studentEditor.select({ field: 'body', start: 0, end: 2 });

    rig.clock.advance(config.IME_IDLE_MS - 1); // 499ms
    await Promise.resolve();
    await Promise.resolve();
    rig.expectZeroWritesAll();
    expect(rig.studentBody.el.readOnly).toBe(false);

    rig.clock.advance(1); // 500ms
    await Promise.all([editPromise, selectPromise]);
    expect(rig.studentBody.el.readOnly).toBe(true);
    expect(rig.studentBody.el.value).toBe('머리 안녕 ');
  });
});
