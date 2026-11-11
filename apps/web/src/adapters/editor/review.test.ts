import { DOC_KEYS } from '@geulbang/core';
import { defaultConfig } from '@geulbang/core/config';
import { codePointBefore, isHangulCodePoint } from '@geulbang/core/text';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { value } from '../../ports/observable.ts';
import type { SyncedDoc } from '../../ports/realtime.ts';
import { FakeClock } from '../../testing/fakeClock.ts';
import { mountEditor, type MountedEditor } from './editor.ts';
import { decide, type FieldState } from './gate.ts';

/**
 * P2-7 편집기 독립 검토(`docs/reviews/P2-7_editor_review.md`) "덧붙일 시험 목록" 1~6번 회귀 시험.
 */

const config = defaultConfig;

type ManagedCleanup = () => void;
const cleanups: ManagedCleanup[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const fn of cleanups.splice(0)) fn();
});

function fakeSyncedDoc(netDoc: Y.Doc, awareness: SyncedDoc['awareness'] = null): SyncedDoc {
  return {
    docId: 'review-test',
    netDoc,
    awareness,
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

function relay(a: Y.Doc, b: Y.Doc): () => void {
  const forwardA = (u: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(b, u, 'relay');
  };
  const forwardB = (u: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(a, u, 'relay');
  };
  a.on('update', forwardA);
  b.on('update', forwardB);
  return () => {
    a.off('update', forwardA);
    b.off('update', forwardB);
  };
}

function fireEvent(el: HTMLElement, type: string, init: Record<string, unknown> = {}): boolean {
  const Ctor = type.startsWith('composition')
    ? CompositionEvent
    : type === 'keydown' || type === 'keyup'
      ? KeyboardEvent
      : InputEvent;
  return el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...init }));
}

