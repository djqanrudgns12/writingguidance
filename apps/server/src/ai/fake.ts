import type { AiButton } from '@geulbang/core';
import {
  AiCallError,
  type AiFailureKind,
  type AiInput,
  type AiPort,
  type AiTextStream,
  type CallOptions,
} from './port.ts';
import type { DirectionResult, FeedbackResult, SpellResult } from './schemas.ts';

/**
 * 시험용 AI(PLAN §8.1 `fake.ts`, 설정 `AI_PROVIDER=fake`, 운영에서는 시작 거부).
 * 정해진 답을 돌려주고, `script`로 지연·실패·거절을 흉내 낸다. 진짜 제공사를 부르지 않는다(비용 0).
 * 맞춤법은 흔한 실수 몇 개를 글에서 찾아 실제로 있는 것만 돌려준다(화면의 위치 찾기를 시험하려고).
 */
export interface FakeStep {
  readonly fail?: AiFailureKind;
  readonly delayMs?: number;
  /** 다듬은 글: 이만큼 글자를 보낸 뒤 실패 */
  readonly failAfterChars?: number;
}

export interface FakeAiOptions {
  /** 호출마다 하나씩 꺼내 쓴다. 비면 정상 응답. */
  readonly script?: FakeStep[];
  readonly delayMs?: number;
  readonly chunkChars?: number;
}

const COMMON_MISTAKES: readonly {
  original: string;
  suggestion: string;
  reason: string;
  kind: '맞춤법' | '띄어쓰기';
}[] = [
  { original: '되요', suggestion: '돼요', reason: '"되어요"를 줄이면 "돼요"예요.', kind: '맞춤법' },
  { original: '안되', suggestion: '안 돼', reason: '"안"과 "돼"는 띄어 써요.', kind: '띄어쓰기' },
  { original: '할수', suggestion: '할 수', reason: '"수"는 앞말과 띄어 써요.', kind: '띄어쓰기' },
  { original: '어떻해', suggestion: '어떡해', reason: '"어떻게 해"를 줄이면 "어떡해"예요.', kind: '맞춤법' },
  { original: '몇일', suggestion: '며칠', reason: '"며칠"이 맞는 말이에요.', kind: '맞춤법' },
];

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new AiCallError('aborted'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new AiCallError('aborted'));
      },
      { once: true },
    );
  });

export function fakeSpell(text: string): SpellResult {
  const items: SpellResult['items'] = [];
  for (const m of COMMON_MISTAKES) {
    for (let at = text.indexOf(m.original); at >= 0; at = text.indexOf(m.original, at + 1)) {
      items.push({
        original: m.original,
        suggestion: m.suggestion,
        reason: m.reason,
        kind: m.kind,
        context: {
          before: text.slice(Math.max(0, at - 6), at),
          after: text.slice(at + m.original.length, at + m.original.length + 6),
        },
      });
    }
  }
  return { items };
}

export function createFakeAi(
  options: FakeAiOptions = {},
): AiPort & { calls: { button: AiButton | 'PING'; model: string }[] } {
  const script = [...(options.script ?? [])];
  const calls: { button: AiButton | 'PING'; model: string }[] = [];
  const chunk = Math.max(1, options.chunkChars ?? 8);

  const step = async (button: AiButton | 'PING', o: CallOptions): Promise<FakeStep> => {
    calls.push({ button, model: o.model });
    const s = script.shift() ?? {};
    await sleep(s.delayMs ?? options.delayMs ?? 0, o.signal);
    if (s.fail && s.failAfterChars === undefined) throw new AiCallError(s.fail);
    return s;
  };

  return {
    calls,
    async structured(input, o) {
      await step(input.button, o);
      const usage = { model: o.model, inputTokens: input.text.length, outputTokens: 50 };
      if (input.button === 'SPELL') return { value: fakeSpell(input.text) as never, usage };
      if (input.button === 'FEEDBACK') {
        const value: FeedbackResult = {
          praise: '처음 장면이 눈에 그려지듯 생생해요.',
          improve: ['그때 내 마음이 어땠는지 한 문장 더 써 보면 어때요?'],
          ...(input.lens.factMode === 'question'
            ? { factCheck: '날짜가 맞는지 한 번 더 확인해 볼까요?' }
            : {}),
        };
        return { value: value as never, usage };
      }
      const value: DirectionResult = {
        ideas: [
          { text: '그다음에 무슨 일이 있었는지 이어서 써 봐요.' },
          { text: '그 일을 겪고 새로 알게 된 점을 써 봐요.' },
          { text: '함께 있던 사람의 말을 한마디 넣어 봐요.' },
        ],
      };
      return { value: value as never, usage };
    },
    polish(input, o): AiTextStream {
      let resolveDone!: (v: Awaited<AiTextStream['done']>) => void;
      let rejectDone!: (e: unknown) => void;
      const done = new Promise<Awaited<AiTextStream['done']>>((res, rej) => {
        resolveDone = res;
        rejectDone = rej;
      });
      done.catch(() => {});
      const polished = input.text.replace(/되요/g, '돼요').replace(/할수/g, '할 수');
      async function* iterate(): AsyncGenerator<string> {
        let s: FakeStep;
        try {
          s = await step('POLISH', o);
        } catch (e) {
          rejectDone(e);
          throw e;
        }
        const chars = [...polished];
        for (let i = 0; i < chars.length; i += chunk) {
          if (s.fail && s.failAfterChars !== undefined && i >= s.failAfterChars) {
            const e = new AiCallError(s.fail);
            rejectDone(e);
            throw e;
          }
          if (o.signal.aborted) {
            const e = new AiCallError('aborted');
            rejectDone(e);
            throw e;
          }
          yield chars.slice(i, i + chunk).join('');
        }
        resolveDone({
          stop: 'end',
          usage: { model: o.model, inputTokens: chars.length, outputTokens: chars.length },
        });
      }
      return { [Symbol.asyncIterator]: iterate, done };
    },
    async ping(o) {
      await step('PING', o);
      return { ok: true, latencyMs: 1 };
    },
  };
}
