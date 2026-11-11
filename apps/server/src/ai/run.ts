import type { AiButton } from '@geulbang/core';
import type { Config } from '@geulbang/core/config';
import { AppError, type ErrorCode } from '@geulbang/core/errors';
import {
  AiCallError,
  type AiFailureKind,
  type AiInput,
  type AiPort,
  type AiStructured,
  type CallOptions,
  type Usage,
} from './port.ts';
import { cleanDirection, cleanFeedback, cleanSpell, stripPolishPreamble } from './validate.ts';

/**
 * AI 호출 한 번(버튼 한 번)의 재시도·대체·시간 예산(PLAN §8.2 표, PRD 6.5 `[고정: 오류가 나면 안 된다]`).
 * - 시간 초과: 1번 재시도. 다듬은 글은 아직 글자를 보내기 전일 때만.
 * - 형식 깨짐: "형식을 고쳐 줘"와 함께 1번. 출력 한도(`max_tokens`)면 최대 출력을 1.5배로 올려 1번.
 * - 제공사 오류·과부하: 대체 모델로 1번. 거절: 대체 모델(서버 측 대체 켬)로 1번, 그래도 거절이면 끝.
 * - 요청 전체 시간 예산: 구조화 = `AI_TIMEOUT_SEC` × 2, 다듬은 글 = 첫 글자 + 전체 시간.
 * 쓰는 글에는 어떤 경우에도 영향이 없다(이 함수는 결과만 돌려준다).
 */
type Structured = Exclude<AiButton, 'POLISH'>;
type Effort = CallOptions['effort'];

/** 다듬은 글 최대 출력 = 원문 토큰 × 1.6(PLAN §8.3), 상한은 설정 `AI_MAX_OUTPUT_TOKENS.polishMax`. */
const POLISH_FACTOR = 1.6;
const POLISH_MIN_OUTPUT = 256;

export function maxOutputFor(config: Readonly<Config>, button: Structured): number {
  const m = config.AI_MAX_OUTPUT_TOKENS;
  return button === 'SPELL' ? m.spell : button === 'FEEDBACK' ? m.feedback : m.direction;
}

export interface Attempt {
  readonly model: string;
  readonly effort: Effort;
  readonly maxTokens: number;
  readonly serverFallback?: boolean;
  readonly formatRetry?: boolean;
}

export interface RunLog {
  attempt(a: Attempt, outcome: 'ok' | AiFailureKind, ms: number): void;
}

const MODEL_KEY = {
  SPELL: 'MODEL_SPELL',
  FEEDBACK: 'MODEL_FEEDBACK',
  DIRECTION: 'MODEL_DIRECTION',
  POLISH: 'MODEL_POLISH',
} as const;
const EFFORT_KEY = {
  SPELL: 'AI_EFFORT_SPELL',
  FEEDBACK: 'AI_EFFORT_FEEDBACK',
  DIRECTION: 'AI_EFFORT_DIRECTION',
  POLISH: 'AI_EFFORT_POLISH',
} as const;

export function firstAttempt(config: Readonly<Config>, button: AiButton, maxTokens: number): Attempt {
  return { model: config[MODEL_KEY[button]], effort: config[EFFORT_KEY[button]] as Effort, maxTokens };
}

export function fallbackAttempt(config: Readonly<Config>, prev: Attempt, serverFallback: boolean): Attempt {
  return {
    model: config.MODEL_FALLBACK,
    effort: config.AI_EFFORT_FALLBACK as Effort,
    maxTokens: prev.maxTokens,
    ...(serverFallback ? { serverFallback: true } : {}),
  };
}

/** 실패 종류 → 다음 시도(없으면 null = 끝). `tried`는 이미 쓴 재시도 종류. */
export function nextAttempt(
  config: Readonly<Config>,
  prev: Attempt,
  kind: AiFailureKind,
  tried: Set<string>,
): Attempt | null {
  const onFallback = prev.model === config.MODEL_FALLBACK && prev.model !== config.MODEL_SPELL;
  const once = (key: string, a: Attempt): Attempt | null => {
    if (tried.has(key)) return null;
    tried.add(key);
    return a;
  };
  switch (kind) {
    case 'timeout':
      return once('timeout', prev);
    case 'format':
      return once('format', { ...prev, formatRetry: true });
    case 'limit':
      return once('limit', { ...prev, maxTokens: Math.ceil(prev.maxTokens * 1.5) });
    case 'transient':
      return onFallback ? null : once('fallback', fallbackAttempt(config, prev, false));
    case 'refusal':
      return onFallback ? null : once('fallback', fallbackAttempt(config, prev, true));
    default:
      return null;
  }
}