describe('1. 상시 "문 닫힘 중 쓰기 0회" 감시기 시험 (jsdom)', () => {
  it('조합 중·멈춤 전·한글 음절 경계 전(600ms)에 원격 변경·setReadOnly·select·undo·redo·applyAppEdit·bindMemo를 모두 호출해도 닫힌 동안 쓰기 위반이 0회다', async () => {
    const clock = new FakeClock();
    const studentNet = new Y.Doc();
    const teacherNet = new Y.Doc();
    cleanups.push(relay(studentNet, teacherNet));

    const parent = document.createElement('div');
    const titleEl = document.createElement('input');
    const bodyEl = document.createElement('textarea');
    const memoEl = document.createElement('textarea');
    parent.append(titleEl, bodyEl, memoEl);
    document.body.appendChild(parent);

    let userActing = false;
    let guardEnabled = false;
    let holdSince: number | null = null;
    const violations: string[] = [];

    // DOM 상태를 독립 추적해 `decide().open === false`인 동안 모든 쓰기를 즉시 잡는다.
    const stateMap = new Map<
      HTMLTextAreaElement | HTMLInputElement,
      { composing: boolean; lastActivityAt: number; caretMovedByUser: boolean }
    >();
    const registerState = (el: HTMLTextAreaElement | HTMLInputElement) => {
      const st = { composing: false, lastActivityAt: -1e9, caretMovedByUser: false };
      stateMap.set(el, st);
      el.addEventListener('compositionstart', () => {
        st.composing = true;
        st.lastActivityAt = clock.t;
      });
      el.addEventListener('compositionupdate', () => {
        st.lastActivityAt = clock.t;
      });
      el.addEventListener('compositionend', () => {
        st.composing = false;
        st.lastActivityAt = clock.t;
      });
      el.addEventListener('input', e => {
        if (!userActing) return;
        const ie = e as InputEvent;
        if (st.composing && !ie.isComposing && ie.inputType !== 'insertCompositionText') {
          st.composing = false;
        }
        st.caretMovedByUser = false;
        st.lastActivityAt = clock.t;
      });
      el.addEventListener('blur', () => {
        st.composing = false;
      });
    };

    const isGateCurrentlyOpen = (): boolean => {
      const states: FieldState[] = [...stateMap.entries()].map(([el, st]) => ({
        composing: st.composing,
        lastActivityAt: st.lastActivityAt,
        caretMovedByUser: st.caretMovedByUser,
        focused: document.activeElement === el,
        charBeforeCaret: () => codePointBefore(el.value, el.selectionStart ?? 0),
        charBeforeSelectionEnd: () => {
          const s = el.selectionStart ?? 0;
          const e = el.selectionEnd ?? s;
          return s === e ? undefined : codePointBefore(el.value, e);
        },
      }));
      return decide(states, holdSince, clock.t, config).open;
    };

    const guardElement = (label: string, el: HTMLTextAreaElement | HTMLInputElement) => {
      registerState(el);
      const recordViolation = (op: string) => {
        if (!guardEnabled || userActing) return;
        if (!isGateCurrentlyOpen()) {
          const msg = `문 닫힘 중 쓰기 위반: ${label}.${op} @${clock.t}ms`;
          violations.push(msg);
          throw new Error(msg);
        }
      };

      for (const method of ['setRangeText', 'setSelectionRange', 'focus', 'blur'] as const) {
        const orig = el[method] as (...args: unknown[]) => unknown;
        (el as unknown as Record<string, unknown>)[method] = function (this: unknown, ...args: unknown[]) {
          recordViolation(method);
          return orig.apply(this, args);
        };
      }

      const proto = Object.getPrototypeOf(el) as object;
      for (const prop of ['value', 'readOnly', 'selectionStart', 'selectionEnd'] as const) {
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (!desc?.get || !desc.set) continue;
        Object.defineProperty(el, prop, {
          configurable: true,
          get() {
            return desc.get!.call(el);
          },
          set(v: unknown) {
            recordViolation(`set ${prop}`);
            desc.set!.call(el, v);
          },
        });
      }
    };

    guardElement('title', titleEl);
    guardElement('body', bodyEl);
    guardElement('memo:q1', memoEl);

    const observer = new MutationObserver(records => {
      if (!guardEnabled || userActing) return;
      for (const r of records) {
        for (const node of [...r.addedNodes, ...r.removedNodes]) {
          if ((node === titleEl || node === bodyEl || node === memoEl) && !isGateCurrentlyOpen()) {
            const msg = `문 닫힘 중 DOM 이동 위반 @${clock.t}ms`;
            violations.push(msg);
            throw new Error(msg);
          }
        }
      }
    });
    observer.observe(parent, { childList: true });

    const editor: MountedEditor = mountEditor(
      { body: bodyEl, title: titleEl, memos: new Map([['q1', memoEl]]) },
      fakeSyncedDoc(studentNet),
      {
        role: 'student',
        readOnly: false,
        undoGroupMs: config.UNDO_GROUP_MS.normal,
        diagnosticsEnabled: true,
      },
      { config, clock },
    );

    cleanups.push(() => {
      observer.disconnect();
      editor.destroy();
      parent.remove();
    });

    const asUser = (fn: () => void) => {
      userActing = true;
      try {
        fn();
      } finally {
        userActing = false;
      }
    };

    asUser(() => bodyEl.focus());
    guardEnabled = true;

    // 1단계: 첫 단어 확정 후 Undo 스택 마련
    asUser(() => {
      bodyEl.setRangeText('시작 ', 0, 0, 'end');
      fireEvent(bodyEl, 'input', { inputType: 'insertText', data: '시작 ' });
    });
    clock.advance(1000);

    // 2단계: Safari처럼 조합 이벤트 없이 한글 '한'을 치고 600ms 멈춤(500ms는 지났으나 음절 경계 전이라 닫힘!)
    asUser(() => {
      const s = bodyEl.selectionStart;
      bodyEl.setRangeText('한', s, s, 'end');
      fireEvent(bodyEl, 'input', { inputType: 'insertText', data: '한' });
    });
    clock.advance(600);
    expect(isGateCurrentlyOpen()).toBe(false);

    // 닫혀 있는 600ms 시점에 원격 변경·되돌리기·앱 편집·선택·읽기 전용·동적 메모 등록을 모두 호출
    holdSince = clock.t;
    teacherNet.transact(() => {
      teacherNet.getText(DOC_KEYS.body).insert(0, '[교사] ');
      teacherNet.getText(DOC_KEYS.title).insert(0, '교사 제목');
    }, 'teacher');

    const ctrlZ = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    bodyEl.dispatchEvent(ctrlZ);
    expect(ctrlZ.defaultPrevented).toBe(true);

    editor.redo();
    const editPromise = editor.applyAppEdit(doc => doc.getText(DOC_KEYS.body).insert(0, '[1절] '));
    const selectPromise = editor.select({ field: 'body', start: 0, end: 2 });
    editor.setReadOnly(true);

    // 동적 메모 칸을 본문 음절 보호 중에 붙여도 기존 칸 쓰기는 0회여야 한다.
    const dynamicMemo = document.createElement('textarea');
    asUser(() => parent.appendChild(dynamicMemo));
    const unbindDynamic = editor.bindMemo('q2', dynamicMemo);

    await Promise.resolve();
    await Promise.resolve();
    expect(violations).toEqual([]);
    expect(bodyEl.readOnly).toBe(false);
    expect(bodyEl.value).toBe('시작 한');

    // 1999ms(음절 경계 1ms 전)까지도 위반 0회
    clock.advance(config.IME_LONG_IDLE_MS - 600 - 1);
    await Promise.resolve();
    expect(violations).toEqual([]);
    expect(bodyEl.readOnly).toBe(false);

    // 2000ms 정각에 문이 열리고 대기 작업들이 모두 안전하게 완료됨
    clock.advance(1);
    holdSince = null;
    await Promise.all([editPromise, selectPromise]);
    await Promise.resolve();
    expect(violations).toEqual([]);
    expect(bodyEl.readOnly).toBe(true);
    expect(titleEl.value).toBe('교사 제목');
    expect(bodyEl.value).toContain('[1절] ');
    expect(bodyEl.value).toContain('[교사] ');
    unbindDynamic();
  });

  it('whenOpen으로 깨어난 같은 틱에 새 조합이나 한글 입력이 시작되면 마이크로태스크 재확인에서 실행을 미룬다', async () => {
    const clock = new FakeClock();
    const netDoc = new Y.Doc();
    const bodyEl = document.createElement('textarea');
    document.body.appendChild(bodyEl);

    const editor = mountEditor(
      { body: bodyEl },
      fakeSyncedDoc(netDoc),
      {
        role: 'student',
        readOnly: false,
        undoGroupMs: config.UNDO_GROUP_MS.normal,
        diagnosticsEnabled: false,
      },
      { config, clock },
    );
    cleanups.push(() => {
      editor.destroy();
      bodyEl.remove();
    });

    bodyEl.focus();
    bodyEl.setRangeText('가 ', 0, 0, 'end');
    fireEvent(bodyEl, 'input', { inputType: 'insertText', data: ' ' });

    let resolved = false;
    const editDone = editor
      .applyAppEdit(doc => doc.getText(DOC_KEYS.body).insert(0, '앞 '))
      .then(() => {
        resolved = true;
      });
    editor.setReadOnly(true);

    // 500ms 정각 타이머가 울려 resolve()를 예약한 직후, 마이크로태스크가 돌기 전에 같은 동기 블록에서 새 조합이 시작됨
    clock.advance(config.IME_IDLE_MS);
    fireEvent(bodyEl, 'compositionstart');
    await Promise.resolve();
    await Promise.resolve();

    // 깨어난 마이크로태스크가 `gate.isOpenNow()` 재확인에서 닫힘을 감지해 쓰기를 미뤄야 한다.
    expect(resolved).toBe(false);
    expect(bodyEl.readOnly).toBe(false);
    expect(bodyEl.value).toBe('가 ');

    // 조합이 끝나고 공백 뒤 500ms가 지나야 비로소 적용된다.
    fireEvent(bodyEl, 'compositionend');
    clock.advance(config.IME_IDLE_MS);
    await editDone;
    expect(resolved).toBe(true);
    expect(bodyEl.readOnly).toBe(true);
    expect(bodyEl.value).toBe('앞 가 ');
  });
});

