import {
  codePointBefore,
  diffForInput,
  isHangulCodePoint,
  outerChangedRange,
  type TextChange,
} from '@geulbang/core/text';
import type * as Y from 'yjs';
import type { Diagnostics } from './diagnostics.ts';
import type { FieldState } from './gate.ts';
import { historyActionFromInput, historyActionFromKey } from './keys.ts';

const CARET_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export type FieldElement = HTMLTextAreaElement | HTMLInputElement;
export type SelectionDirection = 'forward' | 'backward' | 'none';

/**
 * 입력칸 종류에 맞춰 허용되는 줄바꿈 모양으로 맞춘다(PRD 9.3-10).
 * - `<input>`(제목): `\r`과 `\n`을 모두 제거(HTML `<input type="text">` 명세와 동일)
 * - `<textarea>`(본문·메모): `\r\n`과 단독 `\r`을 `\n` 하나로 통일
 */
export function normalizeFieldValue(el: FieldElement, raw: string): string {
  if (el instanceof HTMLInputElement) {
    return raw.includes('\n') || raw.includes('\r') ? raw.replace(/[\r\n]/g, '') : raw;
  }
  return raw.includes('\r') ? raw.replace(/\r\n?/g, '\n') : raw;
}

export interface FieldTextSource {
  /** 읽기 전용 조회. 메모 칸에 아직 글자가 없으면 새 `Y.Text`를 만들지 않고 `undefined`를 돌려준다. */
  readonly peek: () => Y.Text | undefined;
  /**
   * 실제 글자 입력을 기록할 때만 호출해 `Y.Text`를 가져오거나 생성한다. 아직 만들면 안 되면(서버 메모 칸을
   * 받기 전, 검토 B02) `undefined`를 돌려주고, 그 입력은 `hold`가 맡는다.
   */
  readonly ensure: () => Y.Text | undefined;
  /** 칸이 생기기 전 입력을 보관한다(칸이 생기면 편집기가 옮긴다). */
  readonly hold?: (change: TextChange) => void;
  /** 보관 중인 글자(칸이 없을 때 입력칸에 보일 값). 없으면 undefined */
  readonly held?: () => string | undefined;
}

export interface FieldDeps {
  readonly name: string;
  readonly now: () => number;
  readonly stuckMs: number;
  /** 반영 중이면 true: 그사이 생긴 input·selectionchange는 내 입력으로 치지 않는다(PRD 9.3-8). */
  readonly applyingRemote: () => boolean;
  /** 내 입력 하나를 편집용 문서에 기록한다(출처 LOCAL). */
  readonly record: (text: Y.Text, change: TextChange) => void;
  /** 입력칸에 무슨 일이 생김 → 반영 문 다시 판단 */
  readonly poke: () => void;
  /** 커서가 움직임(거울 층·원격 커서 갱신) */
  readonly onSelection: () => void;
  readonly onFocus?: () => void;
  readonly diagnostics: Diagnostics;
}

interface ExpectedSelection {
  readonly start: number | null;
  readonly end: number | null;
  readonly direction: string | null;
}

/**
 * 입력칸 하나(`textarea` 또는 한 줄 `input`)와 편집용 `Y.Text` 하나를 잇는다(PLAN §6.3 `field.ts`).
 * 입력칸 값은 이 객체만 쓴다. 쓰는 때는 `render`(반영 문이 열렸을 때)와 처음 붙일 때뿐이다(PRD 9.3-11).
 */
export class FieldBinding implements FieldState {
  readonly el: FieldElement;
  readonly name: string;
  composing = false;
  lastActivityAt: number;
  caretMovedByUser = false;
  focused: boolean;
  /** 입력칸에 마지막으로 반영·기록된 정규화 문자열 */
  lastRendered: string;

