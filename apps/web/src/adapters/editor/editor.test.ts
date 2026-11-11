import { defaultConfig } from '@geulbang/core/config';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { value } from '../../ports/observable.ts';
import type { SyncedDoc } from '../../ports/realtime.ts';
import { FakeClock } from '../../testing/fakeClock.ts';
import { mountEditor, type MountedEditor } from './editor.ts';

/**
 * 편집기 바인딩 시험(PLAN §10.3). 학생·교사 편집기를 메모리 중계로 잇는다(서버 없음).
 * "쓰기 0회 단언": 사용자 흉내가 아닌 입력칸 쓰기(setRangeText·setSelectionRange·value 설정·readOnly·focus)를
 * 세어, 반영 문이 닫혀 있어야 할 동안 0인지 본다.
 */

const config = defaultConfig;

interface Harness {
  readonly el: HTMLTextAreaElement;
  readonly editor: MountedEditor;
  readonly netDoc: Y.Doc;
  /** 편집기가 한 입력칸 쓰기 수 */
  writes(): number;
  type(text: string): void;
  /** 조합 단계마다 입력. `afterFirst`는 첫 단계 직후(조합 도중) 실행한다. */
  compose(steps: string[], afterFirst?: () => void): void;
  moveCaret(at: number): void;
}

const harnesses: Harness[] = [];
afterEach(() => {
  for (const h of harnesses.splice(0)) {
    h.editor.destroy();
    h.el.remove();
  }
});

function fakeSyncedDoc(netDoc: Y.Doc): SyncedDoc {
  return {
    docId: 'test',
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

/**
 * 학생과 교사 입력칸이 jsdom의 같은 문서에 있어 초점은 하나만 가질 수 있다. 실제로는 서로 다른 기기라,
 * 학생 칸에만 초점을 주고 교사 칸은 초점 없이 입력한다(초점이 없으면 바로 반영하는 것이 맞는 동작).
 */
function makeHarness(clock: FakeClock, netDoc: Y.Doc, role: 'student' | 'teacher'): Harness {
  const el = document.createElement('textarea');
  document.body.appendChild(el);
  let userActing = false;
  let writes = 0;
  const count = <T extends object>(target: T, name: string) => {
    const original = (target as Record<string, unknown>)[name] as (...args: unknown[]) => unknown;
    (target as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
      if (!userActing) writes++;
      return original.apply(this, args);
    };
  };
  count(el, 'setRangeText');
  count(el, 'setSelectionRange');
  count(el, 'focus');
  count(el, 'blur');
  const proto = Object.getPrototypeOf(el) as object;
  for (const prop of ['value', 'readOnly'] as const) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop)!;
    Object.defineProperty(el, prop, {
      configurable: true,
      get() {
        return desc.get!.call(el);
      },
      set(v: unknown) {
        if (!userActing) writes++;
        desc.set!.call(el, v);
      },
    });
  }

  const editor = mountEditor(
    { body: el },
    fakeSyncedDoc(netDoc),
    { role, readOnly: false, undoGroupMs: config.UNDO_GROUP_MS.normal, diagnosticsEnabled: true },
    { config, clock },
  );
  const asUser = (fn: () => void) => {
    userActing = true;
    try {
      fn();
    } finally {
      userActing = false;
    }
  };
  if (role === 'student') asUser(() => el.focus());
  writes = 0;

  const fire = (type: string, init: Record<string, unknown> = {}) => {
    const Ctor = type.startsWith('composition')
      ? CompositionEvent
      : type === 'keydown'
        ? KeyboardEvent
        : InputEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, ...init }));
  };

  const h: Harness = {
    el,
    editor,
    netDoc,
    writes: () => writes,
    // Safari처럼 조합 이벤트 없이 글자마다 input이 온다(커서 위치에 끼워 넣기).
    type(text) {
      for (const ch of text) {
        asUser(() => {
          const s = el.selectionStart;
          el.setRangeText(ch, s, el.selectionEnd, 'end');
        });
        fire('input', { inputType: 'insertText', data: ch });
        clock.advance(120);
      }
    },
    // Chromium·안드로이드처럼 조합 이벤트와 함께 같은 자리의 글자가 바뀐다(ㅎ → 하 → 한).
    compose(steps, afterFirst) {
      fire('compositionstart');
      let start = el.selectionStart;
      let prevLen = 0;
      for (const step of steps) {
        asUser(() => {
          el.setRangeText(step, start, start + prevLen, 'end');
        });
        prevLen = step.length;
        fire('compositionupdate', { data: step });
        fire('input', { inputType: 'insertCompositionText', data: step, isComposing: true });
        clock.advance(120);
        if (step === steps[0]) afterFirst?.();
      }
      fire('compositionend', { data: steps.at(-1) });
      start += prevLen;
    },
    moveCaret(at) {
      asUser(() => el.setSelectionRange(at, at));
      fire('keydown', { key: 'ArrowLeft' });
    },
  };
  harnesses.push(h);
  return h;
}