describe('2. 비동기 selectionchange 흉내 시험 (jsdom)', () => {
  it('flush 직후 비동기 selectionchange가 와도 caretMovedByUser가 켜지지 않고, 다른 칸만 바뀐 flush에서는 초점 칸 setSelectionRange를 부르지 않는다', () => {
    const clock = new FakeClock();
    const studentNet = new Y.Doc();
    const teacherNet = new Y.Doc();
    cleanups.push(relay(studentNet, teacherNet));

    const titleEl = document.createElement('input');
    const bodyEl = document.createElement('textarea');
    document.body.append(titleEl, bodyEl);

    let bodySetSelectionCalls = 0;
    const origSetRange = bodyEl.setRangeText.bind(bodyEl);
    const origSetSel = bodyEl.setSelectionRange.bind(bodyEl);
    bodyEl.setRangeText = ((...args: Parameters<HTMLTextAreaElement['setRangeText']>) => {
      origSetRange(...args);
      clock.setTimer(() => document.dispatchEvent(new Event('selectionchange')), 10);
    }) as HTMLTextAreaElement['setRangeText'];
    bodyEl.setSelectionRange = ((...args: Parameters<HTMLTextAreaElement['setSelectionRange']>) => {
      bodySetSelectionCalls++;
      origSetSel(...args);
      clock.setTimer(() => document.dispatchEvent(new Event('selectionchange')), 10);
    }) as HTMLTextAreaElement['setSelectionRange'];

    const editor = mountEditor(
      { body: bodyEl, title: titleEl },
      fakeSyncedDoc(studentNet),
      {
        role: 'student',
        readOnly: false,
        undoGroupMs: config.UNDO_GROUP_MS.normal,
        diagnosticsEnabled: true,
      },
      { config, clock },
    );
    cleanups.push(() => {
      editor.destroy();
      titleEl.remove();
      bodyEl.remove();
    });

    bodyEl.focus();

    // ① 학생이 한글 '한'을 치고 60ms 늦게 입력 에코 selectionchange가 도착하는 상황(저사양 태블릿 프레임 지연)
    origSetRange('한', 0, 0, 'end');
    fireEvent(bodyEl, 'input', { inputType: 'insertText', data: '한' });
    clock.setTimer(() => document.dispatchEvent(new Event('selectionchange')), 60);

    clock.advance(60); // 에코 selectionchange 도착
    teacherNet.transact(() => teacherNet.getText(DOC_KEYS.body).insert(0, '교사 '), 'teacher');

    // 만약 60ms 에코를 사용자 커서 이동으로 오판했다면 600ms 시점에 조기 flush가 일어나 조합이 깨진다.
    clock.advance(540); // 입력 후 600ms
    expect(editor.pendingRemote()).toBe(true);
    expect(bodyEl.value).toBe('한');

    // 2000ms 음절 경계가 되어서야 안전하게 flush된다.
    clock.advance(1400);
    expect(editor.pendingRemote()).toBe(false);
    expect(bodyEl.value).toBe('교사 한');

    // flush 직후 비동기 selectionchange 에코(10ms 뒤)가 도착한 뒤 새 한글 '글'을 치고 600ms 멈춰도 여전히 음절 보호됨
    clock.advance(20);
    const s = bodyEl.selectionStart;
    origSetRange('글', s, s, 'end');
    fireEvent(bodyEl, 'input', { inputType: 'insertText', data: '글' });
    teacherNet.transact(() => teacherNet.getText(DOC_KEYS.title).insert(0, '새 제목'), 'teacher');

    bodySetSelectionCalls = 0;
    clock.advance(600);
    expect(editor.pendingRemote()).toBe(true);

    // ② 제목 칸만 바뀐 flush에서는 초점 있는 본문 칸의 선택이 그대로이므로 setSelectionRange 호출이 0회다.
    clock.advance(1400);
    expect(editor.pendingRemote()).toBe(false);
    expect(titleEl.value).toBe('새 제목');
    expect(bodySetSelectionCalls).toBe(0);

    // ③ 실제 사용자가 커서 위치를 옮겨 selectionchange가 오면 500ms 뒤에 문을 연다.
    const nextPos = bodyEl.selectionStart;
    origSetRange('나', nextPos, nextPos, 'end');
    fireEvent(bodyEl, 'input', { inputType: 'insertText', data: '나' });
    teacherNet.transact(() => teacherNet.getText(DOC_KEYS.body).insert(0, '!'), 'teacher');
    clock.advance(100);
    origSetSel(0, 0); // 실제 커서 위치 변경 -> expectedSelection과 다름
    document.dispatchEvent(new Event('selectionchange'));
    clock.advance(config.IME_IDLE_MS);
    expect(editor.pendingRemote()).toBe(false);
    expect(bodyEl.value.startsWith('!교사 ')).toBe(true);
  });
});

