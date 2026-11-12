import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_BUTTONS, GENRE_IDS, resolveGenreVariant, type AiButton } from '@geulbang/core';
import { defaultConfig } from '@geulbang/core/config';
import { z } from 'zod';
import type { AiInput, GenreLens } from '../../apps/server/src/ai/port.ts';
import { systemPrompt, userPrompt } from '../../apps/server/src/ai/prompts/index.ts';
import { chunkForSpell } from '../../apps/server/src/application/spellChunks.ts';

/**
 * AI 평가 데이터셋·후보 설정 불러오기 및 토큰·비용 어림 계산(PLAN §8.7, PRD 6.4.1·6.7).
 * - 한글 1글자 ≈ 1.3토큰(`apps/server/src/ai/run.ts`의 `polishMaxTokens`와 같은 어림 계수).
 * - 단가는 `tools/eval/candidates.json`에서 읽는다(코드에 숫자를 따로 박지 않는다).
 */
export const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(EVAL_DIR, '../..');
export const DATASET_DIR = path.join(EVAL_DIR, 'dataset');
export const CANDIDATES_PATH = path.join(EVAL_DIR, 'candidates.json');

/** 주의 주제(전쟁·죽음) 평가 글 4편 ID(PRD 6.4.1·6.7, dataset/README.md). */
export const CAUTION_DOC_IDS: ReadonlySet<string> = new Set([
  '03-story-shelter-origami',
  '07-poem-star-puppy',
  '16-news-peace-museum',
  '19-essay-history-review',
]);

/** 한글·기호 코드 포인트 당 평균 토큰 어림 계수(`run.ts` 1.3과 동일). */
const TOKENS_PER_CHAR = 1.3;
/** 구조화 출력(`output_config.format`) JSON 스키마가 차지하는 입력 토큰 어림치. */
const STRUCTURED_SCHEMA_TOKENS = 120;
/** `effort: "low"` 적응형 생각(adaptive thinking) 시 호출당 추가되는 출력 토큰 어림치. */
const LOW_EFFORT_THINKING_TOKENS = 220;
/** 생각 깊이별 호출당 생각 토큰 어림(2026-11-12 첫 평가의 낮음 실측을 기준으로 보통·높음은 넉넉히 잡음). */
const THINKING_TOKENS_BY_EFFORT = {
  off: 0,
  low: LOW_EFFORT_THINKING_TOKENS,
  medium: 800,
  high: 2000,
} as const;

export const pricingSchema = z
  .object({
    inputUsdPerMTok: z.number().nonnegative(),
    outputUsdPerMTok: z.number().nonnegative(),
  })
  .strict();

export const candidateDefSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    model: z.string().min(1),
    effort: z.enum(['off', 'low', 'medium', 'high']),
    pricing: pricingSchema,
  })
  .strict();

export const candidatesConfigSchema = z
  .object({
    source: z.string().min(1),
    defaultRepeat: z.number().int().positive(),
    candidates: z.array(candidateDefSchema).min(1),
    fallback: z
      .object({
        model: z.string().min(1),
        effort: z.enum(['off', 'low', 'medium', 'high']),
        pricing: pricingSchema,
      })
      .strict(),
    judge: z
      .object({
        model: z.string().min(1),
        effort: z.enum(['off', 'low', 'medium', 'high']),
        batchDiscount: z.number().min(0).max(1),
        pricing: pricingSchema,
      })
      .strict(),
  })
  .strict();

export type Pricing = z.infer<typeof pricingSchema>;
export type CandidateDef = z.infer<typeof candidateDefSchema>;
export type CandidatesConfig = z.infer<typeof candidatesConfigSchema>;

export const plantedErrorSchema = z
  .object({
    original: z.string().min(1),
    suggestion: z.string().min(1),
    kind: z.enum(['spelling', 'spacing', 'grammar']),
  })
  .strict();

export const evalDocSchema = z
  .object({
    id: z.string().min(1),
    genre: z.enum(GENRE_IDS),
    subtype: z.string().nullable(),
    purpose: z.string().nullable().optional(),
    text: z.string().min(1),
    helpNotes: z
      .array(
        z
          .object({
            question: z.string().min(1),
            note: z.string().min(1),
          })
          .strict(),
      )
      .readonly(),
    plantedErrors: z.array(plantedErrorSchema).readonly(),
    mustNotFlag: z.array(z.string().min(1)).readonly(),
    notes: z.string().min(1),
  })
  .strict();