/** 두 통신용 문서를 서로 잇는다(서버 대신). */
function relay(a: Y.Doc, b: Y.Doc) {
  a.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(b, u, 'relay');
  });
  b.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(a, u, 'relay');
  });
}

function setup() {
  const clock = new FakeClock();
  const studentNet = new Y.Doc();
  const teacherNet = new Y.Doc();
  relay(studentNet, teacherNet);
  const student = makeHarness(clock, studentNet, 'student');
  const teacher = makeHarness(clock, teacherNet, 'teacher');
  return { clock, student, teacher };
}

describe('편집기 바인딩', () => {
  it('내 입력은 바로 통신용 문서로 간다(교사 화면은 실시간)', () => {
    const { student, teacher, clock } = setup();
    student.type('가나');
    expect(student.netDoc.getText('body').toString()).toBe('가나');
    clock.advance(600);
    expect(teacher.el.value).toBe('가나'); // 교사가 치고 있지 않으면 곧 반영
  });

  it('학생이 한글을 치는 동안 교사 변경을 보류하고, 그동안 입력칸 쓰기는 0회다', () => {
    const { student, teacher, clock } = setup();
    student.type('오늘은');
    clock.advance(600);
    teacher.moveCaret(0);
    teacher.type('제목: ');
    const before = student.writes();
    student.type('비가'); // 한글 뒤에서 계속 침 → 음절 경계 아님
    expect(student.el.value).toBe('오늘은비가');
    expect(student.writes()).toBe(before);
    expect(student.editor.pendingRemote()).toBe(true);
  });

  it('띄어쓰기 뒤 500ms에 반영하고, 커서는 학생이 쓴 글자 뒤에 남는다', () => {
    const { student, teacher, clock } = setup();
    student.type('오늘은');
    clock.advance(600);
    teacher.moveCaret(0);
    teacher.type('제목: ');
    student.type('비가 ');
    clock.advance(500);
    expect(student.el.value).toBe('제목: 오늘은비가 ');
    expect(student.el.selectionStart).toBe('제목: 오늘은비가 '.length);
    expect(student.editor.pendingRemote()).toBe(false);
  });

  it('조합이 열려 있으면 2초가 지나도 반영하지 않는다(3번), 끝나고 멈추면 반영한다', () => {
    const { student, teacher, clock } = setup();
    student.type('가');
    clock.advance(600);
    teacher.moveCaret(0);
    teacher.type('X');
    // 조합 시작만 하고 끝을 안 보낸 채 2초 → 아직 조합 중(5초 고착 전)
    student.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const before = student.writes();
    clock.advance(2500);
    expect(student.writes()).toBe(before);
    expect(student.el.value).toBe('가');
    student.el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    clock.advance(2000);
    expect(student.el.value).toBe('X가');
  });

  it('ㅎ→하→한 조합 도중 같은 문단의 교사 변경이 조합을 깨지 않는다', () => {
    const { student, teacher, clock } = setup();
    student.type('하늘 ');
    clock.advance(600);
    const before = student.writes();
    // 학생이 'ㅎ'를 친 직후(조합 도중) 교사가 같은 문단 앞에 끼워 넣는다
    student.compose(['ㅎ', '하', '한'], () => {
      teacher.moveCaret(0);
      teacher.type('맑은 ');
    });
    expect(student.writes()).toBe(before);
    expect(student.el.value).toBe('하늘 한');
    clock.advance(2100);
    expect(student.el.value).toBe('맑은 하늘 한');
    expect(student.netDoc.getText('body').toString()).toBe('맑은 하늘 한');
    expect(teacher.netDoc.getText('body').toString()).toBe('맑은 하늘 한');
  });

  it('학생의 되돌리기는 교사가 고친 것을 되돌리지 않는다', () => {
    const { student, teacher, clock } = setup();
    student.type('사과 ');
    clock.advance(600);
    teacher.moveCaret(0);
    teacher.type('빨간 ');
    clock.advance(600);
    expect(student.el.value).toBe('빨간 사과 ');
    student.editor.undo();
    expect(student.el.value).toBe('빨간 ');
    clock.advance(600);
    expect(teacher.el.value).toBe('빨간 ');
  });

  it('브라우저 기본 되돌리기 키는 동기로 막고, 반영 문이 열릴 때 Yjs 되돌리기로 처리한다', async () => {
    const { student, clock } = setup();
    student.type('가나');
    const before = student.writes();
    const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    student.el.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    // 방금 한글을 친 직후(반영 문 닫힘)에는 입력칸을 건드리지 않고, 음절 경계(2초) 뒤 되돌린다.
    expect(student.writes()).toBe(before);
    expect(student.el.value).toBe('가나');
    clock.advance(config.IME_LONG_IDLE_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(student.el.value).toBe('');
  });

  it('앱이 하는 변경은 한글 음절 경계(2초)까지 반영 문 열림을 기다린 뒤 한 번에 적용된다', async () => {
    const { student, clock } = setup();
    student.type('글');
    const before = student.writes();
    let done = false;
    const edit = student.editor
      .applyAppEdit(doc => doc.getText('body').insert(0, '[1절]\n'))
      .then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    // 한글 '글' 뒤 500ms는 아직 음절 경계 전이므로 닫혀 있어야 한다(쓰기 0회).
    clock.advance(500);
    await Promise.resolve();
    expect(done).toBe(false);
    expect(student.writes()).toBe(before);
    clock.advance(config.IME_LONG_IDLE_MS - 500);
    await edit;
    expect(student.el.value).toBe('[1절]\n글');
    expect(student.netDoc.getText('body').toString()).toBe('[1절]\n글');
  });

  it('여러 번 주고받아도 두 입력칸과 두 문서가 같은 글로 모인다', () => {
    const { student, teacher, clock } = setup();
    for (let round = 0; round < 5; round++) {
      student.type(`학생${round} `);
      teacher.moveCaret(0);
      teacher.type(`교사${round} `);
      clock.advance(2500);
    }
    clock.advance(2500);
    expect(student.el.value).toBe(teacher.el.value);
    expect(student.el.value).toBe(student.netDoc.getText('body').toString());
    expect(teacher.el.value).toBe(teacher.netDoc.getText('body').toString());
    expect(student.editor.viewDoc.getText('body').toString()).toBe(student.el.value);
  });

  it('진단 기록에 입력과 반영 문 판단이 남는다', () => {
    const { student, teacher, clock } = setup();
    student.type('가');
    teacher.type('나');
    clock.advance(3000);
    const types = new Set(student.editor.diagnostics.events().map(e => e.type));
    expect(types.has('input')).toBe(true);
    expect(types.has('flush')).toBe(true);
  });

  it('제목 칸에 초점이 있는 동안 비초점 본문 칸에 원격 치환이 반영돼도 단일 커서가 블록 선택으로 벌어지지 않는다', () => {
    const clock = new FakeClock();
    const studentNet = new Y.Doc();
    const teacherNet = new Y.Doc();
    relay(studentNet, teacherNet);

    const titleEl = document.createElement('input');
    const bodyEl = document.createElement('textarea');
    document.body.append(titleEl, bodyEl);
    const studentEditor = mountEditor(
      { body: bodyEl, title: titleEl },
      fakeSyncedDoc(studentNet),
      {
        role: 'student',
        readOnly: false,
        undoGroupMs: config.UNDO_GROUP_MS.normal,
        diagnosticsEnabled: false,
      },
      { config, clock },
    );
    harnesses.push({
      el: bodyEl,
      editor: studentEditor,
      netDoc: studentNet,
      writes: () => 0,
      type: () => {},
      compose: () => {},
      moveCaret: () => {},
    });

    try {
      // 학생이 본문에 '한글'을 쓰고 커서를 '한' 뒤(1..1)에 둔 뒤 제목 칸으로 초점을 옮긴다.
      bodyEl.focus();
      bodyEl.setRangeText('한글', 0, 0, 'end');
      bodyEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '한글' }));
      bodyEl.setSelectionRange(1, 1);
      titleEl.focus();
      clock.advance(config.IME_LONG_IDLE_MS);

      // 교사가 본문 맨 앞 '한'(0..1)을 지우고 '하나'(0..2)로 치환한다.
      // HTML 기본 `setRangeText('하나', 0, 1, 'preserve')`만 쓰면 비초점 본문 칸의 1..1 커서가 0..2 범위 선택이 된다.
      teacherNet.transact(() => {
        const body = teacherNet.getText('body');
        body.delete(0, 1);
        body.insert(0, '하나');
      }, 'teacher');

      expect(bodyEl.value).toBe('하나글');
      expect(bodyEl.selectionStart).toBe(bodyEl.selectionEnd);
      // 지워진 '한' 뒤(assoc = -1) 상대 위치이므로 새로 들어온 '하나' 앞(0) 또는 '글' 앞이되 절대 범위 선택이 아니다.
      expect(document.activeElement).toBe(titleEl);
    } finally {
      titleEl.remove();
    }
  });
});
