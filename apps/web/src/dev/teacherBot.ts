import { koDev } from '@geulbang/core/copy/dev';
import { DOC_KEYS } from '@geulbang/core';
import type { Config } from '@geulbang/core/config';
import { ko } from '@geulbang/core/copy';
import type { Credential } from '@geulbang/core/protocol';
import * as Y from 'yjs';
import { z } from 'zod';
import { createMemoryStore } from '../adapters/local/localDocStore.ts';
import { createRealtimeAdapter } from '../adapters/realtime/session.ts';
import { value, type Observable } from '../ports/observable.ts';
import type { ConnectionState, RealtimeSession, SyncedDoc } from '../ports/realtime.ts';

/**
 * `/dev/editor` 교사 봇(PLAN §11.5 P2-4).
 * 같은 페이지 안에서 따로 연 두 번째 실시간 세션(교사 역할 자격 + 메모리 저장소)으로
 * 실제 서버(웹소켓·Hocuspocus·SQLite)를 거쳐 같은 문서를 고치고, awareness에 교사 커서를 올린다.
 */
export type BotScenario =
  'before-caret' | 'after-caret' | 'inside-word' | 'same-paragraph' | 'delete-across-caret';

export type BotDelayMs = 0 | 300 | 1000;

export const BOT_DELAY_OPTIONS: readonly BotDelayMs[] = [0, 300, 1000];
const CONTINUOUS_INTERVAL_MS = 1000;

export interface StudentSelection {
  readonly start: number;
  readonly end: number;
  readonly head: number;
}

export interface BotTokens {
  readonly before: string;
  readonly after: string;
  readonly word: string;
  readonly paragraphHead: string;
  readonly paragraphTail: string;
  readonly tickPrefix: string;
  readonly tickSuffix: string;
}

export const defaultBotTokens: BotTokens = {
  before: koDev.botTokenBefore,
  after: koDev.botTokenAfter,
  word: koDev.botTokenWord,
  paragraphHead: koDev.botTokenParagraphHead,
  paragraphTail: koDev.botTokenParagraphTail,
  tickPrefix: koDev.botTokenTickPrefix,
  tickSuffix: koDev.botTokenTickSuffix,
};

export interface PlannedBotEdit {
  readonly deleteAt: number;
  readonly deleteCount: number;
  readonly insertText: string;
  readonly caretAt: number;
  readonly noop?: boolean;
}

const yIdSchema = z.object({
  client: z.number().int().nonnegative(),
  clock: z.number().int().nonnegative(),
});

const relativePosJsonSchema = z
  .object({
    tname: z.string().optional(),
    type: yIdSchema.optional(),
    item: yIdSchema.optional(),
    assoc: z.number().int().optional(),
  })
  .refine(v => v.tname !== undefined || v.type !== undefined || v.item !== undefined);

const cursorStateSchema = z.object({
  anchor: relativePosJsonSchema,
  head: relativePosJsonSchema,
});