export function errorCodeFor(kind: AiFailureKind): ErrorCode {
  switch (kind) {
    case 'timeout':
    case 'aborted':
      return 'E_AI_TIMEOUT';
    case 'format':
    case 'limit':
      return 'E_AI_FORMAT';
    case 'refusal':
      return 'E_AI_REFUSED';
    default:
      return 'E_AI_PROVIDER';
  }
}

export interface RunDeps {
  readonly ai: AiPort;
  readonly config: Readonly<Config>;
  readonly signal: AbortSignal;
  readonly log?: RunLog;
  readonly now?: () => number;
  /**
   * 요청 전체의 절대 마감 시각(ms). 맞춤법 조각처럼 버튼 한 번이 여러 호출로 나뉘면 부르는 쪽이 한 번 정해 모두에 넘긴다
   * (P5-5b 검토 B09). 없으면 이 호출이 시작할 때 `structuredBudgetMs`로 정한다.
   */
  readonly deadline?: number;
}

/** 구조화 버튼(맞춤법·한마디·방향) 요청 전체 시간 예산(PLAN §8.2 표: `AI_TIMEOUT_SEC` × 2) */
export function structuredBudgetMs(config: Readonly<Config>): number {
  return config.AI_TIMEOUT_SEC * 1000 * 2;
}

/** 시도 하나의 신호: 요청 전체 취소 + 시도 시간 + 남은 예산 중 먼저 오는 것. 밖에서 취소했는지 구분한다. */
function attemptSignal(outer: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([outer, AbortSignal.timeout(Math.max(1, ms))]);
}

export async function runStructured<B extends Structured>(
  deps: RunDeps,
  input: AiInput & { readonly button: B },
): Promise<{ value: AiStructured<B>; usage: Usage[] }> {
  const now = deps.now ?? Date.now;
  const perAttemptMs = deps.config.AI_TIMEOUT_SEC * 1000;
  const deadline = deps.deadline ?? now() + structuredBudgetMs(deps.config);
  const tried = new Set<string>();
  const usage: Usage[] = [];
  let attempt: Attempt | null = firstAttempt(
    deps.config,
    input.button,
    maxOutputFor(deps.config, input.button),
  );
  let lastKind: AiFailureKind = 'fatal';

  while (attempt) {
    // 이미 중단됐으면(기기가 끊음·방 지우기·함께 보낸 조각 실패·전체 예산 끝) 새 호출을 시작하지 않는다.
    if (deps.signal.aborted) throw new AppError('E_AI_TIMEOUT');
    const left = deadline - now();
    if (left <= 0) {
      lastKind = 'timeout';
      break;
    }
    const started = now();
    const signal = attemptSignal(deps.signal, Math.min(perAttemptMs, left));
    try {
      const reply = await deps.ai.structured(input, { ...attempt, signal });
      usage.push(reply.usage);
      const value = clean(input, reply.value as AiStructured<B>);
      deps.log?.attempt(attempt, 'ok', now() - started);
      return { value, usage };
    } catch (error) {
      let kind = error instanceof AiCallError ? error.kind : 'fatal';
      if (kind === 'aborted' && !deps.signal.aborted) kind = 'timeout';
      deps.log?.attempt(attempt, kind, now() - started);
      if (deps.signal.aborted) throw new AppError('E_AI_TIMEOUT');
      lastKind = kind;
      attempt = nextAttempt(deps.config, attempt, kind, tried);
    }
  }
  throw new AppError(errorCodeFor(lastKind));
}

function clean<B extends Structured>(
  input: AiInput & { readonly button: B },
  value: AiStructured<B>,
): AiStructured<B> {
  switch (input.button) {
    case 'SPELL':
      return cleanSpell(value as AiStructured<'SPELL'>, input.text) as AiStructured<B>;
    case 'FEEDBACK':
      return cleanFeedback(value as AiStructured<'FEEDBACK'>) as AiStructured<B>;
    default:
      return cleanDirection(value as AiStructured<'DIRECTION'>) as AiStructured<B>;
  }
}