export type PlantedError = z.infer<typeof plantedErrorSchema>;
export type EvalDoc = z.infer<typeof evalDocSchema>;

export function loadCandidatesConfig(filePath: string = CANDIDATES_PATH): CandidatesConfig {
  const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return candidatesConfigSchema.parse(raw);
}

export function loadDataset(dirPath: string = DATASET_DIR): EvalDoc[] {
  const files = fs
    .readdirSync(dirPath)
    .filter(f => f.endsWith('.json'))
    .sort();
  return files.map(file => {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(dirPath, file), 'utf8'));
    return evalDocSchema.parse(raw);
  });
}

export function isCautionDoc(doc: Pick<EvalDoc, 'id' | 'notes'>): boolean {
  return CAUTION_DOC_IDS.has(doc.id) || doc.notes.includes('[주의 주제');
}

/** 서버 `prepareAiRequest`(`apps/server/src/application/aiRequest.ts`)와 같은 규칙으로 `AiInput`을 조립한다. */
export function buildAiInput<B extends AiButton>(doc: EvalDoc, button: B): AiInput & { readonly button: B } {
  const variant = resolveGenreVariant(
    {
      genre: doc.genre,
      subtype: doc.subtype,
      purpose: doc.purpose,
    },
    defaultConfig,
  );
  const lens: GenreLens = {
    feedback: variant.lens.feedbackFocus,
    direction: variant.lens.directionFocus,
    polish: variant.lens.polishFocus,
    factMode: variant.lens.factMode === 'question' ? 'question' : 'none',
  };
  const limit = button === 'SPELL' ? defaultConfig.AI_SPELL_MAX_CHARS : defaultConfig.AI_MAX_INPUT_CHARS;
  const chars = [...doc.text];
  const text = chars.length <= limit ? doc.text : chars.slice(-limit).join('');
  const range: 'ALL' | 'TAIL' = chars.length <= limit ? 'ALL' : button === 'SPELL' ? 'ALL' : 'TAIL';

  return {
    button,
    genre: doc.genre,
    ...(variant.subtype ? { subtype: variant.subtype } : {}),
    ...(variant.purpose ? { purpose: variant.purpose } : {}),
    lens,
    helpNotes: doc.helpNotes,
    range,
    text,
  };
}

/** 모델 ID로 단가를 찾는다(`candidates.json` 기준). */
export function pricingForModel(config: CandidatesConfig, model: string): Pricing {
  const found = config.candidates.find(c => c.model === model);
  if (found) return found.pricing;
  if (config.fallback.model === model) return config.fallback.pricing;
  if (config.judge.model === model) return config.judge.pricing;
  return config.fallback.pricing;
}

export function computeTokenCostUsd(
  inputTokens: number,
  outputTokens: number,
  pricing: Pricing,
  discountFactor = 1,
): number {
  const raw = (inputTokens * pricing.inputUsdPerMTok + outputTokens * pricing.outputUsdPerMTok) / 1_000_000;
  return raw * discountFactor;
}

export interface CandidateCostEstimate {
  readonly candidateId: string;
  readonly label: string;
  readonly model: string;
  readonly effort: CandidateDef['effort'];
  readonly pricing: Pricing;
  readonly callsPerPass: number;
  readonly totalCalls: number;
  readonly inputTokensPerPass: number;
  readonly outputTokensPerPass: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly usdPerPass: number;
  readonly totalUsd: number;
}

export interface JudgeCostEstimate {
  readonly model: string;
  readonly pricing: Pricing;
  readonly batchRequests: number;
  readonly batchDiscount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalUsd: number;
}

export interface EvalCostSummary {
  readonly docCount: number;
  readonly buttonCount: number;
  readonly repeat: number;
  readonly totalTextChars: number;
  readonly candidates: readonly CandidateCostEstimate[];
  readonly judge: JudgeCostEstimate;
  readonly generationTotalUsd: number;
  readonly grandTotalUsd: number;
}

