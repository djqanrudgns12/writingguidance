import { DOC_KEYS } from '@geulbang/core';
import { defaultConfig } from '@geulbang/core/config';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { value, type Value } from '../../ports/observable.ts';
import type { SaveState, SyncedDoc } from '../../ports/realtime.ts';
import { FakeClock } from '../../testing/fakeClock.ts';
import { mountEditor, type MountedEditor } from './editor.ts';

/**
 * 검토 B02(P5-5b 2차): 서버 초기 상태를 받기 전에 메모를 쓰면 기기가 같은 키에 다른 `Y.Text`를 만들어
 * 병합에서 한쪽 메모가 사라지거나 서버 `memoReplaced` 검사에 걸려 연결이 읽기 전용이 된다.
 * 고친 뒤: 서버 칸을 받기 전 입력은 입력칸에 보류했다가 서버 칸에 기록한다. 보류 중에도 입력칸은 건드리지 않는다.
 */

const config = defaultConfig;
const SERVER_CLIENT = 1000;

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function fakeSyncedDoc(netDoc: Y.Doc, saveState: Value<SaveState>): SyncedDoc {
  return {
    docId: 'memo-init',
    netDoc,
    awareness: null,
    saveState,
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

function fire(el: HTMLElement, type: string, init: Record<string, unknown> = {}): void {
  const Ctor = type.startsWith('composition') ? CompositionEvent : InputEvent;
  el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...init }));
}

/** 서버의 새 글 첫 상태(`initialDocState`처럼 도움 질문마다 빈 메모 칸). */
function serverWithMemo(ids: readonly string[]): Y.Doc {
  const server = new Y.Doc();
  server.clientID = SERVER_CLIENT;
  server.transact(() => {
    const memo = server.getMap<Y.Text>(DOC_KEYS.memo);
    for (const id of ids) memo.set(id, new Y.Text());
  });
  return server;
}

interface Setup {
  readonly clock: FakeClock;
  readonly net: Y.Doc;
  readonly saveState: Value<SaveState>;
  readonly memoEl: HTMLTextAreaElement;
  readonly editor: MountedEditor;
  /** 편집기가 메모 입력칸에 한 쓰기 수(값·선택·초점·읽기 전용) */
  editorWrites(): number;
  type(text: string): void;
}

function setup(deviceClient: number): Setup {
  const clock = new FakeClock();
  const net = new Y.Doc();
  net.clientID = deviceClient;
  const saveState = value<SaveState>('local');
  const bodyEl = document.createElement('textarea');
  const memoEl = document.createElement('textarea');
  document.body.append(bodyEl, memoEl);

  // 편집기가 메모 입력칸을 고친 횟수를 센다(사용자 흉내 중에는 세지 않는다).
  let userActing = false;
  let writes = 0;
  for (const name of ['setRangeText', 'setSelectionRange', 'focus', 'blur'] as const) {
    const original = memoEl[name].bind(memoEl) as (...args: unknown[]) => unknown;
    (memoEl as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      if (!userActing) writes++;
      return original(...args);
    };
  }
  const proto = Object.getPrototypeOf(memoEl) as object;
  for (const prop of ['value', 'readOnly'] as const) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop)!;
    Object.defineProperty(memoEl, prop, {
      configurable: true,
      get: () => desc.get!.call(memoEl),
      set: (v: unknown) => {
        if (!userActing) writes++;
        desc.set!.call(memoEl, v);
      },
    });
  }

  const editor = mountEditor(
    { body: bodyEl, memos: new Map([['q1', memoEl]]) },
    fakeSyncedDoc(net, saveState),
    { role: 'student', readOnly: false, undoGroupMs: config.UNDO_GROUP_MS.normal, diagnosticsEnabled: false },
    { config, clock },
  );
  cleanups.push(() => {
    editor.destroy();
    bodyEl.remove();
    memoEl.remove();
  });
  userActing = true;
  memoEl.focus();
  userActing = false;
  writes = 0;

  return {
    clock,
    net,
    saveState,
    memoEl,
    editor,
    editorWrites: () => writes,
    type(text) {
      userActing = true;
      const at = memoEl.selectionEnd ?? memoEl.value.length;
      memoEl.setRangeText(text, at, at, 'end');
      userActing = false;
      fire(memoEl, 'input', { inputType: 'insertText', data: text });
    },
  };
}