describe('3. compositionend 누락 후 연속 입력 및 고착 해제 시험', () => {
  it('compositionend가 누락된 뒤 비조합 입력(글자·공백)을 계속 치면 유령 composing이 풀려 띄어쓰기 500ms 뒤 정상 flush된다', () => {
    const clock = new FakeClock();
    const studentNet = new Y.Doc();
    const teacherNet = new Y.Doc();
    cleanups.push(relay(studentNet, teacherNet));

    const bodyEl = document.createElement('textarea');
    document.body.appendChild(bodyEl);
    const editor = mountEditor(
      { body: bodyEl },
      fakeSyncedDoc(studentNet),
      {
        role: 'student',
        readOnly: false,
        undoGroupMs: config.UNDO_GROUP_MS.normal,
        diagnosticsEnabled: true,
      },
      { config, clock },
    );
    cleanups.push(() => {
      editor.destroy();
      bodyEl.remove();
    });
    bodyEl.focus();

    // 조합 시작 후 compositionend가 빠짐(안드로이드 Chrome 버그 재현)
    fireEvent(bodyEl, 'compositionstart');
    bodyEl.setRangeText('가', 0, 0, 'end');
    fireEvent(bodyEl, 'input', { inputType: 'insertCompositionText', data: '가', isComposing: true });

    teacherNet.transact(() => teacherNet.getText(DOC_KEYS.body).insert(0, '머리 '), 'teacher');

    // IME 키(keyCode 229 / Process)는 조합 상태를 유지해야 한다.
    clock.advance(200);
    fireEvent(bodyEl, 'keydown', { key: 'Process', keyCode: 229, isComposing: false });
    clock.advance(600);
    expect(editor.pendingRemote()).toBe(true);

    // 이후 비조합 일반 입력('나', '다', ' ')이 200ms 간격으로 들어오면 composing이 내려간다.
    for (const ch of ['나', '다', ' ']) {
      clock.advance(200);
      fireEvent(bodyEl, 'keydown', { key: ch, isComposing: false });
      const at = bodyEl.selectionStart;
      bodyEl.setRangeText(ch, at, at, 'end');
      fireEvent(bodyEl, 'input', { inputType: 'insertText', data: ch, isComposing: false });
    }

    // 띄어쓰기 뒤 500ms 정각에 정상 반영(5초 고착을 기다리지 않음)
    clock.advance(config.IME_IDLE_MS - 1);
    expect(editor.pendingRemote()).toBe(true);
    clock.advance(1);
    expect(editor.pendingRemote()).toBe(false);
    expect(bodyEl.value).toBe('머리 가나다 ');
  });

  it('5초 고착 해제로 한 번 flush된 뒤에도 composing 플래그가 내려가 다음 입력이 다시 5초씩 막히지 않는다', () => {
    const clock = new FakeClock();
    const studentNet = new Y.Doc();
    const teacherNet = new Y.Doc();
    cleanups.push(relay(studentNet, teacherNet));

    const bodyEl = document.createElement('textarea');
    document.body.appendChild(bodyEl);
    const editor = mountEditor(
      { body: bodyEl },
      fakeSyncedDoc(studentNet),
      {
        role: 'student',
        readOnly: false,
        undoGroupMs: config.UNDO_GROUP_MS.normal,
        diagnosticsEnabled: false,
      },
      { config, clock },
    );
    cleanups.push(() => {
      editor.destroy();
      bodyEl.remove();
    });
    bodyEl.focus();

    fireEvent(bodyEl, 'compositionstart');
    teacherNet.transact(() => teacherNet.getText(DOC_KEYS.body).insert(0, '1차 '), 'teacher');

    clock.advance(config.IME_STUCK_MS);
    expect(editor.pendingRemote()).toBe(false);
    expect(bodyEl.value).toBe('1차 ');

    // 고착 해제 뒤 다시 교사 원격 변경 + 학생의 IME 조합 키 이벤트(compositionstart 없이 229만 오는 경우 포함)
    fireEvent(bodyEl, 'keydown', { key: 'Process', keyCode: 229 });
    teacherNet.transact(() => teacherNet.getText(DOC_KEYS.body).insert(0, '2차 '), 'teacher');

    // composing이 이미 해제되었고 커서 앞이 공백(' ')이므로 500ms 만에 반영되어야 한다.
    clock.advance(config.IME_IDLE_MS);
    expect(editor.pendingRemote()).toBe(false);
    expect(bodyEl.value).toBe('2차 1차 ');
  });
});

