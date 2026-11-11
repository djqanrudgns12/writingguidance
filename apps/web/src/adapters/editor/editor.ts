import type { Config } from '@geulbang/core/config';
import { DOC_KEYS } from '@geulbang/core';
import type { TextChange } from '@geulbang/core/text';
import * as Y from 'yjs';
import { z } from 'zod';
import type {
  EditorBinding,
  EditorFields,
  EditorOptions,
  EditorPort,
  HistoryState,
  TextRange,
} from '../../ports/editor.ts';
import type { Unsubscribe } from '../../ports/observable.ts';
import type { SyncedDoc } from '../../ports/realtime.ts';
import { createDiagnostics, type Diagnostics } from './diagnostics.ts';
import { FieldBinding, type FieldElement, type FieldTextSource, type SelectionDirection } from './field.ts';
import { Gate, realClock, type GateClock } from './gate.ts';
import { historyActionFromInput, historyActionFromKey, type HistoryAction } from './keys.ts';
import { createMirror, type Mirror } from './mirror.ts';
import { FROM_NET, FROM_VIEW, INIT_MEMO, LOCAL, SANITIZE } from './origins.ts';

/**
 * 편집기 포트 구현: 기본 입력칸 + 한글 반영 문(PRD 9.3, PLAN §6.3).
 *
 * 문서 둘: 통신용(`doc.netDoc`, 서버와 연결)과 편집용(`viewDoc`, 입력칸과 1:1).
 * - 내 입력 → 편집용(LOCAL) → 통신용(FROM_VIEW): 바로.
 * - 남의 변경 → 통신용 → 편집용(FROM_NET): 반영 문이 열릴 때만, 한 번의 동기 작업으로.
 */
export interface EditorDeps {
  readonly config: Readonly<Config>;
  readonly clock?: GateClock;
}

export function createTextareaEditor(deps: EditorDeps): EditorPort {
  return {
    mount: (fields, doc, options) => mountEditor(fields, doc, options, deps),
  };
}

type FieldKey = 'body' | 'title' | `memo:${string}`;

const yIdSchema = z.object({
  client: z.number().int().nonnegative(),
  clock: z.number().int().nonnegative(),
});

const relativePosJsonSchema = z
  .object({
    tname: z.enum([DOC_KEYS.body, DOC_KEYS.title]).optional(),
    type: yIdSchema.optional(),
    item: yIdSchema.optional(),
    assoc: z.number().int().optional(),
  })
  .refine(v => v.tname !== undefined || v.type !== undefined || v.item !== undefined);

const awarenessUserSchema = z.object({
  role: z.enum(['student', 'teacher']).optional(),
});

export interface MountedEditor extends EditorBinding {
  /** 진단 기록(`/dev/editor`·시험용) */
  readonly diagnostics: Diagnostics;
  /** 시험·개발 화면용: 지금 반영을 기다리는 원격 변경이 있는가 */
  readonly pendingRemote: () => boolean;
}

