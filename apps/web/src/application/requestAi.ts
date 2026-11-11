import {
  countChars,
  resolveGenreVariant,
  type AiButton,
  type GenreSelection,
  type StudentCopyKey,
} from '@geulbang/core';
import type { Config } from '@geulbang/core/config';
import { ko } from '@geulbang/core/copy';
import { errorCatalog, isErrorCode, type ErrorCode } from '@geulbang/core/errors';
import { locateAll, type Located } from '@geulbang/core/text';
import {
  aiResultSchemas,
  isApiError,
  type AiRequestInput,
  type ApiError,
  type ApiPort,
  type SpellItem,
  type SpellKind,
  type StructuredAiButton,
} from '../ports/api.ts';
import type { DeviceMemory } from '../ports/deviceMemory.ts';
import type { AiResultRecord, AiResultRecordOf, LocalStorePort } from '../ports/localStore.ts';
import { value, type Observable } from '../ports/observable.ts';
import type { AiChipInput } from './aiChip.ts';
import type { AppDeps } from './deps.ts';

/**
 * 학생: 글벗 버튼 요청(PLAN §8.6, PRD F-08·F-26·6.1·6.3·6.5).
 * - 맞춤법·한마디·방향: `api.aiStructured` → 모양 확인 → 기기에 저장(`ai_results`) → 맞춤법이면 지금 글에서 자리 찾기.
 * - 다듬은 글: `api.aiPolish` 스트림을 조각마다 화면에 넘기고, 패널을 닫으면 `abort()`로 끊는다. 다 받은 뒤에만 저장한다.
 * 보내는 것은 본문·도움 질문 메모·(노래 가사) 분위기와 빠르기뿐이다. 제목·별명·학교·학급은 보내지 않는다(PRD 6.1 `[고정]`).
 * 쓰던 글에는 어떤 경우에도 손대지 않는다(PRD 6.5).
 */
export type AiDeps = Pick<AppDeps, 'config' | 'now' | 'newId' | 'sha256Hex'> & {
  readonly api: Pick<ApiPort, 'aiStructured' | 'aiPolish'>;
  readonly localStore: Pick<LocalStorePort, 'aiResults'>;
  readonly memory: Pick<DeviceMemory, 'student'>;
};

export interface AiDocInput {
  readonly roomId: string;
  readonly docId: string;
  /** 최소 글자·도움 질문·노래 칩 판단(서버도 같은 카탈로그로 다시 본다) */
  readonly genre: GenreSelection;
  /** 지금 본문 전체 */
  readonly body: string;
  /** 도움 질문 메모. 지금 글 종류의 질문만, 빈 메모는 빼고 보낸다. */
  readonly helpNotes: readonly { readonly questionId: string; readonly note: string }[];
  /** 노래 가사의 분위기·빠르기(화면이 고른 칩이나 직접 쓴 말로 풀어서). 둘 다 있을 때만 보낸다. */
  readonly song?: { readonly mood: string; readonly tempo: string } | undefined;
  /** 응답이 왔을 때의 본문(맞춤법 자리 찾기용). 없으면 `body` */
  readonly currentBody?: (() => string) | undefined;
}

// ── 보낼 글 ──────────────────────────────────────────────────────

export interface PreparedText {
  readonly text: string;
  /** 서버에 알리는 범위. 맞춤법은 늘 `ALL`(서버가 문단 조각으로 나눠 본다, PLAN §8.2) */
  readonly range: 'ALL' | 'TAIL';
  /** 길어서 뒷부분만 보냄 */
  readonly truncated: boolean;
}

/** 서로게이트 쌍 가운데를 가르지 않는 뒷부분(UTF-16 길이 ≤ n이면 서버의 글자(코드 포인트) 상한도 지킨다) */
function tailUnits(text: string, n: number): string {
  let start = text.length - n;
  const c = text.charCodeAt(start);
  if (c >= 0xdc00 && c <= 0xdfff) start++;
  return text.slice(start);
}

function headUnits(text: string, n: number): string {
  if (text.length <= n) return text;
  const c = text.charCodeAt(n - 1);
  return text.slice(0, c >= 0xd800 && c <= 0xdbff ? n - 1 : n);
}