describe('4. 다중 필드(body + title + memos + bindMemo) 동시성·Undo 시험', () => {
  it('동기화 전 새 기기가 마운트·렌더링되어도 기존 서버 메모를 절대 덮어쓰지 않고, 첫 글자를 칠 때만 생성한다(P0)', () => {
    const clock = new FakeClock();

    // 서버 문서에 이미 학생 메모가 저장되어 있는 상태(작은 clientID)
    const serverDoc = new Y.Doc();
    serverDoc.clientID = 10;
    const existingMemo = new Y.Text();
    existingMemo.insert(0, '소중한 기존 메모');
    serverDoc.getMap(DOC_KEYS.memo).set('q1', existingMemo);
    serverDoc.getText(DOC_KEYS.body).insert(0, '기존 본문 ');

    // 새 기기: 아직 서버와 동기화되기 전 빈 netDoc으로 마운트(더 큰 clientID로 LWW 최악 조건 구성)
    const newDeviceNet = new Y.Doc();
    newDeviceNet.clientID = 999_999_999;

    const bodyEl = document.createElement('textarea');
    const memoQ1El = document.createElement('textarea');
    const memoQ2El = document.createElement('textarea');
    document.body.append(bodyEl, memoQ1El, memoQ2El);

    const editor = mountEditor(
      { body: bodyEl, memos: new Map([['q1', memoQ1El]]) },
      fakeSyncedDoc(newDeviceNet),
      {
        role: 'student',
        readOnly: false,
        undoGroupMs: config.UNDO_GROUP_MS.normal,
        diagnosticsEnabled: false,
      },
      { config, clock },
    );
    const unbindQ2 = editor.bindMemo('q2', memoQ2El);
    cleanups.push(() => {
      unbindQ2();
      editor.destroy();
      bodyEl.remove();
      memoQ1El.remove();
      memoQ2El.remove();
    });

    // 마운트 직후에는 memo 맵에 어떤 키도 쓰지 않았어야 한다.
    expect(newDeviceNet.getMap(DOC_KEYS.memo).size).toBe(0);
    expect(editor.viewDoc.getMap(DOC_KEYS.memo).size).toBe(0);

    // 이제 뒤늦게 서버와 양방향 동기화가 완료됨
    Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(newDeviceNet));
    Y.applyUpdate(newDeviceNet, Y.encodeStateAsUpdate(serverDoc));
    clock.advance(config.IME_IDLE_MS);

    expect(serverDoc.getMap<Y.Text>(DOC_KEYS.memo).get('q1')?.toString()).toBe('소중한 기존 메모');
    expect(memoQ1El.value).toBe('소중한 기존 메모');
    expect(bodyEl.value).toBe('기존 본문 ');
    expect(newDeviceNet.getMap(DOC_KEYS.memo).has('q2')).toBe(false);

    // q2에 처음 글자를 칠 때만 Y.Text가 생성되고, undo를 해도 q2 Y.Text 그릇 자체는 삭제되지 않는다.
    memoQ2El.focus();
    memoQ2El.setRangeText('새 메모 ', 0, 0, 'end');
    fireEvent(memoQ2El, 'input', { inputType: 'insertText', data: '새 메모 ' });
    expect(newDeviceNet.getMap<Y.Text>(DOC_KEYS.memo).get('q2')?.toString()).toBe('새 메모 ');

    clock.advance(config.IME_IDLE_MS);
    editor.undo();
    expect(memoQ2El.value).toBe('');
    expect(editor.viewDoc.getMap(DOC_KEYS.memo).get('q2')).toBeInstanceOf(Y.Text);
  });

  it('동적으로 붙인 메모 칸(bindMemo) 조합 중에도 본문 원격 변경을 보류하고, 떼어내면 반영한다', () => {
    const clock = new FakeClock();
    const studentNet = new Y.Doc();
    const teacherNet = new Y.Doc();
    cleanups.push(relay(studentNet, teacherNet));

    const bodyEl = document.createElement('textarea');
    const memoEl = document.createElement('textarea');
    document.body.append(bodyEl, memoEl);

    const editor = mountEditor(
      { body: bodyEl },
      fakeSyncedDoc(studentNet),
      {
        role: 'student',
        readOnly: false,
        undoGroupMs: config.UNDO_GROUP_MS.normal,
        diagnosticsEnabled: false,
      },
      { config, clock },
    );
    const unbind = editor.bindMemo('q1', memoEl);
    cleanups.push(() => {
      unbind();
      editor.destroy();
      bodyEl.remove();
      memoEl.remove();
    });

    memoEl.focus();
    fireEvent(memoEl, 'compositionstart');
    memoEl.setRangeText('ㅁ', 0, 0, 'end');
    fireEvent(memoEl, 'input', { inputType: 'insertCompositionText', data: 'ㅁ', isComposing: true });

    teacherNet.transact(() => teacherNet.getText(DOC_KEYS.body).insert(0, '교사 본문'), 'teacher');
    clock.advance(2000);
    expect(editor.pendingRemote()).toBe(true);
    expect(bodyEl.value).toBe('');

    // 질문 카드를 접어 메모 바인딩을 해제하면 미기록 입력은 남기고 본문 반영 문이 즉시 열린다.
    memoEl.blur();
    unbind();
    expect(editor.pendingRemote()).toBe(false);
    expect(bodyEl.value).toBe('교사 본문');
  });

  it('800ms 묶음 분리, 칸 전환 묶음 분리, applyAppEdit 단독 undo, 보류 원격 존재 시 undo 커서 보존을 모두 지킨다', async () => {
    vi.useFakeTimers();
    const clock = new FakeClock();
    const studentNet = new Y.Doc();
    const teacherNet = new Y.Doc();
    cleanups.push(relay(studentNet, teacherNet));

    const titleEl = document.createElement('input');
    const bodyEl = document.createElement('textarea');
    const memoEl = document.createElement('textarea');
    document.body.append(titleEl, bodyEl, memoEl);

    const editor = mountEditor(
      { body: bodyEl, title: titleEl, memos: new Map([['q1', memoEl]]) },
      fakeSyncedDoc(studentNet),
      {
        role: 'student',
        readOnly: false,
        undoGroupMs: config.UNDO_GROUP_MS.normal,
        diagnosticsEnabled: false,
      },
      { config, clock },
    );
    cleanups.push(() => {
      editor.destroy();
      titleEl.remove();
      bodyEl.remove();
      memoEl.remove();
    });

    const advanceBoth = (ms: number) => {
      vi.advanceTimersByTime(ms);
      clock.advance(ms);
    };

    const typeInto = (el: HTMLTextAreaElement | HTMLInputElement, ch: string) => {
      const s = el.selectionStart ?? el.value.length;
      el.setRangeText(ch, s, s, 'end');
      fireEvent(el, 'input', { inputType: 'insertText', data: ch });
    };

    // ① 800ms 안의 같은 칸 입력은 한 묶음, 800ms 뒤 입력은 다른 묶음
    bodyEl.focus();
    typeInto(bodyEl, '가');
    advanceBoth(200);
    typeInto(bodyEl, ' ');
    advanceBoth(config.UNDO_GROUP_MS.normal + 100);
    typeInto(bodyEl, '나 ');
    advanceBoth(config.IME_IDLE_MS);

    editor.undo();
    expect(bodyEl.value).toBe('가 ');
    editor.redo();
    expect(bodyEl.value).toBe('가 나 ');

    // ② 800ms 이내라도 제목 → 본문 → 메모 칸 전환 시 Undo 묶음이 분리됨
    advanceBoth(config.UNDO_GROUP_MS.normal + 100);
    titleEl.focus();
    typeInto(titleEl, '제목');
    advanceBoth(100); // 800ms 이내!
    bodyEl.focus();
    typeInto(bodyEl, '다 ');
    advanceBoth(100); // 800ms 이내!
    memoEl.focus();
    typeInto(memoEl, '메모 ');
    advanceBoth(config.IME_IDLE_MS);

    editor.undo(); // 메모만 되돌림
    expect(memoEl.value).toBe('');
    expect(bodyEl.value).toBe('가 나 다 ');
    expect(titleEl.value).toBe('제목');

    editor.undo(); // 본문 '다 '만 되돌림
    expect(bodyEl.value).toBe('가 나 ');
    expect(titleEl.value).toBe('제목');

    // ③ 글자 입력 직후 applyAppEdit을 실행해도 한 번의 undo로 앱 편집만 되돌려짐
    bodyEl.focus();
    bodyEl.setSelectionRange(bodyEl.value.length, bodyEl.value.length);
    typeInto(bodyEl, '라 ');
    advanceBoth(config.IME_IDLE_MS);
    await editor.applyAppEdit(doc => doc.getText(DOC_KEYS.body).insert(0, '[1절] '));
    expect(bodyEl.value).toBe('[1절] 가 나 라 ');

    editor.undo();
    expect(bodyEl.value).toBe('가 나 라 ');

    // ④ 보류 중인 교사 원격 수정(맨 끝)이 있을 때 학생이 맨 앞 입력을 undo해도 커서가 맨 끝으로 튀지 않음
    advanceBoth(config.UNDO_GROUP_MS.normal + 100);
    bodyEl.setSelectionRange(0, 0);
    fireEvent(bodyEl, 'keydown', { key: 'Home' });
    typeInto(bodyEl, '앞 ');
    // 학생이 한글을 치는 척 잠깐 대기 후 교사가 글 맨 끝에 긴 꼬리말을 추가해 pendingRemote를 만듦
    bodyEl.setSelectionRange(bodyEl.value.length, bodyEl.value.length);
    typeInto(bodyEl, '한');
    teacherNet.transact(() => {
      teacherNet
        .getText(DOC_KEYS.body)
        .insert(teacherNet.getText(DOC_KEYS.body).length, ' [교사 맨 끝 수정]');
    }, 'teacher');
    expect(editor.pendingRemote()).toBe(true);

    // 방금 친 '한'과 '앞 '을 별도 시점으로 두기 위해 먼저 2초 멈춰 flush하지 않고, undo를 예약 호출
    // 더 명확한 검증: 문이 닫힌 상태에서 교사 수정이 대기 중일 때 문이 열리며 undo가 실행되는 경우
    editor.undo(); // '앞 ' + '한'(800ms 이내 같은 칸) 되돌리기 예약
    advanceBoth(config.IME_LONG_IDLE_MS);
    await vi.runAllTimersAsync();
    expect(bodyEl.value).toBe('가 나 라  [교사 맨 끝 수정]');
    // 교사 수정 끝(글 맨 끝)으로 커서가 튀지 않아야 한다.
    expect(bodyEl.selectionStart).toBeLessThan('가 나 라 '.length + 1);
  });
});