export function mountEditor(
  fields: EditorFields,
  doc: SyncedDoc,
  options: EditorOptions,
  deps: EditorDeps,
): MountedEditor {
  const { config } = deps;
  const clock = deps.clock ?? realClock;
  const netDoc = doc.netDoc;
  const viewDoc = new Y.Doc();
  Y.applyUpdate(viewDoc, Y.encodeStateAsUpdate(netDoc), FROM_NET);
  const diagnostics = createDiagnostics(options.diagnosticsEnabled, () => clock.now());

  let applyingRemote = false;
  let destroyed = false;
  let desiredReadOnly = options.readOnly;
  let highlights: readonly TextRange[] = [];
  let lastEditedField: FieldKey | null = null;
  let lastEditedAt = -Infinity;
  let lastFocusedField: FieldKey | null = null;
  const holdListeners = new Set<(holding: boolean) => void>();
  const largeDeleteListeners = new Set<(removed: number) => void>();

  // ── 두 문서 잇기 ───────────────────────────────────────────────
  const onViewUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== FROM_NET) Y.applyUpdate(netDoc, update, FROM_VIEW);
  };
  const onNetUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin !== FROM_VIEW) gate.markPending();
  };
  viewDoc.on('update', onViewUpdate);
  netDoc.on('update', onNetUpdate);

  // 초기 문서에 섞여 있을 수 있는 허용 외 줄바꿈을 먼저 정리한다(있을 때만 SANITIZE 트랜잭션).
  sanitizeDocNewlines(viewDoc, SANITIZE);

  // ── 되돌리기: 내 입력(LOCAL)만, 묶음 시간은 주입 시계(`clock`)로 판정 ──
  const undoManager = new Y.UndoManager(
    [viewDoc.getText(DOC_KEYS.body), viewDoc.getText(DOC_KEYS.title), viewDoc.getMap(DOC_KEYS.memo)],
    { trackedOrigins: new Set([LOCAL]), captureTimeout: Infinity },
  );
  // 되돌리기 단추 상태: 기록 더미가 바뀔 때만 알린다(같은 상태면 조용히).
  const historyListeners = new Set<(state: HistoryState) => void>();
  let lastHistory: HistoryState = { canUndo: false, canRedo: false };
  const readHistory = (): HistoryState => ({
    canUndo: undoManager.undoStack.length > 0,
    canRedo: undoManager.redoStack.length > 0,
  });
  const emitHistory = () => {
    const next = readHistory();
    if (next.canUndo === lastHistory.canUndo && next.canRedo === lastHistory.canRedo) return;
    lastHistory = next;
    for (const l of historyListeners) l(next);
  };
  undoManager.on('stack-item-added', emitHistory);
  undoManager.on('stack-item-popped', emitHistory);
  undoManager.on('stack-cleared', emitHistory);

  // ── 입력칸 ─────────────────────────────────────────────────────
  const bindings = new Map<FieldKey, FieldBinding>();
  const fieldUnbinders = new Map<FieldKey, () => void>();
  const mirrors = new Map<FieldKey, Mirror>();

  const breakUndoGroup = () => {
    undoManager.stopCapturing();
    lastEditedField = null;
    lastEditedAt = -Infinity;
  };

  const recordFor = (key: FieldKey, singleLine: boolean) => (text: Y.Text, change: TextChange) => {
    const insert = singleLine ? change.insert.replace(/[\r\n]/g, '') : change.insert.replace(/\r\n?/g, '\n');
    if (change.deleteCount === 0 && insert.length === 0) return;
    const now = clock.now();
    if (lastEditedField !== null && (lastEditedField !== key || now - lastEditedAt >= options.undoGroupMs)) {
      undoManager.stopCapturing();
    }
    lastEditedField = key;
    lastEditedAt = now;
    viewDoc.transact(() => {
      if (change.deleteCount > 0) text.delete(change.index, change.deleteCount);
      if (insert) text.insert(change.index, insert);
    }, LOCAL);
    const removed = change.deleteCount - insert.length;
    if (removed > config.LARGE_DELETE_CHARS) for (const l of largeDeleteListeners) l(removed);
  };

  const peekMemoText = (id: string): Y.Text | undefined => {
    const text = viewDoc.getMap<Y.Text>(DOC_KEYS.memo).get(id);
    return text instanceof Y.Text ? text : undefined;
  };

  // 새 글은 서버가 도움 질문마다 빈 메모 칸(`Y.Text`)을 미리 만들어 모든 기기가 같은 객체를 고친다(PLAN §4.2).
  // 같은 키에 기기마다 다른 객체를 넣으면 Yjs가 한쪽만 남겨 메모가 통째로 사라지므로(서버는 이미 있는 칸을 바꾸는
  // 편집을 받지 않는다), 기기가 새로 만드는 것은 서버 상태를 받고도 그 칸이 없는 예전 글 대비일 뿐이다.
  // 서버 상태를 받기 전이거나, 통신용 문서엔 왔는데 반영 문 때문에 편집용에 아직 없으면 입력을 보관했다가
  // 칸이 생기면 옮긴다(검토 B02). 보관하는 동안에도 입력칸은 건드리지 않는다(입력칸에 이미 그 글이 있다).
  /** 이 글의 서버 상태를 한 번이라도 받았는가(저장 상태가 `보내는 중`·`저장됨`이면 첫 동기화가 끝난 것). */
  let serverStateKnown = false;
  const heldMemos = new Map<string, string>();

  const memoMayBeCreated = (id: string): boolean => {
    if (!serverStateKnown) return false;
    const onNet = netDoc.share.has(DOC_KEYS.memo) ? netDoc.getMap(DOC_KEYS.memo).get(id) : undefined;
    return !(onNet instanceof Y.Text); // 서버 칸이 와 있으면 반영 때 그것을 받는다
  };

  /** 그 메모 칸(보관한 입력을 먼저 옮긴다). 아직 칸을 만들면 안 되면 undefined. */
  const ensureMemoText = (id: string): Y.Text | undefined => {
    const memo = viewDoc.getMap<Y.Text>(DOC_KEYS.memo);
    let text = peekMemoText(id);
    if (!text) {
      if (!memoMayBeCreated(id)) return undefined;
      const created = new Y.Text();
      viewDoc.transact(() => memo.set(id, created), INIT_MEMO);
      text = created;
    }
    const held = heldMemos.get(id);
    if (held !== undefined) {
      heldMemos.delete(id);
      // 서버 칸 앞에 넣는다: 입력칸에 이미 보이는 글이 앞이라, 뒤에 붙는 다른 기기 글만 반영되고 커서가 그대로다.
      const target = text;
      viewDoc.transact(() => target.insert(0, held), INIT_MEMO);
    }
    return text;
  };

  const holdMemo = (id: string, change: TextChange) => {
    const cur = heldMemos.get(id) ?? '';
    const next = cur.slice(0, change.index) + change.insert + cur.slice(change.index + change.deleteCount);
    if (next) heldMemos.set(id, next);
    else heldMemos.delete(id);
  };

  const memoSource = (id: string) => ({
    peek: () => peekMemoText(id),
    ensure: () => ensureMemoText(id),
    hold: (change: TextChange) => holdMemo(id, change),
    held: () => heldMemos.get(id),
  });

  /** 칸이 생겼으면(반영으로 서버 칸이 왔거나 이제 만들어도 되면) 보관한 입력을 옮긴다. 반영 중에만 부른다. */
  const adoptHeldMemos = () => {
    for (const id of [...heldMemos.keys()]) ensureMemoText(id);
  };

  const gate = new Gate(
    config,
    {
      onFlush: () => flush(),
      onHoldChange: holding => {
        diagnostics.record({ field: '-', type: holding ? 'hold-start' : 'hold-end' });
        for (const l of holdListeners) l(holding);
      },
      onDecision: d => {
        if (diagnostics.enabled && !d.open) diagnostics.record({ field: '-', type: 'gate', gate: d.reason });
      },
    },
    clock,
  );

  // ── 되돌리기 키 가로채기(`preventDefault`는 동기 유지) ──────────
  const onKeydown = (e: KeyboardEvent) => {
    const action = historyActionFromKey(e);
    if (!action) return;
    e.preventDefault();
    history(action);
  };
  const onBeforeInput = (e: InputEvent) => {
    const action = historyActionFromInput(e);
    if (!action) return;
    e.preventDefault();
    history(action);
  };

  const registerField = (key: FieldKey, el: FieldElement, source: FieldTextSource): Unsubscribe => {
    fieldUnbinders.get(key)?.();
    const singleLine = el instanceof HTMLInputElement;
    const fieldBinding = new FieldBinding(el, source, {
      name: key,
      now: () => clock.now(),
      stuckMs: config.IME_STUCK_MS,
      applyingRemote: () => applyingRemote,
      record: recordFor(key, singleLine),
      poke: () => gate.poke(),
      onSelection: () => {
        publishCursor();
        redraw(key);
      },
      onFocus: () => {
        if (lastFocusedField !== null && lastFocusedField !== key) {
          breakUndoGroup();
        }
        lastFocusedField = key;
      },
      diagnostics,
    });
    bindings.set(key, fieldBinding);
    const removeFromGate = gate.addField(fieldBinding);
    el.readOnly = desiredReadOnly;
    (el as HTMLElement).addEventListener('keydown', onKeydown);
    (el as HTMLElement).addEventListener('beforeinput', onBeforeInput);
    if (el instanceof HTMLTextAreaElement && fields.mirror && key === 'body') {
      mirrors.set(key, createMirror(el, fields.mirror));
    }

    let active = true;
    const unbind = () => {
      if (!active) return;
      active = false;
      if (!destroyed) fieldBinding.commitPending();
      const wasFocused = fieldBinding.focused;
      (el as HTMLElement).removeEventListener('keydown', onKeydown);
      (el as HTMLElement).removeEventListener('beforeinput', onBeforeInput);
      fieldBinding.destroy();
      if (bindings.get(key) === fieldBinding) {
        bindings.delete(key);
        fieldUnbinders.delete(key);
      }
      const mirror = mirrors.get(key);
      if (mirror) {
        mirror.destroy();
        mirrors.delete(key);
      }
      removeFromGate();
      if (!destroyed && wasFocused) publishCursor();
    };
    fieldUnbinders.set(key, unbind);
    return unbind;
  };

  const bodyText = () => viewDoc.getText(DOC_KEYS.body);
  const titleText = () => viewDoc.getText(DOC_KEYS.title);
  registerField('body', fields.body, { peek: bodyText, ensure: bodyText });
  if (fields.title) registerField('title', fields.title, { peek: titleText, ensure: titleText });
  for (const [id, el] of fields.memos ?? []) registerField(`memo:${id}`, el, memoSource(id));

  // 첫 동기화가 끝나면 보관한 메모를 옮길 수 있다(예전 글이면 이제 칸을 만든다). 반영 문이 열릴 때 한다.
  const watchServerState = (state: string) => {
    if (serverStateKnown || (state !== 'sending' && state !== 'saved')) return;
    serverStateKnown = true;
    if (heldMemos.size > 0) gate.markPending();
  };
  watchServerState(doc.saveState.get());
  const offSaveState = doc.saveState.subscribe(watchServerState);

  // ── 원격 커서(awareness는 통신용 문서 제공자, 위치는 편집용 문서 기준 상대 위치) ──
  const awareness = doc.awareness;
  const keyOfText = (text: Y.AbstractType<unknown>): FieldKey | null => {
    for (const [key, b] of bindings) if (b.peekText() === text) return key;
    return null;
  };
  const publishCursor = () => {
    if (!awareness) return;
    const focused = [...bindings.entries()].find(([, b]) => b.focused);
    if (!focused) {
      awareness.setLocalStateField('cursor', null);
      return;
    }
    const [, b] = focused;
    const text = b.peekText();
    if (!text) {
      awareness.setLocalStateField('cursor', null);
      return;
    }
    const anchor = Y.createRelativePositionFromTypeIndex(text, b.el.selectionStart ?? 0, -1);
    const head = Y.createRelativePositionFromTypeIndex(text, b.el.selectionEnd ?? 0, -1);
    awareness.setLocalStateField('cursor', {
      anchor: Y.relativePositionToJSON(anchor),
      head: Y.relativePositionToJSON(head),
    });
  };
  awareness?.setLocalStateField('user', { role: options.role });
  const onAwareness = () => redrawAll();
  awareness?.on('change', onAwareness);

  const remoteCarets = (key: FieldKey) => {
    const carets: Array<{ at: number; kind: 'teacher' | 'student' }> = [];
    if (!awareness) return carets;
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID || !state || typeof state !== 'object') continue;
      const rawCursor = (state as Record<string, unknown>)['cursor'];
      if (!rawCursor || typeof rawCursor !== 'object') continue;
      const parsedHead = relativePosJsonSchema.safeParse((rawCursor as Record<string, unknown>)['head']);
      if (!parsedHead.success) continue;
      const headJson = parsedHead.data;
      if (headJson.tname !== undefined && !viewDoc.share.has(headJson.tname)) continue;

      try {
        // 아직 반영 문을 지나지 않은 위치(편집용 문서에 없는 글자)는 풀리지 않아 그리지 않는다(PLAN §6.4).
        const rel = Y.createRelativePositionFromJSON(headJson);
        const abs = Y.createAbsolutePositionFromRelativePosition(rel, viewDoc);
        if (!abs || keyOfText(abs.type) !== key) continue;
        const parsedUser = awarenessUserSchema.safeParse((state as Record<string, unknown>)['user']);
        const role = parsedUser.success ? parsedUser.data.role : undefined;
        carets.push({ at: abs.index, kind: role === 'teacher' ? 'teacher' : 'student' });
      } catch {
        continue;
      }
    }
    return carets;
  };

  const rangesFor = (key: FieldKey) =>
    highlights
      .filter(r => fieldKeyOf(r) === key)
      .map(r => ({ start: Math.min(r.start, r.end), end: Math.max(r.start, r.end) }));

  const redraw = (key: FieldKey) => {
    const mirror = mirrors.get(key);
    const b = bindings.get(key);
    if (!mirror || !b) return;
    mirror.render(b.el.value, { highlights: rangesFor(key), carets: remoteCarets(key) });
  };
  const redrawAll = () => {
    for (const key of mirrors.keys()) redraw(key);
  };

  // ── 반영(flush): PLAN §6.3 1~8번, 한 번의 동기 작업 ─────────────
  interface SavedSelection {
    start: Y.RelativePosition | null;
    end: Y.RelativePosition | null;
    direction: SelectionDirection;
  }

  const exclusive = (mutate: () => void, caretTo?: 'changed-end') => {
    applyingRemote = true; // 1. 모델을 바꾸기 전에 켠다
    try {
      for (const b of bindings.values()) b.commitPending(); // 2. 쓰던 입력 먼저 기록
      // 3. 모든 칸의 선택을 상대 위치로, 스크롤을 수치로 저장
      //    (비초점 칸도 `setRangeText(..., 'preserve')`가 단일 커서를 범위 선택으로 벌릴 수 있으므로 함께 보존한다)
      const savedSelections = new Map<FieldKey, SavedSelection>();
      const scrolls = new Map<FieldKey, number>();
      // 칸이 없어 입력을 보관 중인 메모: 입력칸 선택은 그 글 기준이라 그대로 둔다.
      const heldKeys = new Set<FieldKey>([...heldMemos.keys()].map(id => `memo:${id}` as const));
      for (const [key, b] of bindings) {
        scrolls.set(key, b.el.scrollTop);
        const text = b.peekText();
        const selStart = b.el.selectionStart ?? 0;
        const selEnd = b.el.selectionEnd ?? 0;
        savedSelections.set(key, {
          start: text
            ? Y.createRelativePositionFromTypeIndex(text, selStart, selStart === selEnd ? -1 : 0)
            : null,
          end: text ? Y.createRelativePositionFromTypeIndex(text, selEnd, -1) : null,
          direction: (b.el.selectionDirection as SelectionDirection | null) ?? 'none',
        });
      }
      mutate(); // 4. 편집용 문서 바꾸기
      adoptHeldMemos(); // 4-1. 서버 메모 칸이 왔으면 보관한 입력을 그 칸으로(검토 B02)
      // 5. 칸마다 바뀐 가장 바깥 범위만 고치기
      const renderedKeys = new Set<FieldKey>();
      let changedEnd: { key: FieldKey; at: number } | null = null;
      for (const [key, b] of bindings) {
        const r = b.render();
        if (r) {
          renderedKeys.add(key);
          if (b.focused) changedEnd = { key, at: r.endNew };
        }
      }
      // 6. 선택·스크롤 되돌리기(초점 있는 칸과 값이 바뀐 칸만, 목표와 다를 때만 선택을 건드린다)
      for (const [key, b] of bindings) {
        const top = scrolls.get(key);
        if (top !== undefined && b.el.scrollTop !== top) b.el.scrollTop = top;
        if (!b.focused && !renderedKeys.has(key)) continue;
        const saved = savedSelections.get(key);
        if (!saved) continue;
        if (heldKeys.has(key) && !(saved.start && saved.end)) {
          // 보관 글이 입력칸 앞쪽에 그대로 있고 뒤에 붙은 것은 'preserve'가 맞췄다.
          b.syncExpectedSelection();
          continue;
        }
        if (caretTo === 'changed-end' && changedEnd?.key === key) {
          const at = snapToCodePoint(b.el.value, changedEnd.at);
          b.setSelection(at, at, 'none');
        } else if (saved.start && saved.end) {
          const sRaw = Y.createAbsolutePositionFromRelativePosition(saved.start, viewDoc)?.index;
          const eRaw = Y.createAbsolutePositionFromRelativePosition(saved.end, viewDoc)?.index;
          if (sRaw !== undefined && eRaw !== undefined) {
            const s = snapToCodePoint(b.el.value, Math.min(sRaw, eRaw));
            const e = snapToCodePoint(b.el.value, Math.max(sRaw, eRaw));
            b.setSelection(s, e, saved.direction);
          } else {
            b.syncExpectedSelection();
          }
        } else {
          b.setSelection(0, 0, saved.direction);
        }
      }
      // 7. 미뤄 둔 읽기 전용 바꿈, 거울 층 다시 그리기
      applyReadOnly();
      redrawAll();
      for (const b of bindings.values()) if (b.focused) b.syncExpectedSelection();
    } finally {
      applyingRemote = false; // 8.
    }
  };

  const pullRemote = () => {
    Y.applyUpdate(viewDoc, Y.encodeStateAsUpdate(netDoc, Y.encodeStateVector(viewDoc)), FROM_NET);
    sanitizeDocNewlines(viewDoc, SANITIZE);
  };

  const flush = () => {
    if (destroyed) return;
    exclusive(pullRemote);
    gate.flushed();
    diagnostics.record({ field: '-', type: 'flush' });
  };

  const applyReadOnly = () => {
    for (const b of bindings.values()) if (b.el.readOnly !== desiredReadOnly) b.el.readOnly = desiredReadOnly;
  };

  /** 반영 문 열림을 기다리고 깨어난 마이크로태스크 시점에 조건을 재확인한다. */
  const waitUntilOpen = async (): Promise<boolean> => {
    while (!destroyed && !gate.isOpenNow()) {
      await gate.whenOpen();
    }
    return !destroyed;
  };

  const executeHistory = (action: HistoryAction) => {
    // 보류 중인 원격 변경이 있으면 먼저 flush(커서 상대 위치 보존)한 뒤 되돌리기를 따로 실행한다.
    if (gate.isPending) flush();
    breakUndoGroup();
    exclusive(() => {
      if (action === 'undo') undoManager.undo();
      else undoManager.redo();
    }, 'changed-end');
    breakUndoGroup();
  };

  const pendingHistory: HistoryAction[] = [];
  let historyWaiting = false;

  const history = (action: HistoryAction) => {
    if (destroyed) return;
    const now = clock.now();
    // PRD 9.3-12: 조합 중에는 되돌리기를 무시한다.
    if ([...bindings.values()].some(b => b.composing && now - b.lastActivityAt < config.IME_STUCK_MS)) {
      return;
    }
    if (gate.isOpenNow() && pendingHistory.length === 0) {
      executeHistory(action);
      return;
    }
    pendingHistory.push(action);
    if (historyWaiting) return;
    historyWaiting = true;
    void (async () => {
      try {
        while (!destroyed && pendingHistory.length > 0) {
          if (!(await waitUntilOpen())) return;
          while (!destroyed && pendingHistory.length > 0 && gate.isOpenNow()) {
            const next = pendingHistory.shift()!;
            executeHistory(next);
          }
        }
      } finally {
        historyWaiting = false;
      }
    })();
  };

  let readOnlyWaiting = false;

  const binding: MountedEditor = {
    viewDoc,
    diagnostics,
    pendingRemote: () => gate.isPending,

    async select(range) {
      if (!(await waitUntilOpen())) return;
      if (gate.isPending) flush();
      const b = bindings.get(fieldKeyOf(range));
      if (!b) return;
      if (b.el.ownerDocument.activeElement !== b.el) b.el.focus();
      const max = b.el.value.length;
      const s = snapToCodePoint(b.el.value, Math.max(0, Math.min(max, range.start)));
      const e = snapToCodePoint(b.el.value, Math.max(0, Math.min(max, range.end)));
      b.setSelection(Math.min(s, e), Math.max(s, e), range.direction ?? 'none');
    },

    highlight(ranges) {
      highlights = ranges;
      redrawAll();
    },

    async applyAppEdit(edit) {
      // 반영 문이 완전히 열릴 때까지(ADR-054). 버튼이 초점을 가져가면 입력칸에 초점이 없어 바로 열린다.
      if (!(await waitUntilOpen())) return;
      breakUndoGroup();
      exclusive(() => {
        if (gate.isPending) pullRemote();
        viewDoc.transact(() => {
          edit(viewDoc);
          cleanDocNewlinesInPlace(viewDoc);
        }, LOCAL);
      });
      breakUndoGroup();
      if (gate.isPending) gate.flushed();
    },

    setReadOnly(on) {
      desiredReadOnly = on;
      if ([...bindings.values()].every(b => b.el.readOnly === desiredReadOnly)) return;
      if (gate.isOpenNow()) {
        applyReadOnly();
        return;
      }
      if (readOnlyWaiting) return;
      readOnlyWaiting = true;
      void waitUntilOpen()
        .then(ok => {
          if (ok) applyReadOnly();
        })
        .finally(() => {
          readOnlyWaiting = false;
        });
    },

    undo: () => history('undo'),
    redo: () => history('redo'),
    historyState: readHistory,
    onHistoryChange(listener): Unsubscribe {
      historyListeners.add(listener);
      return () => historyListeners.delete(listener);
    },

    syncLayout() {
      for (const m of mirrors.values()) m.sync();
    },

    bindMemo(id, el) {
      if (destroyed) return () => {};
      return registerField(`memo:${id}`, el, memoSource(id));
    },

    onLargeDelete(listener): Unsubscribe {
      largeDeleteListeners.add(listener);
      return () => largeDeleteListeners.delete(listener);
    },

    onHoldChange(listener): Unsubscribe {
      holdListeners.add(listener);
      return () => holdListeners.delete(listener);
    },

    destroy() {
      destroyed = true;
      pendingHistory.length = 0;
      offSaveState();
      gate.destroy();
      viewDoc.off('update', onViewUpdate);
      netDoc.off('update', onNetUpdate);
      awareness?.off('change', onAwareness);
      awareness?.setLocalStateField('cursor', null);
      for (const unbind of [...fieldUnbinders.values()]) unbind();
      for (const m of mirrors.values()) m.destroy();
      historyListeners.clear();
      undoManager.destroy();
      viewDoc.destroy();
    },
  };

  redrawAll();
  return binding;
}

