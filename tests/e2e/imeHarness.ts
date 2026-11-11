import {
  expect,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from '@playwright/test';
import { E2E_DEV_SECRET } from './constants.ts';

/**
 * 반영 문이 닫혀 있는 동안 앱이 본문 `<textarea>`에 가한 DOM 변경 횟수.
 * PRD 9.3-11 · PLAN §6.3 · §10.3의 "문이 닫힌 동안 쓰기 0회" 단언에 사용한다.
 */
export interface WriteGuardCounts {
  readonly value: number;
  readonly setRangeText: number;
  readonly setSelectionRange: number;
  readonly readOnly: number;
  readonly focus: number;
  readonly blur: number;
  readonly domMove: number;
  readonly total: number;
}

export interface CompositionEventLog {
  readonly type: 'start' | 'update' | 'end';
  readonly data: string;
}

export interface BodyProbeSnapshot {
  readonly composing: boolean;
  readonly compositionStarts: number;
  readonly compositionUpdates: number;
  readonly compositionEnds: number;
  readonly events: readonly CompositionEventLog[];
  readonly windowWrites: WriteGuardCounts;
  readonly composingWrites: WriteGuardCounts;
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

interface WindowProbeApi {
  reset(): void;
  read(): BodyProbeSnapshot;
  runAsTest<T>(fn: () => T): T;
}

declare global {
  interface Window {
    __geulbangImeProbe?: WindowProbeApi;
  }
}

export const ZERO_WRITES: WriteGuardCounts = {
  value: 0,
  setRangeText: 0,
  setSelectionRange: 0,
  readOnly: 0,
  focus: 0,
  blur: 0,
  domMove: 0,
  total: 0,
};

let docCounter = 0;

/**
 * 시험마다 겹치지 않는 개발 문서 ID(`^dev-[a-z0-9-]{1,40}$`)를 만든다.
 */
export function uniqueImeDocId(slug: string): string {
  docCounter += 1;
  const cleanSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 18);
  const stamp = Date.now().toString(36).slice(-6);
  const suffix = `ime-${cleanSlug}-${stamp}-${docCounter}`.slice(0, 40);
  return `dev-${suffix}`;
}

/**
 * 페이지 스크립트가 실행되기 전에 `<textarea data-testid="dev-body-input">`에
 * 조합 이벤트 듣개와 DOM 쓰기 감시 래퍼를 설치한다.
 */
export async function installBodyProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const TARGET_TEST_ID = 'dev-body-input';

    type MutableCounts = {
      value: number;
      setRangeText: number;
      setSelectionRange: number;
      readOnly: number;
      focus: number;
      blur: number;
      domMove: number;
    };

    const emptyCounts = (): MutableCounts => ({
      value: 0,
      setRangeText: 0,
      setSelectionRange: 0,
      readOnly: 0,
      focus: 0,
      blur: 0,
      domMove: 0,
    });

    const withTotal = (c: MutableCounts): WriteGuardCounts => ({
      ...c,
      total: c.value + c.setRangeText + c.setSelectionRange + c.readOnly + c.focus + c.blur + c.domMove,
    });

    let armed = false;
    let testActing = false;
    let composing = false;
    let compositionStarts = 0;
    let compositionUpdates = 0;
    let compositionEnds = 0;
    const events: Array<{ type: 'start' | 'update' | 'end'; data: string }> = [];
    let windowCounts = emptyCounts();
    let composingCounts = emptyCounts();

    const isBodyTextarea = (node: unknown): node is HTMLTextAreaElement =>
      node instanceof HTMLTextAreaElement && node.getAttribute('data-testid') === TARGET_TEST_ID;

    const recordWrite = (kind: keyof MutableCounts) => {
      if (!armed || testActing) return;
      windowCounts[kind] += 1;
      if (composing) {
        composingCounts[kind] += 1;
      }
    };

    // 조합 시작은 캡처 단계에서 가장 먼저 켜고, 조합 끝은 버블 단계에서 내려서
    // 앱의 compositionstart/compositionend 핸들러 안쪽 쓰기까지 빠짐없이 포착한다.
    document.addEventListener(
      'compositionstart',
      e => {
        if (!isBodyTextarea(e.target)) return;
        composing = true;
        if (!armed) return;
        compositionStarts += 1;
        events.push({ type: 'start', data: e.data });
      },
      true,
    );

    document.addEventListener(
      'compositionupdate',
      e => {
        if (!isBodyTextarea(e.target) || !armed) return;
        compositionUpdates += 1;
        events.push({ type: 'update', data: e.data });
      },
      true,
    );

    document.addEventListener(
      'compositionend',
      e => {
        if (!isBodyTextarea(e.target)) return;
        if (armed) {
          compositionEnds += 1;
          events.push({ type: 'end', data: e.data });
        }
        composing = false;
      },
      false,
    );

    const taProto = HTMLTextAreaElement.prototype;
    const valueDesc = Object.getOwnPropertyDescriptor(taProto, 'value');
    if (valueDesc?.get && valueDesc.set) {
      const origGet = valueDesc.get;
      const origSet = valueDesc.set;
      Object.defineProperty(taProto, 'value', {
        configurable: true,
        enumerable: valueDesc.enumerable ?? true,
        get(this: HTMLTextAreaElement): string {
          return origGet.call(this) as string;
        },
        set(this: HTMLTextAreaElement, next: string) {
          if (isBodyTextarea(this)) recordWrite('value');
          origSet.call(this, next);
        },
      });
    }

    const readOnlyDesc = Object.getOwnPropertyDescriptor(taProto, 'readOnly');
    if (readOnlyDesc?.get && readOnlyDesc.set) {
      const origGet = readOnlyDesc.get;
      const origSet = readOnlyDesc.set;
      Object.defineProperty(taProto, 'readOnly', {
        configurable: true,
        enumerable: readOnlyDesc.enumerable ?? true,
        get(this: HTMLTextAreaElement): boolean {
          return origGet.call(this) as boolean;
        },
        set(this: HTMLTextAreaElement, next: boolean) {
          if (isBodyTextarea(this)) recordWrite('readOnly');
          origSet.call(this, next);
        },
      });
    }

    const origSetRangeText = taProto.setRangeText as (this: HTMLTextAreaElement, ...args: unknown[]) => void;
    Object.defineProperty(taProto, 'setRangeText', {
      configurable: true,
      writable: true,
      value: function (this: HTMLTextAreaElement, ...args: unknown[]): void {
        if (isBodyTextarea(this)) recordWrite('setRangeText');
        origSetRangeText.apply(this, args);
      },
    });

    const origSetSelectionRange = taProto.setSelectionRange;
    taProto.setSelectionRange = function (
      this: HTMLTextAreaElement,
      start: number | null,
      end: number | null,
      direction?: 'forward' | 'backward' | 'none',
    ): void {
      if (isBodyTextarea(this)) recordWrite('setSelectionRange');
      origSetSelectionRange.call(this, start, end, direction);
    };

    const htmlProto = HTMLElement.prototype;
    const origFocus = htmlProto.focus;
    htmlProto.focus = function (this: HTMLElement, options?: FocusOptions): void {
      if (isBodyTextarea(this)) recordWrite('focus');
      origFocus.call(this, options);
    };

    const origBlur = htmlProto.blur;
    htmlProto.blur = function (this: HTMLElement): void {
      if (isBodyTextarea(this)) recordWrite('blur');
      origBlur.call(this);
    };

    const attachObserver = () => {
      const root = document.documentElement;
      if (!root) return;
      const observer = new MutationObserver(records => {
        if (!armed || testActing) return;
        for (const r of records) {
          for (const node of [...r.addedNodes, ...r.removedNodes]) {
            if (isBodyTextarea(node)) {
              recordWrite('domMove');
            }
          }
        }
      });
      observer.observe(root, { childList: true, subtree: true });
    };

    if (document.documentElement) {
      attachObserver();
    } else {
      window.addEventListener('DOMContentLoaded', attachObserver, { once: true });
    }

    window.__geulbangImeProbe = {
      reset() {
        armed = true;
        compositionStarts = 0;
        compositionUpdates = 0;
        compositionEnds = 0;
        events.length = 0;
        windowCounts = emptyCounts();
        composingCounts = emptyCounts();
      },
      read(): BodyProbeSnapshot {
        const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-testid="${TARGET_TEST_ID}"]`);
        return {
          composing,
          compositionStarts,
          compositionUpdates,
          compositionEnds,
          events: [...events],
          windowWrites: withTotal(windowCounts),
          composingWrites: withTotal(composingCounts),
          value: el?.value ?? '',
          selectionStart: el?.selectionStart ?? -1,
          selectionEnd: el?.selectionEnd ?? -1,
        };
      },
      runAsTest<T>(fn: () => T): T {
        testActing = true;
        try {
          return fn();
        } finally {
          testActing = false;
        }
      },
    };
  });
}

/**
 * Hocuspocus 웹소켓 바이너리 프레임이 대상 문서(`doc:${docId}`)의 Yjs Update(MessageType.Sync=0, Update=2)인지 판정한다.
 * awareness·하트비트·무상태 이벤트를 걸러내고 실제 원격 글 변경 도착만 기다리기 위해 쓴다.
 */
function isDocYjsUpdateFrame(payload: string | Buffer, docId: string): boolean {
  const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const docChannel = Buffer.from(`doc:${docId}`, 'utf8');
  if (docChannel.length >= 128) return false;
  if (buf.length < 1 + docChannel.length + 2) return false;
  if (buf[0] !== docChannel.length) return false;
  if (!buf.subarray(1, 1 + docChannel.length).equals(docChannel)) return false;
  const messageType = buf[1 + docChannel.length];
  const syncKind = buf[2 + docChannel.length];
  return messageType === 0 && syncKind === 2;
}

interface TrackedSocket {
  closed: boolean;
  docUpdateFrames: number;
}

/**
 * 학생 페이지가 연 `/ws` 연결들에서 문서 Yjs Update 수신 횟수를 추적한다.
 * 고정 `waitForTimeout` 없이 원격 변경이 학생 `netDoc`에 도착한 시점을 조건으로 기다린다.
 */
export class StudentSocketTracker {
  private readonly sockets: TrackedSocket[] = [];
  private readonly docId: string;

  constructor(page: Page, docId: string) {
    this.docId = docId;
    page.on('websocket', ws => {
      if (!ws.url().endsWith('/ws')) return;
      const entry: TrackedSocket = { closed: ws.isClosed(), docUpdateFrames: 0 };
      this.sockets.push(entry);
      ws.on('framereceived', ({ payload }) => {
        if (isDocYjsUpdateFrame(payload, this.docId)) {
          entry.docUpdateFrames += 1;
        }
      });
      ws.on('close', () => {
        entry.closed = true;
      });
    });
  }

  checkpoint(): readonly number[] {
    return this.sockets.map(s => s.docUpdateFrames);
  }

  hasReceivedSince(before: readonly number[]): boolean {
    const openEntries = this.sockets
      .map((s, idx) => ({ s, beforeCount: before[idx] ?? 0 }))
      .filter(({ s }) => !s.closed);
    if (openEntries.length === 0) return false;
    return openEntries.every(({ s, beforeCount }) => s.docUpdateFrames > beforeCount);
  }
}

/**
 * Chromium CDP `Input.imeSetComposition` + `Input.insertText`로 한글 자모 조합을 재현한다.
 */
export class CdpHangulIme {
  private readonly cdp: CDPSession;

  constructor(cdp: CDPSession) {
    this.cdp = cdp;
  }

  /** 조합 중 글자를 놓거나 갱신한다(`compositionstart` 또는 `compositionupdate` 발생). */
  async setComposition(text: string): Promise<void> {
    await this.cdp.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });
  }

  /** 현재 열려 있는 조합을 `text`로 확정한다(`compositionend` 발생). */
  async commit(text: string): Promise<void> {
    await this.cdp.send('Input.insertText', { text });
  }
}

export interface ImeDualRig {
  readonly docId: string;
  readonly studentContext: BrowserContext;
  readonly teacherContext: BrowserContext;
  readonly studentPage: Page;
  readonly teacherPage: Page;
  readonly studentBody: Locator;
  readonly teacherBody: Locator;
  readonly ime: CdpHangulIme;
  readonly studentSockets: StudentSocketTracker;
  resetProbe(): Promise<void>;
  readProbe(): Promise<BodyProbeSnapshot>;
  seedInitialBody(text: string, studentCaretAt?: number): Promise<void>;
  teacherEditAndAwaitArrival(edit: {
    readonly start: number;
    readonly end: number;
    readonly insertText: string;
  }): Promise<void>;
  close(): Promise<void>;
}

async function waitEditorReady(page: Page): Promise<void> {
  await expect(page.getByTestId('dev-auth-alert')).toHaveCount(0);
  await expect(page.getByTestId('dev-conn-state')).toContainText('연결됨');
  await expect(page.getByTestId('dev-save-state')).toContainText('저장됨');
  await expect(page.getByTestId('dev-bot-status')).toContainText('연결됨');
}

/**
 * 같은 개발 문서(`doc=dev-ime-...`)에 학생 컨텍스트(`role=student`)와 교사 컨텍스트(`role=teacher`)를 연다.
 * 두 컨텍스트를 분리해 `sessionStorage`·`IndexedDB`·포커스가 서로 간섭하지 않도록 실제 두 기기 조건을 만든다.
 */
export async function openImeDualRig(browser: Browser, slug: string): Promise<ImeDualRig> {
  const docId = uniqueImeDocId(slug);
  const studentContext = await browser.newContext();
  const teacherContext = await browser.newContext();

  const studentPage = await studentContext.newPage();
  const teacherPage = await teacherContext.newPage();

  await installBodyProbe(studentPage);
  const studentSockets = new StudentSocketTracker(studentPage, docId);
  const cdp = await studentContext.newCDPSession(studentPage);
  const ime = new CdpHangulIme(cdp);

  const studentUrl = `/dev/editor?doc=${docId}#dev=${E2E_DEV_SECRET}`;
  const teacherUrl = `/dev/editor?doc=${docId}&role=teacher#dev=${E2E_DEV_SECRET}`;

  await Promise.all([studentPage.goto(studentUrl), teacherPage.goto(teacherUrl)]);
  await Promise.all([waitEditorReady(studentPage), waitEditorReady(teacherPage)]);

  const studentBody = studentPage.getByTestId('dev-body-input');
  const teacherBody = teacherPage.getByTestId('dev-body-input');

  const resetProbe = async (): Promise<void> => {
    await studentPage.evaluate(() => {
      window.__geulbangImeProbe?.reset();
    });
  };

  const readProbe = async (): Promise<BodyProbeSnapshot> => {
    return studentPage.evaluate(() => {
      const probe = window.__geulbangImeProbe;
      if (!probe) throw new Error('IME probe not installed');
      return probe.read();
    });
  };

  const seedInitialBody = async (text: string, studentCaretAt = text.length): Promise<void> => {
    await studentPage.evaluate(() => {
      window.__geulbangImeProbe?.runAsTest(() => {
        const el = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="dev-body-input"]');
        el?.focus();
      });
    });

    if (text.length > 0) {
      await cdp.send('Input.insertText', { text });
      await expect(studentBody).toHaveValue(text);
      await expect(teacherBody).toHaveValue(text);
    }

    await studentPage.evaluate(caret => {
      window.__geulbangImeProbe?.runAsTest(() => {
        const el = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="dev-body-input"]');
        if (!el) throw new Error('student body textarea missing');
        el.focus();
        el.setSelectionRange(caret, caret, 'none');
      });
      document.dispatchEvent(new Event('selectionchange'));
    }, studentCaretAt);

    await resetProbe();
  };

  const teacherEditAndAwaitArrival = async (edit: {
    readonly start: number;
    readonly end: number;
    readonly insertText: string;
  }): Promise<void> => {
    const beforeTeacherText = await teacherBody.inputValue();
    const expectedTeacherText =
      beforeTeacherText.slice(0, edit.start) + edit.insertText + beforeTeacherText.slice(edit.end);
    const beforeFrames = studentSockets.checkpoint();
    const teacherCdp = await teacherContext.newCDPSession(teacherPage);
    try {
      await teacherPage.evaluate(
        ({ s, e }) => {
          const el = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="dev-body-input"]');
          if (!el) throw new Error('teacher body textarea missing');
          el.focus();
          el.setSelectionRange(s, e, 'none');
        },
        { s: edit.start, e: edit.end },
      );

      if (edit.insertText.length > 0) {
        await teacherCdp.send('Input.insertText', { text: edit.insertText });
      } else if (edit.end > edit.start) {
        await teacherPage.keyboard.press('Backspace');
      }

      await expect(teacherBody).toHaveValue(expectedTeacherText);

      // 교사 입력칸의 초점을 즉시 내려 교사 쪽 반영 문을 열어 둔다(이후 학생 입력이 교사 화면에 바로 반영되도록).
      await teacherPage.evaluate(() => {
        const el = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="dev-body-input"]');
        el?.blur();
      });
    } finally {
      await teacherCdp.detach();
    }

    await expect
      .poll(() => studentSockets.hasReceivedSince(beforeFrames), {
        message: '교사 원격 변경 프레임이 학생 웹소켓에 도착해야 함',
        timeout: 5_000,
      })
      .toBe(true);

    // 웹소켓 message 이벤트 핸들러(netDoc 반영 + gate.markPending)가 돌아간 뒤의 상태를 보장한다.
    await studentPage.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  };

  return {
    docId,
    studentContext,
    teacherContext,
    studentPage,
    teacherPage,
    studentBody,
    teacherBody,
    ime,
    studentSockets,
    resetProbe,
    readProbe,
    seedInitialBody,
    teacherEditAndAwaitArrival,
    async close() {
      await cdp.detach().catch(() => {});
      await Promise.all([studentContext.close(), teacherContext.close()]);
    },
  };
}