  private readonly source: FieldTextSource;
  private readonly deps: FieldDeps;
  private expectedSelection: ExpectedSelection | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(el: FieldElement, source: FieldTextSource, deps: FieldDeps) {
    this.el = el;
    this.name = deps.name;
    this.source = source;
    this.deps = deps;
    this.lastActivityAt = deps.now() - 1e9;
    this.focused = el.ownerDocument.activeElement === el;

    // 처음 붙일 때 한 번 값을 쓴다(아직 입력·조합이 없다, `peek`만 써서 빈 메모를 만들지 않는다).
    const initial = normalizeFieldValue(el, this.modelText());
    if (el.value !== initial) el.value = initial;
    this.lastRendered = normalizeFieldValue(el, el.value);
    this.syncExpectedSelection();

    // PRD 9.3-13: 자동 고침·자동 대문자·자동 완성·맞춤법 밑줄 끔
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('autocomplete', 'off');
    el.spellcheck = false;

    this.listen(el, 'compositionstart', e => this.activity(e, () => (this.composing = true)));
    this.listen(el, 'compositionupdate', e => this.activity(e));
    this.listen(el, 'compositionend', e => this.activity(e, () => (this.composing = false)));
    this.listen(el, 'beforeinput', e => {
      if (historyActionFromInput(e as InputEvent)) return;
      this.activity(e);
    });
    this.listen(el, 'input', e => this.onInput(e as InputEvent));
    this.listen(el, 'keydown', e => {
      const ke = e as KeyboardEvent;
      // 되돌리기 키와 단독 Ctrl/Meta는 입력 활동이 아니므로 멈춤 시각을 갱신하지 않는다.
      if (historyActionFromKey(ke)) return;
      if (!ke.isComposing && ke.keyCode !== 229 && (ke.key === 'Control' || ke.key === 'Meta')) return;
      const key = ke.key;
      this.activity(e, () => {
        if (
          this.composing &&
          !ke.isComposing &&
          ke.keyCode !== 229 &&
          key !== 'Process' &&
          key !== 'Dead' &&
          key !== 'Unidentified' &&
          !ke.ctrlKey &&
          !ke.metaKey &&
          !ke.altKey &&
          key !== 'Shift' &&
          key !== 'Alt' &&
          key !== 'CapsLock'
        ) {
          this.composing = false;
        }
        if (CARET_KEYS.has(key) && !ke.isComposing) this.caretMovedByUser = true;
      });
    });
    this.listen(el, 'focus', () => {
      this.focused = true;
      this.syncExpectedSelection();
      deps.onFocus?.();
      this.trace('focus');
      deps.poke();
      deps.onSelection();
    });
    this.listen(el, 'blur', () => {
      this.focused = false;
      this.composing = false;
      this.trace('blur');
      deps.poke();
      deps.onSelection();
    });
    this.listen(el, 'pointerup', () => {
      if (deps.applyingRemote()) return;
      this.caretMovedByUser = true;
      this.syncExpectedSelection();
      deps.poke();
    });
    const doc = el.ownerDocument;
    this.listen(doc, 'selectionchange', () => {
      if (doc.activeElement !== el || deps.applyingRemote()) return;
      const sameAsExpected =
        this.expectedSelection !== null &&
        el.selectionStart === this.expectedSelection.start &&
        el.selectionEnd === this.expectedSelection.end &&
        el.selectionDirection === this.expectedSelection.direction;
      this.syncExpectedSelection();
      if (!sameAsExpected) {
        this.caretMovedByUser = true;
        deps.poke();
      }
      this.trace('selectionchange');
      deps.onSelection();
    });
  }

  peekText(): Y.Text | undefined {
    return this.source.peek();
  }

  clearStuckComposing(): void {
    this.composing = false;
  }

  syncExpectedSelection(): void {
    this.expectedSelection = {
      start: this.el.selectionStart,
      end: this.el.selectionEnd,
      direction: this.el.selectionDirection,
    };
  }

  /** 목표 선택이 현재 선택과 다를 때만 `setSelectionRange`를 호출한다. */
  setSelection(start: number, end: number, direction: SelectionDirection = 'none'): void {
    const curDir = (this.el.selectionDirection as SelectionDirection | null) ?? 'none';
    if (
      this.el.selectionStart !== start ||
      this.el.selectionEnd !== end ||
      (start !== end && curDir !== direction)
    ) {
      this.el.setSelectionRange(start, end, direction);
    }
    this.syncExpectedSelection();
  }