/** PRD F-26: 맞춤법은 `AI_SPELL_MAX_CHARS`까지 전체(넘으면 뒤쪽), 나머지는 `AI_MAX_INPUT_CHARS`를 넘으면 뒷부분만 `TAIL`로. */
export function prepareAiText(
  config: Pick<Config, 'AI_MAX_INPUT_CHARS' | 'AI_SPELL_MAX_CHARS'>,
  button: AiButton,
  body: string,
): PreparedText {
  const limit = button === 'SPELL' ? config.AI_SPELL_MAX_CHARS : config.AI_MAX_INPUT_CHARS;
  if (body.length <= limit) return { text: body, range: 'ALL', truncated: false };
  return { text: tailUnits(body, limit), range: button === 'SPELL' ? 'ALL' : 'TAIL', truncated: true };
}

export function buildAiRequest(
  config: Readonly<Config>,
  input: Pick<AiDocInput, 'docId' | 'genre' | 'helpNotes' | 'song'>,
  button: AiButton,
  prepared: PreparedText,
  commandId: string,
): AiRequestInput {
  const variant = resolveGenreVariant(input.genre, config);
  const asked = new Set<string>(variant.questions.map(q => q.id));
  const helpNotes = input.helpNotes
    .filter(n => asked.has(n.questionId) && n.note.trim().length > 0)
    .map(n => ({ questionId: n.questionId, note: headUnits(n.note, config.MEMO_MAX_CHARS) }));
  const song =
    variant.hasSongChips && input.song && input.song.mood.trim() && input.song.tempo.trim()
      ? { mood: input.song.mood, tempo: input.song.tempo }
      : null;
  return {
    docId: input.docId,
    button,
    text: prepared.text,
    range: prepared.range,
    meta: { helpNotes, ...(song ? { mood: song.mood, tempo: song.tempo } : {}) },
    commandId,
  };
}

/** 칩의 "글이 바뀌었어요" 비교용 해시: 본문 전체(네 버튼이 같은 값을 쓴다). */
export function aiTextHash(deps: Pick<AppDeps, 'sha256Hex'>, body: string): Promise<string> {
  return deps.sha256Hex(body);
}

// ── 결과 풀이 ────────────────────────────────────────────────────

export interface LocatedSpellItem extends SpellItem {
  /** 지금 글에서의 자리(UTF-16). 못 찾으면 null: 목록에는 보이되 누를 수 없다(PRD 6.3) */
  readonly range: Located | null;
}

/**
 * 요청할 때의 글과 지금 글의 차이로 자리를 옮겨 찾는다(`core/text/locate.ts`). 글이 바뀔 때마다 다시 부른다.
 * 앞뒤 글자까지 맞는 항목이 먼저 자리를 고른다: `locateAll`은 앞 항목이 먼저 고르므로, 학생이 앞의 같은 실수를
 * 고친 뒤에 그 항목이 뒤 항목의 자리를 가져가 뒤 항목이 눌리지 않게 되는 일을 막는다.
 */
export function locateSpellItems(
  record: Pick<AiResultRecordOf<'SPELL'>, 'requestText' | 'result'>,
  currentBody: string,
): LocatedSpellItem[] {
  const tagged = record.result.items.map((item, index) => ({
    item,
    index,
    exact: currentBody.includes(item.context.before + item.original + item.context.after),
  }));
  // 정렬은 안정적이라 같은 무리 안에서는 원래 순서(같은 실수가 여러 번이면 앞에서부터)를 지킨다.
  const order = [...tagged].sort((a, b) => Number(b.exact) - Number(a.exact));
  const ranges = locateAll(
    record.requestText,
    currentBody,
    order.map(t => t.item),
  );
  const byIndex = new Map(order.map((t, k) => [t.index, ranges[k] ?? null]));
  return tagged.map(t => ({ ...t.item, range: byIndex.get(t.index) ?? null }));
}

export const SPELL_KIND_COPY_KEYS: Readonly<Record<SpellKind, StudentCopyKey>> = {
  맞춤법: 'aiSpellKindSpelling',
  띄어쓰기: 'aiSpellKindSpacing',
  문장부호: 'aiSpellKindPunctuation',
};

/** 결과 패널에 붙일 안내 줄(PRD F-26·6.3·PLAN §8.6). 저장된 결과를 다시 열 때도 같은 것을 보인다. */
export function aiResultNotices(record: AiResultRecord): StudentCopyKey[] {
  const out: StudentCopyKey[] = [];
  if (record.truncated && record.button !== 'SPELL') out.push('aiLongInputTailNotice');
  if (record.button === 'POLISH') {
    if (record.result.stop === 'limit') out.push('aiPolishTruncatedNotice');
    if (record.result.lengthWarning) out.push('aiPolishDiffWarning');
  }
  return out;
}