/**
 * 반영 문이 열려 원격 변경과 학생 입력이 모두 합쳐진 뒤의 공통 불변조건을 검증한다.
 */
export async function assertConvergedAndProtected(
  rig: ImeDualRig,
  expected: {
    readonly allowedTexts: readonly string[];
    readonly lastStudentChar: string;
    readonly syllablesTyped: number;
  },
): Promise<BodyProbeSnapshot> {
  await expect
    .poll(
      async () => {
        const [sVal, tVal] = await Promise.all([rig.studentBody.inputValue(), rig.teacherBody.inputValue()]);
        return sVal === tVal && expected.allowedTexts.includes(sVal) ? sVal : null;
      },
      {
        message: `학생·교사 textarea 값이 수렴해야 함 (기대 후보: ${expected.allowedTexts.join(' | ')})`,
        timeout: 8_000,
      },
    )
    .not.toBeNull();

  const studentText = await rig.studentBody.inputValue();
  const teacherText = await rig.teacherBody.inputValue();
  expect(studentText).toBe(teacherText);
  expect(expected.allowedTexts).toContain(studentText);

  const probe = await rig.readProbe();
  expect(probe.value).toBe(studentText);
  expect(probe.composing).toBe(false);

  // 학생 커서는 단일 캐럿이고 바로 앞 글자가 학생이 마지막에 친 글자여야 한다.
  expect(probe.selectionStart).toBe(probe.selectionEnd);
  expect(probe.selectionStart).toBeGreaterThan(0);
  const charBeforeCaret = probe.value.slice(
    probe.selectionStart - expected.lastStudentChar.length,
    probe.selectionStart,
  );
  expect(charBeforeCaret).toBe(expected.lastStudentChar);

  // 조합 시작·끝 횟수가 친 음절 수와 정확히 일치해야 한다(중간에 조합이 끊기지 않음).
  expect(probe.compositionStarts).toBe(expected.syllablesTyped);
  expect(probe.compositionEnds).toBe(expected.syllablesTyped);

  // 조합이 열려 있던 동안 앱에 의한 DOM 쓰기는 끝까지 0회여야 한다.
  expect(probe.composingWrites).toEqual(ZERO_WRITES);
  // 그리고 반영 문이 열린 뒤 실제 flush가 일어나 감시기가 setRangeText를 포착했음을 함께 확인한다.
  expect(probe.windowWrites.setRangeText).toBeGreaterThanOrEqual(1);

  return probe;
}