/** 서로게이트 쌍 한가운데로 인덱스가 떨어지지 않게 코드 포인트 경계로 맞춘다. */
export function snapToCodePoint(text: string, index: number): number {
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

function stepCodePoints(text: string, from: number, delta: number): number {
  let idx = snapToCodePoint(text, from);
  if (delta < 0) {
    for (let i = 0; i < -delta && idx > 0; i++) {
      idx--;
      if (idx > 0) {
        const prev = text.charCodeAt(idx - 1);
        const cur = text.charCodeAt(idx);
        if (prev >= 0xd800 && prev <= 0xdbff && cur >= 0xdc00 && cur <= 0xdfff) idx--;
      }
    }
  } else if (delta > 0) {
    for (let i = 0; i < delta && idx < text.length; i++) {
      const cur = text.charCodeAt(idx);
      const next = text.charCodeAt(idx + 1);
      idx += cur >= 0xd800 && cur <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 2 : 1;
    }
  }
  return idx;
}

function codePointBoundsInWord(text: string, start: number, end: number): number[] {
  const bounds: number[] = [];
  let cur = stepCodePoints(text, start, 1);
  while (cur < end) {
    bounds.push(cur);
    cur = stepCodePoints(text, cur, 1);
  }
  return bounds;
}

function paragraphBoundsAt(text: string, caret: number): { start: number; end: number } {
  const safe = snapToCodePoint(text, caret);
  const start = safe === 0 ? 0 : text.lastIndexOf('\n', safe - 1) + 1;
  const nextNl = text.indexOf('\n', safe);
  const end = nextNl === -1 ? text.length : nextNl;
  return { start, end };
}

function findWordInteriorOffset(text: string, caret: number): number {
  const safe = snapToCodePoint(text, caret);
  const isWordChar = (ch: string | undefined) => ch !== undefined && !/\s/.test(ch);

  // 1. 지금 커서와 맞닿은 어절을 먼저 본다.
  let wStart = safe;
  while (wStart > 0 && isWordChar(text[wStart - 1])) wStart--;
  let wEnd = safe;
  while (wEnd < text.length && isWordChar(text[wEnd])) wEnd++;

  const directInterior = codePointBoundsInWord(text, wStart, wEnd);
  if (directInterior.length > 0) {
    // 어절 끝에서 입력 중이면 마지막 글자 바로 앞, 어절 안쪽이면 커서와 겹치지 않는 다른 글자 사이를 고른다.
    if (safe >= wEnd) return directInterior.at(-1) ?? safe;
    if (safe <= wStart) return directInterior[0] ?? safe;
    const beforeCaretInWord = [...directInterior].reverse().find(idx => idx < safe);
    const afterCaretInWord = directInterior.find(idx => idx > safe);
    return beforeCaretInWord ?? afterCaretInWord ?? snapToCodePoint(text, safe);
  }

  // 2. 커서가 공백이거나 1글자 어절이면 같은 문단에서 가장 가까운 2글자 이상 어절을 찾는다.
  const para = paragraphBoundsAt(text, safe);
  const slice = text.slice(para.start, para.end);
  let bestAt: number | null = null;
  let bestDist = Infinity;
  for (const match of slice.matchAll(/\S+/g)) {
    const absStart = para.start + (match.index ?? 0);
    const absEnd = absStart + match[0].length;
    const interior = codePointBoundsInWord(text, absStart, absEnd);
    if (interior.length === 0) continue;
    const mid = interior[Math.floor(interior.length / 2)]!;
    const dist = Math.abs(mid - safe);
    if (dist < bestDist) {
      bestDist = dist;
      bestAt = mid;
    }
  }
  return bestAt ?? safe;
}

/**
 * 시나리오 ①~⑤의 본문 변경 계획을 계산한다(순수 함수).
 */
export function planScenarioEdit(
  scenario: BotScenario,
  text: string,
  selection: StudentSelection,
  tokens: BotTokens = defaultBotTokens,
): PlannedBotEdit {
  const start = snapToCodePoint(text, Math.min(selection.start, selection.end));
  const end = snapToCodePoint(text, Math.max(selection.start, selection.end));
  const head = snapToCodePoint(text, selection.head);

  switch (scenario) {
    case 'before-caret': {
      // Yjs 상대 위치(assoc = -1)는 커서 앞 글자의 오른쪽에 붙으므로, 그 글자 왼쪽에 넣어야 학생 커서 앞에 들어간다.
      const at = start > 0 ? stepCodePoints(text, start, -1) : 0;
      return {
        deleteAt: at,
        deleteCount: 0,
        insertText: tokens.before,
        caretAt: at + tokens.before.length,
      };
    }
    case 'after-caret': {
      const at = end;
      return {
        deleteAt: at,
        deleteCount: 0,
        insertText: tokens.after,
        caretAt: at + tokens.after.length,
      };
    }
    case 'inside-word': {
      const at = findWordInteriorOffset(text, head);
      return {
        deleteAt: at,
        deleteCount: 0,
        insertText: tokens.word,
        caretAt: at + tokens.word.length,
      };
    }
    case 'same-paragraph': {
      const para = paragraphBoundsAt(text, head);
      const distFromStart = head - para.start;
      const distFromEnd = para.end - head;
      if (distFromStart >= distFromEnd && head > para.start) {
        return {
          deleteAt: para.start,
          deleteCount: 0,
          insertText: tokens.paragraphHead,
          caretAt: para.start + tokens.paragraphHead.length,
        };
      }
      return {
        deleteAt: para.end,
        deleteCount: 0,
        insertText: tokens.paragraphTail,
        caretAt: para.end + tokens.paragraphTail.length,
      };
    }
    case 'delete-across-caret': {
      if (text.length === 0) {
        return { deleteAt: 0, deleteCount: 0, insertText: '', caretAt: 0, noop: true };
      }
      const delStart = stepCodePoints(text, start, -2);
      let delEnd = stepCodePoints(text, end, 2);
      if (delEnd <= delStart) {
        delEnd = stepCodePoints(text, delStart, 1);
      }
      const deleteCount = Math.max(0, delEnd - delStart);
      if (deleteCount === 0) {
        return { deleteAt: delStart, deleteCount: 0, insertText: '', caretAt: delStart, noop: true };
      }
      return {
        deleteAt: delStart,
        deleteCount,
        insertText: '',
        caretAt: delStart,
      };
    }
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 시나리오 ⑥(1초마다 계속 고치기)의 한 번 편집을 계산한다.
 * 같은 문단에 이전 봇 표지가 있고 학생 커서와 떨어져 있으면 번호만 갱신해 글이 끝없이 불어나지 않게 한다.
 */
export function planContinuousTickEdit(
  text: string,
  selection: StudentSelection,
  seq: number,
  tokens: BotTokens = defaultBotTokens,
): PlannedBotEdit {
  const start = snapToCodePoint(text, Math.min(selection.start, selection.end));
  const end = snapToCodePoint(text, Math.max(selection.start, selection.end));
  const head = snapToCodePoint(text, selection.head);
  const badge = `${tokens.tickPrefix}${seq}${tokens.tickSuffix}`;
  const para = paragraphBoundsAt(text, head);
  const paraSlice = text.slice(para.start, para.end);

  const pattern = new RegExp(`${escapeRegExp(tokens.tickPrefix)}\\d+${escapeRegExp(tokens.tickSuffix)}`);
  const existing = pattern.exec(paraSlice);
  if (existing && existing.index !== undefined) {
    const mStart = para.start + existing.index;
    const mEnd = mStart + existing[0].length;
    const nearStudent = start <= mEnd + 1 && end >= mStart - 1;
    if (!nearStudent) {
      return {
        deleteAt: mStart,
        deleteCount: mEnd - mStart,
        insertText: badge,
        caretAt: mStart + badge.length,
      };
    }
  }

  const distFromStart = head - para.start;
  const distFromEnd = para.end - head;
  if (distFromStart >= distFromEnd && head > para.start) {
    const ins = `${badge} `;
    return {
      deleteAt: para.start,
      deleteCount: 0,
      insertText: ins,
      caretAt: para.start + badge.length,
    };
  }
  const ins = para.end > para.start ? ` ${badge}` : badge;
  return {
    deleteAt: para.end,
    deleteCount: 0,
    insertText: ins,
    caretAt: para.end + ins.length,
  };
}

export interface TeacherBotDeps {
  readonly url: string;
  readonly config: Readonly<Config>;
  readonly docId: string;
  readonly credential: () => Credential;
  /** 같은 페이지의 주 편집기 세션 awareness clientID(있으면 최우선 추적) */
  readonly getStudentClientId?: (() => number | null) | undefined;
  readonly tokens?: BotTokens | undefined;
}

export interface TeacherBot {
  readonly session: RealtimeSession;
  readonly doc: SyncedDoc;
  readonly state: Observable<ConnectionState>;
  readonly delayMs: Observable<BotDelayMs>;
  readonly continuous: Observable<boolean>;
  readonly pendingCount: Observable<number>;
  readonly lastAction: Observable<string>;
  setDelayMs(ms: BotDelayMs): void;
  trigger(scenario: BotScenario): void;
  startContinuous(): void;
  stopContinuous(): void;
  toggleContinuous(): void;
  close(): void;
}

export async function createTeacherBot(deps: TeacherBotDeps): Promise<TeacherBot> {
  const tokens = deps.tokens ?? defaultBotTokens;
  const adapter = createRealtimeAdapter({
    url: deps.url,
    config: deps.config,
    localStore: createMemoryStore(),
  });
  const session = adapter.connect(deps.credential);
  const doc = await session.openDoc(deps.docId);

  const delayMs = value<BotDelayMs>(0);
  const continuous = value(false);
  const pendingCount = value(0);
  const lastAction = value('');
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let continuousTimer: ReturnType<typeof setInterval> | null = null;
  let tickSeq = 0;
  let closed = false;

  type ParsedCursor = z.infer<typeof cursorStateSchema>;
  let lastKnownStudentCursor: ParsedCursor | null = null;
  let lastResolvedBodyCaret: number | null = null;

  const botBody = () => doc.netDoc.getText(DOC_KEYS.body);
  const awareness = doc.awareness;

  const publishBotCaret = (index: number) => {
    if (!awareness) return;
    const body = botBody();
    const clamped = snapToCodePoint(body.toString(), index);
    const rel = Y.createRelativePositionFromTypeIndex(body, clamped, -1);
    const json = Y.relativePositionToJSON(rel);
    awareness.setLocalStateField('cursor', { anchor: json, head: json });
  };

  const readLiveStudentCursor = (): ParsedCursor | null => {
    if (!awareness) return null;
    const states = awareness.getStates();
    const preferredId = deps.getStudentClientId?.() ?? null;

    const extractFrom = (rawState: Record<string, unknown> | undefined): ParsedCursor | null => {
      if (!rawState || typeof rawState !== 'object') return null;
      const parsed = cursorStateSchema.safeParse(rawState['cursor']);
      return parsed.success ? parsed.data : null;
    };

    if (preferredId !== null && preferredId !== awareness.clientID) {
      const fromPreferred = extractFrom(states.get(preferredId));
      if (fromPreferred) return fromPreferred;
    }

    for (const [clientId, state] of states) {
      if (clientId === awareness.clientID) continue;
      const user = state?.['user'];
      const isStudent =
        typeof user === 'object' && user !== null && (user as Record<string, unknown>)['role'] === 'student';
      if (!isStudent) continue;
      const found = extractFrom(state);
      if (found) return found;
    }

    for (const [clientId, state] of states) {
      if (clientId === awareness.clientID) continue;
      const found = extractFrom(state);
      if (found) return found;
    }

    return null;
  };

  const onAwarenessChange = () => {
    const live = readLiveStudentCursor();
    if (live) lastKnownStudentCursor = live;
  };

  awareness?.setLocalStateField('user', { role: 'teacher' });
  awareness?.on('change', onAwarenessChange);
  onAwarenessChange();
  publishBotCaret(0);

  const resolveStudentSelection = (): StudentSelection => {
    const body = botBody();
    const textLen = body.length;
    const cursorJson = readLiveStudentCursor() ?? lastKnownStudentCursor;

    if (cursorJson) {
      try {
        const anchorRel = Y.createRelativePositionFromJSON(cursorJson.anchor);
        const headRel = Y.createRelativePositionFromJSON(cursorJson.head);
        const anchorAbs = Y.createAbsolutePositionFromRelativePosition(anchorRel, doc.netDoc);
        const headAbs = Y.createAbsolutePositionFromRelativePosition(headRel, doc.netDoc);
        if (anchorAbs && headAbs && anchorAbs.type === body && headAbs.type === body) {
          const start = Math.min(anchorAbs.index, headAbs.index);
          const end = Math.max(anchorAbs.index, headAbs.index);
          lastResolvedBodyCaret = headAbs.index;
          return { start, end, head: headAbs.index };
        }
      } catch {
        // 아직 도착하지 않은 블록을 가리키면 아래 폴백을 쓴다.
      }
    }

    const fallback =
      lastResolvedBodyCaret !== null ? Math.max(0, Math.min(textLen, lastResolvedBodyCaret)) : textLen;
    return { start: fallback, end: fallback, head: fallback };
  };

  const applyPlannedEdit = (plan: PlannedBotEdit): boolean => {
    if (closed) return false;
    if (plan.noop) {
      publishBotCaret(plan.caretAt);
      return false;
    }
    const body = botBody();
    doc.netDoc.transact(() => {
      if (plan.deleteCount > 0) body.delete(plan.deleteAt, plan.deleteCount);
      if (plan.insertText.length > 0) body.insert(plan.deleteAt, plan.insertText);
    }, 'teacher-bot');
    publishBotCaret(plan.caretAt);
    return true;
  };

  const scheduleRun = (work: () => void) => {
    if (closed) return;
    const wait = delayMs.get();
    if (wait <= 0) {
      work();
      return;
    }
    pendingCount.set(pendingCount.get() + 1);
    const timer = setTimeout(() => {
      timers.delete(timer);
      pendingCount.set(Math.max(0, pendingCount.get() - 1));
      if (!closed) work();
    }, wait);
    timers.add(timer);
  };

  const actionMessageFor = (scenario: BotScenario, changed: boolean): string => {
    switch (scenario) {
      case 'before-caret':
        return koDev.botActionDoneBefore;
      case 'after-caret':
        return koDev.botActionDoneAfter;
      case 'inside-word':
        return koDev.botActionDoneWord;
      case 'same-paragraph':
        return koDev.botActionDoneParagraph;
      case 'delete-across-caret':
        return changed ? koDev.botActionDoneDelete : koDev.botActionDoneDeleteEmpty;
    }
  };

  const runTick = () => {
    scheduleRun(() => {
      const text = botBody().toString();
      const selection = resolveStudentSelection();
      const plan = planContinuousTickEdit(text, selection, ++tickSeq, tokens);
      applyPlannedEdit(plan);
      lastAction.set(`${koDev.botActionDoneTick} (#${tickSeq})`);
    });
  };

  const stopContinuous = () => {
    if (continuousTimer !== null) {
      clearInterval(continuousTimer);
      continuousTimer = null;
    }
    continuous.set(false);
  };

  const startContinuous = () => {
    if (closed || continuousTimer !== null) return;
    continuous.set(true);
    runTick();
    continuousTimer = setInterval(runTick, CONTINUOUS_INTERVAL_MS);
  };

  return {
    session,
    doc,
    state: session.state,
    delayMs,
    continuous,
    pendingCount,
    lastAction,
    setDelayMs(ms) {
      delayMs.set(ms);
    },
    trigger(scenario) {
      scheduleRun(() => {
        const text = botBody().toString();
        const selection = resolveStudentSelection();
        const plan = planScenarioEdit(scenario, text, selection, tokens);
        const changed = applyPlannedEdit(plan);
        lastAction.set(actionMessageFor(scenario, changed));
      });
    },
    startContinuous,
    stopContinuous,
    toggleContinuous() {
      if (continuous.get()) stopContinuous();
      else startContinuous();
    },
    close() {
      if (closed) return;
      closed = true;
      stopContinuous();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      pendingCount.set(0);
      awareness?.off('change', onAwarenessChange);
      awareness?.setLocalStateField('cursor', null);
      doc.close();
      session.close();
    },
  };
}