  charBeforeCaret(): number | undefined {
    const value = this.el.value;
    const start = this.el.selectionStart ?? 0;
    const end = this.el.selectionEnd ?? start;
    const beforeStart = codePointBefore(value, start);
    if (start === end) return beforeStart;
    if (beforeStart !== undefined && isHangulCodePoint(beforeStart)) return beforeStart;
    const beforeEnd = codePointBefore(value, end);
    if (beforeEnd !== undefined && isHangulCodePoint(beforeEnd)) return beforeEnd;
    return beforeStart ?? beforeEnd;
  }

  charBeforeSelectionEnd(): number | undefined {
    const start = this.el.selectionStart ?? 0;
    const end = this.el.selectionEnd ?? start;
    if (start === end) return undefined;
    return codePointBefore(this.el.value, end);
  }

  /** 입력칸에 있는데 아직 기록하지 않은 입력을 기록한다(반영 직전·입력 시 호출, PLAN §6.3 flush 2번). */
  commitPending(): void {
    const raw = this.el.value;
    const value = normalizeFieldValue(this.el, raw);
    if (value === this.lastRendered) return;
    const rawCaret = this.el.selectionEnd ?? raw.length;
    const caret = raw === value ? rawCaret : normalizeFieldValue(this.el, raw.slice(0, rawCaret)).length;
    const change = diffForInput(this.lastRendered, value, caret);
    if (change && (change.deleteCount > 0 || change.insert.length > 0)) {
      const text = this.source.ensure();
      if (text) this.deps.record(text, change);
      else this.source.hold?.(change);
    }
    this.lastRendered = value;
  }

  /**
   * 편집용 문서의 지금 글을 입력칸에 반영한다(반영 문이 열렸을 때만 부른다).
   * 바뀐 가장 바깥 범위 하나만 `setRangeText`로 고친다. 고친 범위를 돌려준다.
   */
  render(): { start: number; endNew: number } | null {
    const next = normalizeFieldValue(this.el, this.modelText());
    const domCurrent = this.el.value;
    if (next === this.lastRendered && next === domCurrent) return null;
    const range = outerChangedRange(domCurrent, next);
    if (!range) {
      this.lastRendered = normalizeFieldValue(this.el, this.el.value);
      return null;
    }
    this.el.setRangeText(next.slice(range.start, range.endNew), range.start, range.endOld, 'preserve');
    this.lastRendered = normalizeFieldValue(this.el, this.el.value);
    return { start: range.start, endNew: range.endNew };
  }

  destroy(): void {
    for (const off of this.cleanups.splice(0)) off();
  }

  /** 이 칸이 보여야 할 글: 편집용 문서의 칸, 칸이 아직 없으면 보관 중인 입력(보관한 입력을 지우지 않게). */
  private modelText(): string {
    return this.source.peek()?.toString() ?? this.source.held?.() ?? '';
  }

  private onInput(e: InputEvent): void {
    if (this.deps.applyingRemote()) return;
    this.caretMovedByUser = false;
    this.syncExpectedSelection();
    this.activity(e, () => {
      if (
        this.composing &&
        !e.isComposing &&
        e.inputType !== 'insertCompositionText' &&
        e.inputType !== 'deleteCompositionText'
      ) {
        this.composing = false;
      }
      this.commitPending();
    });
    this.deps.onSelection();
  }

  private activity(e: Event, apply?: () => void): void {
    const now = this.deps.now();
    if (this.composing && now - this.lastActivityAt >= this.deps.stuckMs) {
      this.composing = false;
    }
    this.lastActivityAt = now;
    apply?.();
    this.trace(e.type, e);
    this.deps.poke();
  }

  private trace(type: string, e?: Event): void {
    if (!this.deps.diagnostics.enabled) return;
    const input = e as InputEvent | undefined;
    const key = e as KeyboardEvent | undefined;
    this.deps.diagnostics.record({
      field: this.name,
      type,
      ...(input && 'inputType' in input ? { inputType: input.inputType, data: input.data } : {}),
      ...(key && 'key' in key ? { key: key.key } : {}),
      ...(e && 'isComposing' in e ? { isComposing: (e as KeyboardEvent).isComposing } : {}),
      value: this.el.value,
      selectionStart: this.el.selectionStart,
      selectionEnd: this.el.selectionEnd,
    });
  }

  private listen(target: EventTarget, type: string, handler: (e: Event) => void): void {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }
}