function fieldKeyOf(range: TextRange): FieldKey {
  return typeof range.field === 'string' ? range.field : `memo:${range.field.memo}`;
}

/** 서로게이트 쌍 한가운데로 인덱스가 떨어지지 않게 코드 포인트 경계로 맞춘다. */
function snapToCodePoint(text: string, index: number): number {
  const clamped = Math.max(0, Math.min(text.length, index));
  if (clamped > 0 && clamped < text.length) {
    const prev = text.charCodeAt(clamped - 1);
    const next = text.charCodeAt(clamped);
    if (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      return clamped + 1;
    }
  }
  return clamped;
}

function hasDisallowedNewline(doc: Y.Doc): boolean {
  if (doc.share.has(DOC_KEYS.title)) {
    const t = doc.getText(DOC_KEYS.title).toString();
    if (t.includes('\n') || t.includes('\r')) return true;
  }
  if (doc.share.has(DOC_KEYS.body)) {
    if (doc.getText(DOC_KEYS.body).toString().includes('\r')) return true;
  }
  if (doc.share.has(DOC_KEYS.memo)) {
    for (const val of doc.getMap(DOC_KEYS.memo).values()) {
      if (val instanceof Y.Text && val.toString().includes('\r')) return true;
    }
  }
  return false;
}