describe('5. 줄바꿈·서로게이트·역방향 선택·다중 구간 원격 변경·맨 앞 선택 경계 시험', () => {
  it('title(<input>)의 \\n 원격 변경과 \\r\\n 붙여넣기에서도 lastRendered === el.value 불변식을 지키고 유령 삭제가 없다', () => {
    const clock = new FakeClock();
    const studentNet = new Y.Doc();
    const peerDoc = new Y.Doc();
    cleanups.push(relay(studentNet, peerDoc));

    const titleEl = document.createElement('input');
    const bodyEl = document.createElement('textarea');
    document.body.append(titleEl, bodyEl);

    // 실제 브라우저 HTML <input type="text">의 줄바꿈 제거 동작을 재현
    const inputProto = Object.getPrototypeOf(titleEl) as object;
    const valDesc = Object.getOwnPropertyDescriptor(inputProto, 'value')!;
    const origTitleRange = titleEl.setRangeText.bind(titleEl);
    Object.defineProperty(titleEl, 'value', {
      configurable: true,
      get() {
        return valDesc.get!.call(titleEl);
      },
      set(v: string) {
        valDesc.set!.call(titleEl, String(v).replace(/[\r\n]/g, ''));
      },
    });
    titleEl.setRangeText = ((replacement: string, ...rest: [number, number, SelectionMode?]) => {
      origTitleRange(replacement.replace(/[\r\n]/g, ''), ...rest);
    }) as HTMLInputElement['setRangeText'];

    const editor = mountEditor(
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
    cleanups.push(() => {
      editor.destroy();
      titleEl.remove();
      bodyEl.remove();
    });

    // 원격에서 title에 줄바꿈이 섞인 텍스트가 들어옴
    peerDoc.transact(() => peerDoc.getText(DOC_KEYS.title).insert(0, '안녕\n하세요'), 'peer');
    clock.advance(config.IME_IDLE_MS);

    expect(titleEl.value).toBe('안녕하세요');
    expect(editor.viewDoc.getText(DOC_KEYS.title).toString()).toBe('안녕하세요');
    expect(studentNet.getText(DOC_KEYS.title).toString()).toBe('안녕하세요');

    // 두 번째 원격 변경이 와도 인덱스가 어긋나지 않고, 학생의 Undo 스택도 오염되지 않는다.
    peerDoc.transact(() => {
      const t = peerDoc.getText(DOC_KEYS.title);
      t.insert(t.length, ' 반가워');
    }, 'peer');
    clock.advance(config.IME_IDLE_MS);
    expect(titleEl.value).toBe('안녕하세요 반가워');
    editor.undo();
    expect(titleEl.value).toBe('안녕하세요 반가워');

    // 본문에 \r\n 붙여넣기 시 \r 없이 \n 하나로만 기록된다.
    bodyEl.focus();
    bodyEl.value = '첫줄\r\n둘째줄\r셋째줄';
    fireEvent(bodyEl, 'input', { inputType: 'insertFromPaste' });
    expect(studentNet.getText(DOC_KEYS.body).toString()).toBe('첫줄\n둘째줄\n셋째줄');
    expect(studentNet.getText(DOC_KEYS.body).toString().includes('\r')).toBe(false);
  });

  it('서로게이트 쌍(이모지)·역방향 선택(backward)·앞뒤 동시 원격 변경·문장 맨 앞 한글 선택 범위를 모두 올바르게 처리한다', () => {
    const clock = new FakeClock();
    const studentNet = new Y.Doc();
    const teacherNet = new Y.Doc();
    cleanups.push(relay(studentNet, teacherNet));

    const bodyEl = document.createElement('textarea');
    document.body.appendChild(bodyEl);
    const editor = mountEditor(
      { body: bodyEl },
      fakeSyncedDoc(studentNet),
      {
        role: 'student',
        readOnly: false,
        undoGroupMs: config.UNDO_GROUP_MS.normal,
        diagnosticsEnabled: false,
      },
      { config, clock },
    );
    cleanups.push(() => {
      editor.destroy();
      bodyEl.remove();
    });

    const smile = '\u{1F600}'; // UTF-16 길이 2
    bodyEl.focus();
    bodyEl.setRangeText(`가${smile}나다라 `, 0, 0, 'end');
    fireEvent(bodyEl, 'input', { inputType: 'insertText', data: `가${smile}나다라 ` });
    clock.advance(config.IME_IDLE_MS);

    // ① 역방향 범위 선택('나다' 선택, direction = 'backward') 상태에서 커서 앞과 뒤가 동시에 원격 변경됨
    const naStart = `가${smile}`.length; // 3
    const daEnd = naStart + 2; // 5
    bodyEl.setSelectionRange(naStart, daEnd, 'backward');
    fireEvent(bodyEl, 'keydown', { key: 'ArrowLeft', shiftKey: true });
    expect(bodyEl.selectionDirection).toBe('backward');

    teacherNet.transact(() => {
      const t = teacherNet.getText(DOC_KEYS.body);
      t.insert(t.length, '[뒤]');
      t.insert(0, '[앞]');
    }, 'teacher');
    clock.advance(config.IME_IDLE_MS);

    expect(bodyEl.value).toBe(`[앞]가${smile}나다라 [뒤]`);
    expect(bodyEl.value.slice(bodyEl.selectionStart, bodyEl.selectionEnd)).toBe('나다');
    expect(bodyEl.selectionDirection).toBe('backward');
    // 깨진 단독 서로게이트가 없어야 한다.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(bodyEl.value)).toBe(
      false,
    );

    // ② 문장 맨 앞 [0, 1]에 한글이 선택된 상태에서는 500ms에 문을 열지 않고 2000ms 음절 경계를 지킨다(P2).
    const bodyEl2 = document.createElement('textarea');
    document.body.appendChild(bodyEl2);
    const net2 = new Y.Doc();
    const peer2 = new Y.Doc();
    cleanups.push(relay(net2, peer2));
    const editor2 = mountEditor(
      { body: bodyEl2 },
      fakeSyncedDoc(net2),
      {
        role: 'student',
        readOnly: false,
        undoGroupMs: config.UNDO_GROUP_MS.normal,
        diagnosticsEnabled: false,
      },
      { config, clock },
    );
    cleanups.push(() => {
      editor2.destroy();
      bodyEl2.remove();
    });

    bodyEl2.focus();
    bodyEl2.setRangeText('한', 0, 0, 'select'); // selectionStart = 0, selectionEnd = 1
    fireEvent(bodyEl2, 'input', { inputType: 'insertText', data: '한' });
    expect(bodyEl2.selectionStart).toBe(0);
    expect(bodyEl2.selectionEnd).toBe(1);
    expect(isHangulCodePoint('한'.codePointAt(0)!)).toBe(true);

    peer2.transact(() => peer2.getText(DOC_KEYS.body).insert(1, '!'), 'teacher');
    clock.advance(600);
    expect(editor2.pendingRemote()).toBe(true);
    expect(bodyEl2.value).toBe('한');

    clock.advance(1400);
    expect(editor2.pendingRemote()).toBe(false);
    expect(bodyEl2.value).toBe('한!');
  });
});