/** PRD 6.3 `[고정 문장]`의 길이 비율 경계: 끝난 뒤 0.5 미만이거나 1.6 초과면 "많이 달라졌어요". */
export const POLISH_LENGTH_RATIO = { min: 0.5, max: 1.6 } as const;

/**
 * 다듬은 글이 보낸 글보다 너무 짧거나 길다. 출력 한도로 잘린 글(`limit`)은 짧은 것이 당연해서
 * "일부만 다듬었어요"만 보이고 짧다는 안내는 붙이지 않는다.
 */
export function polishLengthWarning(requestText: string, polished: string, stop: 'end' | 'limit'): boolean {
  const base = countChars(requestText);
  if (base === 0) return false;
  const ratio = countChars(polished) / base;
  return ratio > POLISH_LENGTH_RATIO.max || (stop === 'end' && ratio < POLISH_LENGTH_RATIO.min);
}

/**
 * 첫 줄이 "다듬은 글:" 같은 머리말이면 떼어 낸다(PLAN §8.5). 스트림 중에도 받은 글 전체에 매번 적용한다.
 * 머리말은 버튼 이름 + (쌍점 또는 줄 끝)일 때만이다. "다듬은 글씨가…"처럼 글의 첫 문장은 건드리지 않는다.
 */
export function stripPolishHeader(text: string): string {
  const label = ko.student.aiPolishLabel;
  const nl = text.indexOf('\n');
  const first = nl < 0 ? text : text.slice(0, nl);
  const bare = first.replace(/[#*[\]()<>「」『』"'`]/g, '').trim();
  if (!bare.startsWith(label)) return text;
  const rest = bare.slice(label.length).trim();
  if (rest === '' || rest === ':' || rest === '：') {
    return nl < 0 ? '' : text.slice(nl + 1).replace(/^(?:[ \t]*\n)+/, '');
  }
  if (rest.startsWith(':') || rest.startsWith('：')) {
    const colon = first.search(/[:：]/);
    return first.slice(colon + 1).trimStart() + (nl < 0 ? '' : text.slice(nl));
  }
  return text;
}

// ── 오류 ─────────────────────────────────────────────────────────

const apiErrorOf = (code: ErrorCode): ApiError => ({
  code,
  message: '',
  retryable: errorCatalog[code].retryable,
});

/** 어댑터가 던진 `ApiError`는 그대로, 그 밖(스트림이 끊김 등)은 "잠깐 뒤에 다시 눌러 주세요". */
function toApiError(error: unknown): ApiError {
  return isApiError(error) ? error : apiErrorOf('E_AI_PROVIDER');
}

/** 서버가 예약까지 한 요청(PLAN §8.2 ②)이라 쿨다운이 걸린 실패. 그 밖은 서버에 기록이 없어 바로 다시 누를 수 있다. */
const RESERVED_FAILURES: ReadonlySet<ErrorCode> = new Set([
  'E_AI_TIMEOUT',
  'E_AI_FORMAT',
  'E_AI_PROVIDER',
  'E_AI_REFUSED',
  'E_AI_COOLDOWN',
]);

// ── 요청 묶음 ────────────────────────────────────────────────────

/** 칩 상태 기계의 입력이 되는 기기 쪽 기록(새로고침하면 비고, 서버가 다시 알려 준다). */
export interface AiActivity {
  /** `${roomId}:${button}` → 마지막으로 보낸 시각(서버 쿨다운은 참가자·버튼마다) */
  readonly lastRequestAt: ReadonlyMap<string, number>;
  /** roomId → 하루 한도(`E_AI_LIMIT`)를 받은 시각 */
  readonly limitHitAt: ReadonlyMap<string, number>;
  /** `${docId}:${button}` 요청 중 */
  readonly pending: ReadonlySet<string>;
}

export function activityFor(
  activity: AiActivity,
  ids: { readonly roomId: string; readonly docId: string },
  button: AiButton,
): Pick<AiChipInput, 'lastRequestAt' | 'limitHitAt' | 'pending'> {
  return {
    lastRequestAt: activity.lastRequestAt.get(`${ids.roomId}:${button}`) ?? null,
    limitHitAt: activity.limitHitAt.get(ids.roomId) ?? null,
    pending: activity.pending.has(`${ids.docId}:${button}`),
  };
}

export interface StructuredOutcome<B extends StructuredAiButton> {
  readonly record: AiResultRecordOf<B>;
  /** 맞춤법이면 응답이 왔을 때의 본문에서 찾은 자리. 다른 버튼은 빈 목록 */
  readonly spellItems: readonly LocatedSpellItem[];
}

export interface PolishHandlers {
  /** 지금까지 받은 다듬은 글 전체(머리말을 뗀 것) */
  onText(text: string): void;
  /** 대체 모델로 처음부터 다시 쓴다: 받은 글을 지운다 */
  onReset(): void;
  onDone(record: AiResultRecordOf<'POLISH'>): void;
  /** 받은 데까지(`partial`)는 보이고 `다시 받기`(PLAN §8.6) */
  onError(error: ApiError, partial: string): void;
}

export interface PolishHandle {
  /** 패널을 닫으면 부른다. 그 뒤로는 어떤 콜백도 부르지 않는다. */
  abort(): void;
  /** 끝나거나 끊기면 풀린다(거부되지 않음) */
  readonly finished: Promise<void>;
}

export interface AiRequester {
  readonly activity: Observable<AiActivity>;
  structured<B extends StructuredAiButton>(input: AiDocInput, button: B): Promise<StructuredOutcome<B>>;
  polish(input: AiDocInput, handlers: PolishHandlers): PolishHandle;
  /** 패널을 다시 열 때(PRD F-08 "버튼별 마지막 결과는 기기에 남아"). 저장소를 못 읽으면 null */
  lastResult<B extends AiButton>(docId: string, button: B): Promise<AiResultRecordOf<B> | null>;
  results(docId: string): Promise<AiResultRecord[]>;
}

const EMPTY_ACTIVITY: AiActivity = { lastRequestAt: new Map(), limitHitAt: new Map(), pending: new Set() };

/** 학생 한 사람의 쓰기 화면마다 하나 만든다. */
export function createAiRequester(deps: AiDeps): AiRequester {
  const activity = value<AiActivity>(EMPTY_ACTIVITY);
  const inflight = new Map<string, Promise<StructuredOutcome<StructuredAiButton>>>();
  const polishing = new Map<string, AbortController>();

  const change = (
    fn: (draft: {
      lastRequestAt: Map<string, number>;
      limitHitAt: Map<string, number>;
      pending: Set<string>;
    }) => void,
  ) => {
    const now = activity.get();
    const draft = {
      lastRequestAt: new Map(now.lastRequestAt),
      limitHitAt: new Map(now.limitHitAt),
      pending: new Set(now.pending),
    };
    fn(draft);
    activity.set(draft);
  };
  const setPending = (key: string, on: boolean) =>
    change(d => {
      if (on) d.pending.add(key);
      else d.pending.delete(key);
    });

  const tokenFor = async (roomId: string): Promise<string> => {
    const entry = await deps.memory.student(roomId, deps.now());
    if (!entry) throw apiErrorOf('E_AUTH');
    return entry.deviceToken;
  };

  /** 보내기 직전에 쿨다운 시작. 실패하면 서버에 기록이 남았는지에 따라 되돌린다. */
  const noteSent = (roomId: string, button: AiButton): (() => void) => {
    const key = `${roomId}:${button}`;
    const previous = activity.get().lastRequestAt.get(key);
    change(d => void d.lastRequestAt.set(key, deps.now()));
    return () =>
      change(d => {
        if (previous === undefined) d.lastRequestAt.delete(key);
        else d.lastRequestAt.set(key, previous);
      });
  };

  const settleFailure = (roomId: string, code: ErrorCode, reached: boolean, revert: () => void) => {
    if (code === 'E_AI_LIMIT') change(d => void d.limitHitAt.set(roomId, deps.now()));
    if (!reached && !RESERVED_FAILURES.has(code)) revert();
  };

  const save = async (record: AiResultRecord) => {
    try {
      await deps.localStore.aiResults.put(record);
    } catch {
      // 기기 저장이 막혀도(사파리 개인 정보 보호 등) 받은 결과는 화면에 보인다. 다시 열 때만 없다.
    }
  };

  async function runStructured<B extends StructuredAiButton>(
    input: AiDocInput,
    button: B,
  ): Promise<StructuredOutcome<B>> {
    let revert: (() => void) | null = null;
    let reached = false;
    try {
      const token = await tokenFor(input.roomId);
      const prepared = prepareAiText(deps.config, button, input.body);
      const request = buildAiRequest(deps.config, input, button, prepared, deps.newId());
      const textHash = await aiTextHash(deps, input.body);
      revert = noteSent(input.roomId, button);
      const res = await deps.api.aiStructured(input.roomId, token, request);
      reached = true;
      const parsed = aiResultSchemas[button].safeParse(res.result);
      // 서버가 검증해 보낸 모양과 다르면 판이 어긋난 것이다("새로워졌어요. 다시 열어 주세요.").
      if (res.button !== button || !parsed.success) throw apiErrorOf('E_VERSION');
      // 버튼과 결과 모양을 위에서 함께 확인했다(유니온을 제네릭으로 좁히는 곳은 여기 한 곳).
      const record = {
        docId: input.docId,
        button,
        result: parsed.data,
        textHash,
        receivedAt: deps.now(),
        requestText: prepared.text,
        truncated: prepared.truncated,
      } as AiResultRecord;
      await save(record);
      const spellItems =
        record.button === 'SPELL' ? locateSpellItems(record, input.currentBody?.() ?? input.body) : [];
      return { record: record as AiResultRecordOf<B>, spellItems };
    } catch (error) {
      const e = toApiError(error);
      if (revert) settleFailure(input.roomId, e.code, reached, revert);
      throw e;
    }
  }

  return {
    activity,

    structured<B extends StructuredAiButton>(input: AiDocInput, button: B) {
      const key = `${input.docId}:${button}`;
      // 같은 글·버튼을 두 번 눌러도 요청은 하나(쿨다운·한도를 두 번 쓰지 않게).
      const running = inflight.get(key) as Promise<StructuredOutcome<B>> | undefined;
      if (running) return running;
      setPending(key, true);
      const promise = runStructured(input, button).finally(() => {
        inflight.delete(key);
        setPending(key, false);
      });
      inflight.set(key, promise);
      return promise;
    },

    polish(input, handlers) {
      const key = `${input.docId}:POLISH`;
      polishing.get(key)?.abort();
      const controller = new AbortController();
      polishing.set(key, controller);
      setPending(key, true);
      const { signal } = controller;
      // 끊으면 스트림이 실제로 닫히기를 기다리지 않고 바로 "요청 중"을 푼다.
      const release = () => {
        if (polishing.get(key) !== controller) return;
        polishing.delete(key);
        setPending(key, false);
      };

      const finished = (async () => {
        let raw = '';
        let revert: (() => void) | null = null;
        let reached = false;
        try {
          const token = await tokenFor(input.roomId);
          const prepared = prepareAiText(deps.config, 'POLISH', input.body);
          const request = buildAiRequest(deps.config, input, 'POLISH', prepared, deps.newId());
          const textHash = await aiTextHash(deps, input.body);
          if (signal.aborted) return;
          revert = noteSent(input.roomId, 'POLISH');
          let stop: 'end' | 'limit' | null = null;
          for await (const line of deps.api.aiPolish(input.roomId, token, request, signal)) {
            if (signal.aborted) return;
            reached = true;
            if (line.t === 'text') {
              raw += line.d;
              handlers.onText(stripPolishHeader(raw));
            } else if (line.t === 'reset') {
              raw = '';
              handlers.onReset();
            } else if (line.t === 'done') {
              stop = line.stop;
              break;
            } else {
              throw apiErrorOf(isErrorCode(line.code) ? line.code : 'E_AI_PROVIDER');
            }
          }
          if (signal.aborted) return;
          // `done` 없이 끝남 = 중간에 끊김. 받은 데까지는 그대로 보인다.
          if (stop === null) throw apiErrorOf('E_AI_PROVIDER');
          const text = stripPolishHeader(raw);
          const record: AiResultRecordOf<'POLISH'> = {
            docId: input.docId,
            button: 'POLISH',
            result: { text, stop, lengthWarning: polishLengthWarning(prepared.text, text, stop) },
            textHash,
            receivedAt: deps.now(),
            requestText: prepared.text,
            truncated: prepared.truncated,
          };
          await save(record);
          if (signal.aborted) return;
          handlers.onDone(record);
        } catch (error) {
          if (signal.aborted) return;
          const e = toApiError(error);
          if (revert) settleFailure(input.roomId, e.code, reached, revert);
          handlers.onError(e, stripPolishHeader(raw));
        } finally {
          release();
        }
      })();

      return {
        abort() {
          controller.abort();
          release();
        },
        finished,
      };
    },

    async lastResult(docId, button) {
      try {
        return await deps.localStore.aiResults.get(docId, button);
      } catch {
        return null;
      }
    },

    async results(docId) {
      try {
        return await deps.localStore.aiResults.list(docId);
      } catch {
        return [];
      }
    },
  };
}
