import Anthropic from '@anthropic-ai/sdk';
import type { AiButton } from '@geulbang/core';
import {
  AiCallError,
  type AiInput,
  type AiPort,
  type AiTextStream,
  type CallOptions,
  type StructuredReply,
  type Usage,
} from './port.ts';
import { FORMAT_RETRY, SAFETY_RETRY, systemPrompt, userPrompt } from './prompts/index.ts';
import { providerSchema, resultSchemas } from './schemas.ts';

/**
 * Anthropic 어댑터(PLAN §8.1·§8.3). 공식 `@anthropic-ai/sdk`, SDK 자체 재시도는 끈다(재시도·대체는 `run.ts`가 정한다).
 * - Claude 5.5 계열은 `temperature`를 받지 않는다. 보내지 않는다(ADR-010).
 * - 생각 깊이 "끔": Haiku 5.5는 `thinking: disabled`, Sonnet 5.5는 `disabled`가 400이라 `between_tools`.
 *   "낮음" 이상: `thinking: adaptive` + `output_config.effort`.
 * - 구조화 출력: `output_config.format`(json_schema). 받은 뒤 원래 zod 스키마로 다시 검증한다(§8.5).
 * - 서버 측 대체(PRD 6.5): 대체 모델(Sonnet) 호출에만 `fallbacks: "default"` + 베타 머리.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicAiDeps {
  readonly apiKey: string;
  /** 시험에서 가짜 서버를 가리킬 때 */
  readonly baseURL?: string;
}

type Thinking = { type: 'disabled' } | { type: 'between_tools' } | { type: 'adaptive' };

function thinkingFor(
  model: string,
  effort: CallOptions['effort'],
): { thinking: Thinking; effort?: 'low' | 'medium' | 'high' } {
  if (effort === 'off')
    return {
      thinking: model.startsWith('claude-sonnet-') ? { type: 'between_tools' } : { type: 'disabled' },
    };
  return { thinking: { type: 'adaptive' }, effort };
}

function classify(error: unknown): AiCallError {
  if (error instanceof AiCallError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return new AiCallError('aborted');
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiCallError('timeout');
  if (error instanceof Anthropic.APIConnectionError) return new AiCallError('transient', 'connection');
  if (error instanceof Anthropic.RateLimitError) return new AiCallError('transient', 'rate_limit');
  if (error instanceof Anthropic.InternalServerError)
    return new AiCallError('transient', `status_${error.status}`);
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    if (status === 529 || status >= 500) return new AiCallError('transient', `status_${status}`);
    return new AiCallError('fatal', `status_${status}`);
  }
  return new AiCallError('fatal', 'unknown');
}

export function createAnthropicAi(deps: AnthropicAiDeps): AiPort {
  const client = new Anthropic({
    apiKey: deps.apiKey,
    maxRetries: 0,
    ...(deps.baseURL ? { baseURL: deps.baseURL } : {}),
  });

  const baseParams = (input: AiInput, o: CallOptions) => {
    const t = thinkingFor(o.model, o.effort);
    const content: { type: 'text'; text: string }[] = [{ type: 'text', text: userPrompt(input) }];
    if (o.formatRetry) content.push({ type: 'text', text: FORMAT_RETRY });
    if (o.safetyRetry) content.push({ type: 'text', text: SAFETY_RETRY });
    return {
      model: o.model,
      max_tokens: o.maxTokens,
      system: systemPrompt(input.button),
      messages: [{ role: 'user' as const, content }],
      thinking: t.thinking,
      // 남용 탐지용 불투명 ID만(docs/ai-harness.md M-04). 이름·이메일·기기 정보는 넣지 않는다.
      ...(o.userTag ? { metadata: { user_id: o.userTag } } : {}),
      ...(o.serverFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      effort: t.effort,
    };
  };

  const usageOf = (
    model: string,
    u: { input_tokens?: number | null; output_tokens?: number | null } | undefined,
  ): Usage => ({
    model,
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
  });

  return {
    async structured<B extends Exclude<AiButton, 'POLISH'>>(
      input: AiInput & { readonly button: B },
      o: CallOptions,
    ) {
      const { effort, ...params } = baseParams(input, o);
      const schema = resultSchemas[input.button];
      let res;
      try {
        res = await client.beta.messages.create(
          {
            ...params,
            output_config: {
              format: { type: 'json_schema', schema: providerSchema(schema) },
              ...(effort ? { effort } : {}),
            },
          },
          { signal: o.signal },
        );
      } catch (error) {
        throw classify(error);
      }
      if (res.stop_reason === 'refusal') throw new AiCallError('refusal');
      if (res.stop_reason === 'max_tokens') throw new AiCallError('limit');
      const text = res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AiCallError('format', 'json');
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) throw new AiCallError('format', 'schema');
      return { value: parsed.data, usage: usageOf(res.model, res.usage) } as StructuredReply<never>;
    },

    polish(input, o): AiTextStream {
      const { effort, ...params } = baseParams(input, o);
      let resolveDone!: (v: { stop: 'end' | 'limit'; usage: Usage }) => void;
      let rejectDone!: (e: unknown) => void;
      const done = new Promise<{ stop: 'end' | 'limit'; usage: Usage }>((res, rej) => {
        resolveDone = res;
        rejectDone = rej;
      });
      // 아무도 기다리지 않을 때 처리되지 않은 거부로 프로세스가 시끄럽지 않게
      done.catch(() => {});

      async function* iterate(): AsyncGenerator<string> {
        let model = o.model;
        let inputTokens = 0;
        let outputTokens = 0;
        let stop: string | null = null;
        try {
          const stream = await client.beta.messages.create(
            { ...params, stream: true, ...(effort ? { output_config: { effort } } : {}) },
            { signal: o.signal },
          );
          for await (const event of stream) {
            if (event.type === 'message_start') {
              model = event.message.model;
              inputTokens = event.message.usage.input_tokens ?? 0;
            } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              yield event.delta.text;
            } else if (event.type === 'message_delta') {
              stop = event.delta.stop_reason ?? stop;
              outputTokens = event.usage.output_tokens ?? outputTokens;
            }
          }
        } catch (error) {
          const e = classify(error);
          rejectDone(e);
          throw e;
        }
        const usage: Usage = { model, inputTokens, outputTokens };
        if (stop === 'refusal') {
          const e = new AiCallError('refusal');
          rejectDone(e);
          throw e;
        }
        resolveDone({ stop: stop === 'max_tokens' ? 'limit' : 'end', usage });
      }

      return { [Symbol.asyncIterator]: iterate, done };
    },

    async ping(o) {
      const started = Date.now();
      try {
        await client.beta.messages.create(
          {
            model: o.model,
            max_tokens: o.maxTokens,
            messages: [{ role: 'user', content: '안녕' }],
            ...thinkingFor(o.model, 'off'),
          },
          { signal: o.signal },
        );
        return { ok: true, latencyMs: Date.now() - started };
      } catch {
        return { ok: false, latencyMs: Date.now() - started };
      }
    },
  };
}
