import { z } from 'zod';
import { MODEL_RULE_IDS, SPELL_INTENTS, SPELL_SEVERITIES } from './guard/spellRules.ts';

/**
 * 버튼별 응답 형식(PRD 6.3). 검증은 이 zod 스키마로, 제공사에는 `providerSchema`가 만든 JSON 스키마를 보낸다.
 * 제공사가 받지 않는 제약(문자열 최대 길이·배열 개수 등)은 빼서 보내고, 받은 뒤 `validate.ts`가 다시 확인한다(PLAN §8.3).
 */
export const SPELL_KINDS = ['맞춤법', '띄어쓰기', '문장부호'] as const;

/** 길이 한도(PRD 6.3 주석의 글자 수). 20% 안으로 넘으면 잘라 쓰고, 더 넘으면 형식 오류. */
export const LIMITS = {
  spellReason: 40,
  spellContext: 6,
  spellItems: 30,
  praise: 60,
  improve: 80,
  improveMin: 1,
  improveMax: 2,
  idea: 60,
  ideasMin: 2,
  ideasMax: 3,
  note: 80,
} as const;

export const spellResultSchema = z.object({
  items: z.array(
    z.object({
      original: z.string().min(1),
      suggestion: z.string(),
      reason: z.string(),
      kind: z.enum(SPELL_KINDS),
      context: z.object({ before: z.string(), after: z.string() }),
      // 등급·의도·근거(docs/ai-harness.md 5절). 모델이 비우면 서버가 확신 없음(권장)으로 본다.
      severity: z.enum(SPELL_SEVERITIES).optional(),
      intent: z.enum(SPELL_INTENTS).optional(),
      ruleId: z.enum(MODEL_RULE_IDS).optional(),
    }),
  ),
});
export type SpellResult = z.output<typeof spellResultSchema>;

export const feedbackResultSchema = z.object({
  praise: z.string().min(1),
  improve: z.array(z.string().min(1)),
  factCheck: z.string().optional(),
  eraNote: z.string().optional(),
  softenNote: z.string().optional(),
});
export type FeedbackResult = z.output<typeof feedbackResultSchema>;

export const directionResultSchema = z.object({
  ideas: z.array(z.object({ text: z.string().min(1), label: z.string().optional() })),
});
export type DirectionResult = z.output<typeof directionResultSchema>;

export const resultSchemas = {
  SPELL: spellResultSchema,
  FEEDBACK: feedbackResultSchema,
  DIRECTION: directionResultSchema,
} as const;

/** 제공사용 JSON 스키마: 길이·개수 제약을 빼고, 모든 객체를 닫는다(`additionalProperties: false`). */
export function providerSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  return strip(json) as Record<string, unknown>;
}

const DROP = new Set(['$schema', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'format']);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (DROP.has(k)) continue;
    out[k] = strip(v);
  }
  if (out['type'] === 'object') out['additionalProperties'] = false;
  return out;
}
