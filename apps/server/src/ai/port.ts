import type { AiButton } from '@geulbang/core';
import type { DirectionResult, FeedbackResult, SpellResult } from './schemas.ts';

/**
 * AI 포트(PLAN §8.1). 제공사를 바꿔도 앱 코드가 그대로이도록 이 모양 하나 뒤에 어댑터를 둔다(PRD 6.4).
 * 보내는 것은 PRD 6.1 그대로: 본문·글 종류·하위 종류·용도·도움 질문 메모·(가사) 분위기와 빠르기.
 * 학교·별명·학급명·수업명·기기 정보·제목은 이 모양에 칸이 없다(보낼 수 없게).
 */
export interface GenreLens {
  /** 글벗 한마디·다음 방향·다듬은 글에서 볼 점(한국어 한 줄씩) */
  readonly feedback: string;
  readonly direction: string;
  readonly polish: string;
  /** 기사만 `question`: 확인해 볼 사실 하나를 질문으로(PRD 6.2-6) */
  readonly factMode: 'question' | 'none';
}

export interface AiInput {
  readonly button: AiButton;
  readonly genre: string;
  readonly subtype?: string;
  readonly purpose?: string;
  readonly purposeCustom?: string;
  readonly lens: GenreLens;
  readonly helpNotes: readonly { readonly question: string; readonly note: string }[];
  readonly song?: { readonly mood: string; readonly tempo: string };
  readonly range: 'ALL' | 'TAIL';
  readonly text: string;
  /**
   * 1인칭 위험 신호(docs/ai-harness.md L0 R-01)가 글에 있음. 한마디가 고칠 점보다 마음을 먼저 알아주게 한다.
   * 무엇이 걸렸는지는 보내지 않는다.
   */
  readonly care?: boolean;
}

export interface Usage {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface CallOptions {
  readonly model: string;
  readonly effort: 'off' | 'low' | 'medium' | 'high';
  readonly maxTokens: number;
  readonly signal: AbortSignal;
  /** 서버 측 대체(거절되면 다른 Claude 모델로, PRD 6.5). 대체 모델 호출에만 켠다. */
  readonly serverFallback?: boolean;
  /** 형식이 깨져 다시 묻는 경우 덧붙이는 한 줄(PRD 6.5 "형식을 고쳐 줘") */
  readonly formatRetry?: boolean;
  /** 출력 검사(L2)에 걸려 다시 묻는 경우 덧붙이는 한 줄 */
  readonly safetyRetry?: boolean;
  /** 남용 탐지용 불투명 사용자 ID(`metadata.user_id`, docs/ai-harness.md M-04). 이름·기기 정보가 아니다. */
  readonly userTag?: string;
}

export type AiStructured<B extends Exclude<AiButton, 'POLISH'>> = B extends 'SPELL'
  ? SpellResult
  : B extends 'FEEDBACK'
    ? FeedbackResult
    : DirectionResult;

export interface StructuredReply<T> {
  readonly value: T;
  readonly usage: Usage;
}

/** 다듬은 글: 글자 조각 스트림 + 끝났을 때 이유와 사용량 */
export interface AiTextStream extends AsyncIterable<string> {
  readonly done: Promise<{ readonly stop: 'end' | 'limit'; readonly usage: Usage }>;
}

/** 어댑터가 던지는 실패 종류. `run.ts`가 이것으로 재시도·대체를 정한다(PLAN §8.2 표). */
export type AiFailureKind =
  | 'timeout'
  | 'format'
  | 'limit'
  | 'transient'
  | 'refusal'
  | 'aborted'
  | 'fatal'
  /** 출력 검사(docs/ai-harness.md L2 G 규칙)에 걸림. 메시지에 규칙 ID. */
  | 'unsafe';

export class AiCallError extends Error {
  readonly kind: AiFailureKind;
  constructor(kind: AiFailureKind, message: string = kind) {
    super(message);
    this.name = 'AiCallError';
    this.kind = kind;
  }
}

export interface AiPort {
  structured<B extends Exclude<AiButton, 'POLISH'>>(
    input: AiInput & { readonly button: B },
    options: CallOptions,
  ): Promise<StructuredReply<AiStructured<B>>>;
  polish(input: AiInput & { readonly button: 'POLISH' }, options: CallOptions): AiTextStream;
  ping(options: CallOptions): Promise<{ readonly ok: boolean; readonly latencyMs: number }>;
}