function estimateSingleCallTokens(
  doc: EvalDoc,
  button: AiButton,
  effort: CandidateDef['effort'],
): { calls: number; inputTokens: number; outputTokens: number } {
  const input = buildAiInput(doc, button);
  const sysChars = [...systemPrompt(button)].length;
  const thinkingTokens = THINKING_TOKENS_BY_EFFORT[effort];

  if (button === 'SPELL') {
    const chunks = chunkForSpell(input.text, defaultConfig.AI_SPELL_CHUNK_CHARS);
    let inTok = 0;
    for (const chunk of chunks) {
      const uChars = [...userPrompt({ ...input, text: chunk })].length;
      inTok += Math.ceil((sysChars + uChars) * TOKENS_PER_CHAR) + STRUCTURED_SCHEMA_TOKENS;
    }
    const outTok =
      Math.ceil(80 + doc.plantedErrors.length * 45) + thinkingTokens * Math.max(1, chunks.length);
    return { calls: chunks.length, inputTokens: inTok, outputTokens: outTok };
  }

  const uChars = [...userPrompt(input)].length;
  if (button === 'FEEDBACK') {
    const inTok = Math.ceil((sysChars + uChars) * TOKENS_PER_CHAR) + STRUCTURED_SCHEMA_TOKENS;
    return { calls: 1, inputTokens: inTok, outputTokens: 180 + thinkingTokens };
  }
  if (button === 'DIRECTION') {
    const inTok = Math.ceil((sysChars + uChars) * TOKENS_PER_CHAR) + STRUCTURED_SCHEMA_TOKENS;
    return { calls: 1, inputTokens: inTok, outputTokens: 150 + thinkingTokens };
  }
  // POLISH
  const inTok = Math.ceil((sysChars + uChars) * TOKENS_PER_CHAR);
  const outTok = Math.ceil([...input.text].length * TOKENS_PER_CHAR) + thinkingTokens;
  return { calls: 1, inputTokens: inTok, outputTokens: outTok };
}

export function estimateEvalCost(
  docs: readonly EvalDoc[],
  config: CandidatesConfig,
  repeat: number = config.defaultRepeat,
): EvalCostSummary {
  const totalTextChars = docs.reduce((sum, d) => sum + [...d.text].length, 0);

  const candidates: CandidateCostEstimate[] = config.candidates.map(cand => {
    let callsPerPass = 0;
    let inputTokensPerPass = 0;
    let outputTokensPerPass = 0;

    for (const doc of docs) {
      for (const button of AI_BUTTONS) {
        const est = estimateSingleCallTokens(doc, button, cand.effort);
        callsPerPass += est.calls;
        inputTokensPerPass += est.inputTokens;
        outputTokensPerPass += est.outputTokens;
      }
    }

    const totalCalls = callsPerPass * repeat;
    const totalInputTokens = inputTokensPerPass * repeat;
    const totalOutputTokens = outputTokensPerPass * repeat;
    const usdPerPass = computeTokenCostUsd(inputTokensPerPass, outputTokensPerPass, cand.pricing);
    const totalUsd = usdPerPass * repeat;

    return {
      candidateId: cand.id,
      label: cand.label,
      model: cand.model,
      effort: cand.effort,
      pricing: cand.pricing,
      callsPerPass,
      totalCalls,
      inputTokensPerPass,
      outputTokensPerPass,
      totalInputTokens,
      totalOutputTokens,
      usdPerPass,
      totalUsd,
    };
  });

  // 비교 판정(Judge): 글 24편 × 3버튼(FEEDBACK, DIRECTION, POLISH) = 72건, 세 후보 응답을 한꺼번에 비교
  const judgeButtons: readonly Exclude<AiButton, 'SPELL'>[] = ['FEEDBACK', 'DIRECTION', 'POLISH'];
  let judgeInputTokens = 0;
  let judgeOutputTokens = 0;
  let batchRequests = 0;

  for (const doc of docs) {
    const docTokens = Math.ceil([...doc.text].length * TOKENS_PER_CHAR);
    for (const button of judgeButtons) {
      batchRequests += 1;
      const candReplyTokens = button === 'POLISH' ? docTokens * 3 : 180 * 3;
      // 판정 지침·기준표(약 650토큰) + 원문 + 세 후보 응답
      judgeInputTokens += 650 + docTokens + candReplyTokens;
      // 구조화 판정 JSON(약 350토큰) + 낮은 추론(약 250토큰)
      judgeOutputTokens += 600;
    }
  }

  const discountFactor = 1 - config.judge.batchDiscount;
  const judgeUsd = computeTokenCostUsd(
    judgeInputTokens,
    judgeOutputTokens,
    config.judge.pricing,
    discountFactor,
  );

  const generationTotalUsd = candidates.reduce((s, c) => s + c.totalUsd, 0);
  const grandTotalUsd = generationTotalUsd + judgeUsd;

  return {
    docCount: docs.length,
    buttonCount: AI_BUTTONS.length,
    repeat,
    totalTextChars,
    candidates,
    judge: {
      model: config.judge.model,
      pricing: config.judge.pricing,
      batchRequests,
      batchDiscount: config.judge.batchDiscount,
      inputTokens: judgeInputTokens,
      outputTokens: judgeOutputTokens,
      totalUsd: judgeUsd,
    },
    generationTotalUsd,
    grandTotalUsd,
  };
}