/** 서버 → 기기(첫 동기화 step2), 기기 → 서버(기기 변경). 서버 쪽 메모 칸이 바뀌지 않았는지 함께 본다. */
function syncBothWays(server: Y.Doc, net: Y.Doc): void {
  Y.applyUpdate(net, Y.encodeStateAsUpdate(server, Y.encodeStateVector(net)), 'server');
  Y.applyUpdate(server, Y.encodeStateAsUpdate(net, Y.encodeStateVector(server)), 'device');
}

describe('B02 서버 메모 칸을 받기 전 메모 입력', () => {
  // 같은 키 충돌에서 이기는 쪽은 clientID 순서로 정해지므로 두 순서 다 본다.
  for (const deviceClient of [SERVER_CLIENT - 1, SERVER_CLIENT + 1]) {
    it(`기기가 같은 키에 새 칸을 만들지 않고, 서버 칸에 입력이 들어간다(기기 clientID ${deviceClient > SERVER_CLIENT ? '큼' : '작음'})`, () => {
      const server = serverWithMemo(['q1']);
      const serverMemo = server.getMap<Y.Text>(DOC_KEYS.memo).get('q1');
      const s = setup(deviceClient);

      s.type('먼저 쓴 메모 ');
      // 서버 칸을 모르는 동안에는 메모 칸 객체를 만들지 않는다.
      expect(s.net.share.has(DOC_KEYS.memo) && s.net.getMap(DOC_KEYS.memo).has('q1')).toBe(false);
      expect(s.memoEl.value).toBe('먼저 쓴 메모 ');

      // 서버 초기 상태가 도착하고 동기화가 끝남
      syncBothWays(server, s.net);
      s.saveState.set('sending');
      s.clock.advance(config.IME_IDLE_MS);
      syncBothWays(server, s.net);

      // 서버의 칸이 그대로(memoReplaced에 걸리지 않음)이고 입력이 그 칸에 들어갔다.
      expect(server.getMap<Y.Text>(DOC_KEYS.memo).get('q1')).toBe(serverMemo);
      expect(serverMemo?.toString()).toBe('먼저 쓴 메모 ');
      expect(s.net.getMap<Y.Text>(DOC_KEYS.memo).get('q1')?.toString()).toBe('먼저 쓴 메모 ');
      expect(s.memoEl.value).toBe('먼저 쓴 메모 ');
      // 서버 칸에 이어서 쓴다.
      s.type('더');
      syncBothWays(server, s.net);
      expect(server.getMap<Y.Text>(DOC_KEYS.memo).get('q1')).toBe(serverMemo);
      expect(serverMemo?.toString()).toBe('먼저 쓴 메모 더');
    });
  }

  it('통신용 문서에 서버 칸이 왔지만 조합 중이라 편집용에 반영되기 전이면, 입력칸을 건드리지 않고 기다렸다 서버 칸에 기록한다', () => {
    const server = serverWithMemo(['q1']);
    const serverMemo = server.getMap<Y.Text>(DOC_KEYS.memo).get('q1');
    const s = setup(SERVER_CLIENT + 1);

    fire(s.memoEl, 'compositionstart');
    s.type('ㅁ');
    // 조합 중에 서버 초기 상태가 통신용 문서에 도착
    syncBothWays(server, s.net);
    s.saveState.set('sending');
    s.clock.advance(config.IME_IDLE_MS);
    s.type('ㅔ');
    fire(s.memoEl, 'compositionend');
    s.type('모');
    // 조합 내내 편집기는 메모 입력칸에 한 번도 쓰지 않았고, 기기는 새 칸을 만들지 않았다.
    expect(s.editorWrites()).toBe(0);
    expect(s.net.getMap<Y.Text>(DOC_KEYS.memo).get('q1')?.toString()).toBe('');
    syncBothWays(server, s.net);
    expect(server.getMap<Y.Text>(DOC_KEYS.memo).get('q1')).toBe(serverMemo);

    // 반영 문이 열리면(한글 뒤라 긴 멈춤) 서버 칸으로 들어간다. 입력칸 값은 이미 같으므로 고치지 않는다.
    s.clock.advance(config.IME_LONG_IDLE_MS);
    syncBothWays(server, s.net);
    expect(server.getMap<Y.Text>(DOC_KEYS.memo).get('q1')).toBe(serverMemo);
    expect(serverMemo?.toString()).toBe('ㅁㅔ모');
    expect(s.memoEl.value).toBe('ㅁㅔ모');
    expect(s.editorWrites()).toBe(0);
  });

  it('보류 중에 본문 원격 변경을 반영해도 보류한 메모 입력과 커서를 지우지 않는다', () => {
    const s = setup(SERVER_CLIENT + 1);
    s.type('메모');
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(s.net));
    remote.getText(DOC_KEYS.body).insert(0, '다른 기기 본문');
    Y.applyUpdate(s.net, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(s.net)), 'server');
    s.clock.advance(config.IME_IDLE_MS);

    expect(s.memoEl.value).toBe('메모');
    expect(s.memoEl.selectionStart).toBe(2);
    expect(s.editorWrites()).toBe(0);
    expect(s.net.share.has(DOC_KEYS.memo) && s.net.getMap(DOC_KEYS.memo).has('q1')).toBe(false);
  });

  it('보관 중에 질문을 넘겨 메모 칸을 뗐다 다시 붙여도 보관한 입력이 남고, 서버 칸이 오면 그 칸으로 들어간다', () => {
    const server = serverWithMemo(['q1']);
    const serverMemo = server.getMap<Y.Text>(DOC_KEYS.memo).get('q1');
    const s = setup(SERVER_CLIENT + 1);
    s.type('넘기기 전 메모 ');

    // 질문을 넘김: 칸이 떨어졌다가 새 입력칸으로 다시 붙는다.
    const again = document.createElement('textarea');
    document.body.append(again);
    cleanups.push(() => again.remove());
    const unbind = s.editor.bindMemo('q1', again);
    cleanups.unshift(unbind);
    expect(again.value).toBe('넘기기 전 메모 ');

    syncBothWays(server, s.net);
    s.saveState.set('sending');
    s.clock.advance(config.IME_LONG_IDLE_MS);
    syncBothWays(server, s.net);
    expect(server.getMap<Y.Text>(DOC_KEYS.memo).get('q1')).toBe(serverMemo);
    expect(serverMemo?.toString()).toBe('넘기기 전 메모 ');
    expect(again.value).toBe('넘기기 전 메모 ');
  });

  it('서버 상태를 받았는데 그 칸이 없는 예전 글이면 그때 만들어 보류한 입력을 기록한다(새 입력 없이)', () => {
    const s = setup(SERVER_CLIENT + 1);
    s.type('예전 글 메모');
    expect(s.net.share.has(DOC_KEYS.memo) && s.net.getMap(DOC_KEYS.memo).has('q1')).toBe(false);

    s.saveState.set('saved');
    s.clock.advance(config.IME_LONG_IDLE_MS);
    expect(s.net.getMap<Y.Text>(DOC_KEYS.memo).get('q1')?.toString()).toBe('예전 글 메모');
    expect(s.memoEl.value).toBe('예전 글 메모');
    expect(s.editorWrites()).toBe(0);
  });
});