describe('6. 원격 커서(awareness) 악성 입력 및 거울 층 시험', () => {
  it('악성 cursor.head({}, 허용 외 tname, 음수 clock, 미래 시계)가 있어도 flush가 정상 완료되고 viewDoc.share가 오염되지 않는다', () => {
    const clock = new FakeClock();
    const studentNet = new Y.Doc();
    const teacherNet = new Y.Doc();
    cleanups.push(relay(studentNet, teacherNet));

    const states = new Map<number, Record<string, unknown>>();
    const listeners = new Set<() => void>();
    const fakeAwareness: NonNullable<SyncedDoc['awareness']> = {
      clientID: 1,
      getLocalState: () => states.get(1) ?? null,
      getStates: () => states,
      setLocalStateField: (field, val) => {
        const cur = states.get(1) ?? {};
        states.set(1, { ...cur, [field]: val });
      },
      on: (_event, cb) => {
        listeners.add(cb as () => void);
      },
      off: (_event, cb) => {
        listeners.delete(cb as () => void);
      },
    };

    const bodyEl = document.createElement('textarea');
    const mirrorHost = document.createElement('div');
    document.body.append(mirrorHost, bodyEl);

    const editor = mountEditor(
      { body: bodyEl, mirror: mirrorHost },
      fakeSyncedDoc(studentNet, fakeAwareness),
      {
        role: 'student',
        readOnly: false,
        undoGroupMs: config.UNDO_GROUP_MS.normal,
        diagnosticsEnabled: false,
      },
      { config, clock },
    );
    cleanups.push(() => {
      editor.destroy();
      bodyEl.remove();
      mirrorHost.remove();
    });

    bodyEl.focus();
    bodyEl.setRangeText('가나다 ', 0, 0, 'end');
    fireEvent(bodyEl, 'input', { inputType: 'insertText', data: '가나다 ' });
    clock.advance(config.IME_IDLE_MS);

    const shareKeysBefore = [...editor.viewDoc.share.keys()].sort();
    const validRel = Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(editor.viewDoc.getText(DOC_KEYS.body), 2, -1),
    );

    // 악성 awareness 페이로드 4종 + 정상 교사 커서 1종 주입
    states.set(2, { cursor: { head: {} }, user: { role: 'teacher' } });
    states.set(3, { cursor: { head: { tname: 'evil', assoc: 0 } }, user: { role: 'teacher' } });
    states.set(4, {
      cursor: { head: { item: { client: 'bad', clock: -1 } } },
      user: { role: 'student' },
    });
    states.set(5, {
      cursor: { head: { tname: 'body', item: { client: 777_777, clock: 999 }, assoc: -1 } },
      user: { role: 12345 },
    });
    states.set(6, { cursor: { head: validRel }, user: { role: 'teacher' } });

    for (const cb of listeners) cb();

    teacherNet.transact(() => teacherNet.getText(DOC_KEYS.body).insert(0, '머리 '), 'teacher');
    clock.advance(config.IME_IDLE_MS);

    // 예외로 중단되지 않고 gate.flushed()까지 완료되어 pendingRemote가 false여야 한다.
    expect(editor.pendingRemote()).toBe(false);
    expect(bodyEl.value).toBe('머리 가나다 ');
    expect(editor.viewDoc.share.has('evil')).toBe(false);
    expect([...editor.viewDoc.share.keys()].sort()).toEqual(shareKeysBefore);

    // 유효한 교사 커서 1개만 그려진다.
    const carets = mirrorHost.querySelectorAll('[data-mirror-caret]');
    expect(carets.length).toBe(1);
    expect(carets[0]?.getAttribute('data-mirror-caret')).toBe('teacher');

    // 글자 크기 변경 후 syncLayout() 호출 시 거울 층 인라인 스타일과 탄성 스크롤 변환이 갱신된다.
    bodyEl.style.fontSize = '24px';
    bodyEl.scrollTop = -24; // Safari 탄성 스크롤(음수 scrollTop) 흉내
    editor.syncLayout();
    expect(mirrorHost.style.fontSize).toBe('24px');
    const mirrorContent = mirrorHost.querySelector('[data-mirror-content]') as HTMLElement | null;
    expect(mirrorContent?.style.transform).toBe('translate3d(0px, 24px, 0)');
  });
});