export function formatEstimateTable(summary: EvalCostSummary, sourceNote: string): string {
  const lines: string[] = [
    `# AI 평가 비용 어림표 (글 ${summary.docCount}편 × 버튼 ${summary.buttonCount}개 × 반복 ${summary.repeat}회)`,
    '',
    `- 단가 출처: ${sourceNote}`,
    `- 원문 글자 수 합계: ${summary.totalTextChars.toLocaleString('en-US')}자 (한글 1자 ≈ ${TOKENS_PER_CHAR}토큰 어림, 맞춤법은 1,500자 초과 시 문단 분할)`,
    '',
    '| 구분 | 모델 (`effort`) | 단가 (입력/출력, $/MTok) | 호출 수 | 입력 토큰 | 출력 토큰 (추론 포함) | 1회전 비용 ($) | 전체 비용 ($) |',
    '|---|---|---|---:|---:|---:|---:|---:|',
  ];

  for (const c of summary.candidates) {
    const rate = `$${c.pricing.inputUsdPerMTok.toFixed(2)} / $${c.pricing.outputUsdPerMTok.toFixed(2)}`;
    lines.push(
      `| ${c.label} (\`${c.candidateId}\`) | \`${c.model}\` (\`${c.effort}\`) | ${rate} | ${c.totalCalls} | ${c.totalInputTokens.toLocaleString('en-US')} | ${c.totalOutputTokens.toLocaleString('en-US')} | $${c.usdPerPass.toFixed(4)} | $${c.totalUsd.toFixed(4)} |`,
    );
  }

  const genCalls = summary.candidates.reduce((s, c) => s + c.totalCalls, 0);
  const genIn = summary.candidates.reduce((s, c) => s + c.totalInputTokens, 0);
  const genOut = summary.candidates.reduce((s, c) => s + c.totalOutputTokens, 0);
  const genOnePass = summary.candidates.reduce((s, c) => s + c.usdPerPass, 0);
  lines.push(
    `| **생성 합계 (후보 3개)** | — | — | **${genCalls}** | **${genIn.toLocaleString('en-US')}** | **${genOut.toLocaleString('en-US')}** | **$${genOnePass.toFixed(4)}** | **$${summary.generationTotalUsd.toFixed(4)}** |`,
  );

  const j = summary.judge;
  const effInRate = (j.pricing.inputUsdPerMTok * (1 - j.batchDiscount)).toFixed(2);
  const effOutRate = (j.pricing.outputUsdPerMTok * (1 - j.batchDiscount)).toFixed(2);
  lines.push(
    `| 비교 판정 (Message Batches ${Math.round(j.batchDiscount * 100)}% 할인) | \`${j.model}\` (\`low\`) | $${effInRate} / $${effOutRate} | ${j.batchRequests} | ${j.inputTokens.toLocaleString('en-US')} | ${j.outputTokens.toLocaleString('en-US')} | $${j.totalUsd.toFixed(4)} | $${j.totalUsd.toFixed(4)} |`,
  );
  lines.push(
    `| **전체 합계 (생성 + 비교 판정, U-11 승인 대상)** | — | — | **${genCalls + j.batchRequests}** | **${(genIn + j.inputTokens).toLocaleString('en-US')}** | **${(genOut + j.outputTokens).toLocaleString('en-US')}** | **$${(genOnePass + j.totalUsd).toFixed(4)}** | **$${summary.grandTotalUsd.toFixed(4)}** |`,
  );

  return lines.join('\n');
}

function parseRepeatArg(argv: readonly string[], fallback: number): number {
  const idx = argv.indexOf('--repeat');
  if (idx >= 0 && argv[idx + 1]) {
    const n = Number(argv[idx + 1]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadCandidatesConfig();
  const docs = loadDataset();
  const repeat = parseRepeatArg(process.argv.slice(2), config.defaultRepeat);
  const summary = estimateEvalCost(docs, config, repeat);
  console.log(formatEstimateTable(summary, config.source));
}