function cleanYTextInPlace(text: Y.Text, singleLine: boolean): void {
  const s = text.toString();
  const bad = singleLine ? s.includes('\n') || s.includes('\r') : s.includes('\r');
  if (!bad) return;
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s.charCodeAt(i);
    if (singleLine) {
      if (ch === 0x0a || ch === 0x0d) text.delete(i, 1);
    } else if (ch === 0x0d) {
      text.delete(i, 1);
      if (s.charCodeAt(i + 1) !== 0x0a) text.insert(i, '\n');
    }
  }
}

function cleanDocNewlinesInPlace(doc: Y.Doc): void {
  if (doc.share.has(DOC_KEYS.title)) cleanYTextInPlace(doc.getText(DOC_KEYS.title), true);
  if (doc.share.has(DOC_KEYS.body)) cleanYTextInPlace(doc.getText(DOC_KEYS.body), false);
  if (doc.share.has(DOC_KEYS.memo)) {
    for (const val of doc.getMap(DOC_KEYS.memo).values()) {
      if (val instanceof Y.Text) cleanYTextInPlace(val, false);
    }
  }
}

function sanitizeDocNewlines(doc: Y.Doc, origin: symbol): void {
  if (!hasDisallowedNewline(doc)) return;
  doc.transact(() => cleanDocNewlinesInPlace(doc), origin);
}