/** 다듬은 글 스트림 한 줄(PLAN §8.3 계약). 서버가 NDJSON으로 한 줄씩 보낸다. */
export type PolishLine =
  | { readonly t: 'text'; readonly d: string }
  | { readonly t: 'reset' }
  | { readonly t: 'done'; readonly stop: 'end' | 'limit' }
  | { readonly t: 'error'; readonly code: ErrorCode };

/** 원문 토큰 수를 모를 때의 어림: 한글 한 글자 ≈ 1토큰보다 조금 많다(새 토크나이저 약 30%↑). */
export function polishMaxTokens(config: Readonly<Config>, text: string): number {
  const approxTokens = Math.ceil([...text].length * 1.3);
  return Math.min(
    config.AI_MAX_OUTPUT_TOKENS.polishMax,
    Math.max(POLISH_MIN_OUTPUT, Math.ceil(approxTokens * POLISH_FACTOR)),
  );
}

/**
 * 다듬은 글: 글자 조각을 NDJSON 줄로 내보낸다. 첫 글자 전 실패는 재시도·대체, 글자를 보낸 뒤 실패는
 * 대체 모델이 처음부터 다시 쓰므로 `reset`을 먼저 보낸다(거절·제공사 오류일 때만). 시간 초과는 글자를 보낸 뒤면 끝.
 */
export async function* runPolish(
  deps: RunDeps,
  input: AiInput & { readonly button: 'POLISH' },
  onUsage: (u: Usage) => void,
): AsyncGenerator<PolishLine> {
  const now = deps.now ?? Date.now;
  const firstByteMs = deps.config.AI_POLISH_FIRST_BYTE_SEC * 1000;
  const totalMs = deps.config.AI_POLISH_TIMEOUT_SEC * 1000;
  const deadline = now() + firstByteMs + totalMs;
  const tried = new Set<string>();
  let attempt: Attempt | null = firstAttempt(deps.config, 'POLISH', polishMaxTokens(deps.config, input.text));
  let lastKind: AiFailureKind = 'fatal';
  let sentAny = false;

  while (attempt) {
    const left = deadline - now();
    if (left <= 0) break;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      deps.signal,
      controller.signal,
      AbortSignal.timeout(Math.min(totalMs, left)),
    ]);
    const firstByteTimer = setTimeout(() => controller.abort(), Math.min(firstByteMs, left));
    const started = now();
    let gotByte = false;
    let leading = true;
    try {
      const stream = deps.ai.polish(input, { ...attempt, signal });
      for await (const piece of stream) {
        if (!gotByte) {
          gotByte = true;
          clearTimeout(firstByteTimer);
        }
        // 첫 줄 머리말("다듬은 글:")은 떼어 낸다. 머리말이 끝날 때까지만 모아 본다.
        let out = piece;
        if (leading) {
          out = stripPolishPreamble(piece);
          if (out.trim().length > 0) leading = false;
        }
        if (out.length === 0) continue;
        sentAny = true;
        yield { t: 'text', d: out };
      }
      const end = await stream.done;
      onUsage(end.usage);
      deps.log?.attempt(attempt, 'ok', now() - started);
      yield { t: 'done', stop: end.stop };
      return;
    } catch (error) {
      clearTimeout(firstByteTimer);
      let kind: AiFailureKind = error instanceof AiCallError ? error.kind : 'fatal';
      if (kind === 'aborted' && !deps.signal.aborted) kind = 'timeout';
      deps.log?.attempt(attempt, kind, now() - started);
      if (deps.signal.aborted) return; // 기기가 패널을 닫음: 조용히 끝(정산은 부른 쪽)
      lastKind = kind;
      // 글자를 이미 보냈다면 시간 초과·형식 재시도는 하지 않는다(받은 데까지 보이고 `다시 받기`).
      if (sentAny && kind !== 'refusal' && kind !== 'transient') break;
      const next = nextAttempt(deps.config, attempt, kind === 'limit' ? 'format' : kind, tried);
      if (next && sentAny) yield { t: 'reset' };
      sentAny = false;
      attempt = next;
    }
  }
  yield { t: 'error', code: errorCodeFor(lastKind) };
}
