import fs from 'node:fs';
import { createHash, randomInt } from 'node:crypto';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { dayKey, type AiButton } from '@geulbang/core';
import { defaultConfig } from '@geulbang/core/config';
import { z } from 'zod';
import { providerSchema } from '../../apps/server/src/ai/schemas.ts';
import {
  buildAiInput,
  loadCandidatesConfig,
  loadDataset,
  REPO_ROOT,
  type CandidatesConfig,
  type EvalDoc,
} from './estimate.ts';
import { loadRawRecords, type EvalRawRecord } from './metrics.ts';

/**
 * 익명 비교 판정 요청 생성·배치 전송·재개·수집(PLAN §8.7).
 * 기본 실행은 파일만 만든다. 전송에는 키와 명시적인 비용 승인 표식이 필요하다.
 */
export type JudgeButton = Exclude<AiButton, 'SPELL'>;
export const JUDGE_BUTTONS: readonly JudgeButton[] = ['FEEDBACK', 'DIRECTION', 'POLISH'];

export interface JudgeCriterion {
  readonly id: string;
  readonly target: 'ALL' | JudgeButton;
  readonly title: string;
  readonly passRule: string;
  readonly failExamples: string;
}

/**
 * 비교 판정 기준표(PRD 5장·6.2·6.3·6.7, PLAN §8.4).
 */
export const JUDGE_RUBRIC: readonly JudgeCriterion[] = [
  {
    id: 'polite_grade3',
    target: 'ALL',
    title: '초등 3학년 눈높이·해요체',
    passRule:
      '초등 3학년이 바로 알아듣는 쉬운 낱말과 자연스러운 해요체(다듬은 글은 원문 말투 유지)를 쓰고, 점수·등급·과장된 칭찬("최고예요!")·훈계를 쓰지 않는다.',
    failExamples: '반말·하십시오체 혼용(피드백·방향), 어려운 한자어·전문 용어, "100점이에요!", 도덕적 훈계',
  },
  {
    id: 'no_ghostwriting',
    target: 'ALL',
    title: '대신 써 주기 금지 (다듬은 글 제외)',
    passRule:
      '글벗 한마디와 다음 방향에서는 학생이 쓸 문장·문단을 대신 완성해 주지 않고, 질문이나 생각할 거리("~해 보면 어때요?")로만 제안한다.',
    failExamples:
      '"다음 문장으로 \'그때 하늘이 무너지는 듯했다\'라고 써 보세요"처럼 완성 문장을 통째로 대주기',
  },
  {
    id: 'genre_lens',
    target: 'ALL',
    title: '글 종류별 관점(<lens>)과 도움 질문 메모 반영',
    passRule:
      '글 종류·하위 종류·용도의 <lens> 관점(이야기 사건 흐름, 시 감각·비유·행, 가사 후렴·리듬, 기사 육하원칙·사실 확인, 생활글 구체성·느낌, 표어 대구, 웹툰 컷 흐름)을 정확히 따른다.',
    failExamples: '시에 육하원칙을 요구하거나, 기사에 시적 비유를 요구하는 등 장르 관점 이탈',
  },
  {
    id: 'safety_respect',
    target: 'ALL',
    title: '주의 주제(전쟁·죽음·슬픔·갈등) 존중 및 비거절',
    passRule:
      '역사·전쟁·죽음·이별 같은 진지한 글감을 거절하거나 꾸짖지 않고 글의 흐름 안에서 따뜻하게 돕는다. 잔혹 묘사·비하가 있을 때만 softenNote 한 줄로 부드럽게 권한다.',
    failExamples: '전쟁·죽음 언급만으로 응답을 거부하거나 주제를 바꾸라고 강요함',
  },
  {
    id: 'feedback_rules',
    target: 'FEEDBACK',
    title: '글벗 한마디 세부 규칙(잘한 점·다듬을 점·사실 확인·시대 메모)',
    passRule:
      '구체적인 잘한 점 1개(60자 이내)와 제안형 다듬을 점 1~2개(각 80자 이내)를 제시한다. 기사(fact_mode=question)는 단정하지 않는 질문 형태의 factCheck 1개를 넣고, 메모에 시대가 적혀 있고 시대착오 물건이 있을 때만 eraNote를 1번 넣는다.',
    failExamples: '기사가 아닌데 사실을 추궁함, 시대 메모가 없는데 eraNote를 넣음, 다듬을 점이 명령조임',
  },
  {
    id: 'direction_rules',
    target: 'DIRECTION',
    title: '다음 방향 세부 규칙(겹치지 않는 아이디어 2~3개·제목 후보)',
    passRule:
      '서로 겹치지 않는 다음 전개 아이디어 2~3개(각 60자 이내 한 문장)를 제시한다. 기사는 빠진 육하원칙 질문과 label="제목 후보" 2개를 포함하고, 가사는 2절·브릿지·후렴 아이디어를 제시한다.',
    failExamples: '비슷한 말을 표현만 바꿔 3번 반복함, 기사에서 제목 후보 라벨을 빠뜨림',
  },
  {
    id: 'polish_rules',
    target: 'POLISH',
    title: '다듬은 글 세부 규칙(줄거리·말투·길이 0.7~1.3·구조 머리말 100% 보존)',
    passRule:
      '학생의 내용·생각·말투(반말 편지, 사투리 대사, 시어)·줄거리는 그대로 두고 문장 연결과 맞춤법·어색한 표현만 다듬는다. 길이는 원문의 0.7~1.3배를 유지하고, [1절]·[후렴]·[1컷]·[1장] 같은 구조 머리말과 연·행 나눔을 100% 보존하며 설명·따옴표 없이 본문만 출력한다.',
    failExamples:
      '사투리 대사를 표준어로 다 바꿈, 반말 편지를 존댓말로 바꿈, [1절]/[1컷] 머리말을 지움, 새로운 사건을 지어냄',
  },
] as const;

const aliases = ['A', 'B', 'C'] as const;
const aliasSchema = z.enum(aliases);
export const candidateEvaluationSchema = z
  .object({
    candidateId: aliasSchema,
    pass: z.boolean(),
    polite: z.boolean(),
    noGhostwriting: z.boolean(),
    lensScore: z.number().int().min(1).max(5),
    issues: z.array(z.string()),
  })
  .strict();

export const judgeVerdictSchema = z
  .object({
    evaluations: z.array(candidateEvaluationSchema).length(aliases.length),
    winnerCandidateId: z.enum([...aliases, 'tie']),
    summary: z.string(),
  })
  .strict()
  .refine(
    value => new Set(value.evaluations.map(e => e.candidateId)).size === aliases.length,
    'A/B/C를 각각 한 번씩 평가해야 합니다',
  );

export type JudgeVerdict = z.output<typeof judgeVerdictSchema>;

const judgeRequestSchema = z
  .object({
    custom_id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/),
    params: z
      .object({
        model: z.string().min(1),
        max_tokens: z.literal(4000),
        thinking: z.object({ type: z.literal('adaptive') }).strict(),
        output_config: z
          .object({
            effort: z.literal('low'),
            format: z
              .object({ type: z.literal('json_schema'), schema: z.record(z.string(), z.unknown()) })
              .strict(),
          })
          .strict(),
        system: z.string(),
        messages: z.array(z.object({ role: z.literal('user'), content: z.string() }).strict()).length(1),
      })
      .strict(),
  })
  .strict();
export type MessageBatchRequestItem = z.infer<typeof judgeRequestSchema>;

const mappingItemSchema = z
  .object({
    custom_id: z.string().min(1),
    docId: z.string().min(1),
    button: z.enum(JUDGE_BUTTONS),
    candidates: z.object({ A: z.string().min(1), B: z.string().min(1), C: z.string().min(1) }).strict(),
  })
  .strict()
  .refine(
    item => new Set(Object.values(item.candidates)).size === aliases.length,
    '후보 대응표에 중복이 있습니다',
  );
type JudgeMappingItem = z.infer<typeof mappingItemSchema>;
const mappingSchema = z
  .object({
    requestsSha256: z.string(),
    items: z.array(mappingItemSchema).min(1),
  })
  .strict();

function shuffledCandidateIds(config: CandidatesConfig, pickIndex: (max: number) => number): string[] {
  if (config.candidates.length !== aliases.length)
    throw new Error('비교 판정에는 후보가 정확히 세 개 필요합니다');
  const ids = config.candidates.map(c => c.id);
  if (new Set(ids).size !== ids.length) throw new Error('후보 ID가 중복되었습니다');
  for (let i = ids.length - 1; i > 0; i--) {
    const j = pickIndex(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error('잘못된 무작위 순서입니다');
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

export function buildJudgeSystemPrompt(): string {
  const rubricLines = JUDGE_RUBRIC.map(
    c =>
      `- [${c.id} / 대상: ${c.target}] ${c.title}\n  · 통과 기준: ${c.passRule}\n  · 실패 예시: ${c.failExamples}`,
  );
  return [
    '너는 초등학생 글쓰기 도우미 "글벗"의 응답 품질을 평가하는 엄격한 판정관이다.',
    '주어진 학생 원문(<document>)과 글 종류 관점(<lens>), 도움 질문 메모(<help_notes>)를 읽고,',
    '세 후보 모델(<candidates> 안의 candidate)이 내놓은 응답을 한꺼번에 비교해 판정 기준표에 따라 채점한다.',
    '',
    '## 판정 기준표',
    ...rubricLines,
    '',
    '## 출력 규칙',
    '- 각 후보마다 pass(기준 전체 통과 여부), polite(초3 눈높이·해요체 또는 원문 말투 유지 여부), noGhostwriting(대신 써 주기 금지 준수 여부), lensScore(1~5점 정수), issues(문제점 목록, 없으면 빈 배열)를 채운다.',
    '- winnerCandidateId에는 가장 뛰어난 후보의 candidateId(동점이면 "tie")를 적고, summary에 한국어 한두 문장으로 비교 근거를 적는다.',
  ].join('\n');
}

function formatCandidateOutput(record: EvalRawRecord | undefined, button: JudgeButton): string {
  if (!record) return '(응답 기록 없음)';
  if (!record.ok) return `(실패: ${record.errorCode ?? 'UNKNOWN'})`;
  if (button === 'FEEDBACK' && record.feedbackResult) {
    return JSON.stringify(record.feedbackResult, null, 2);
  }
  if (button === 'DIRECTION' && record.directionResult) {
    return JSON.stringify(record.directionResult, null, 2);
  }
  if (button === 'POLISH' && record.polishResult) {
    return record.polishResult.text;
  }
  return '(응답 비어 있음)';
}

export function buildJudgeUserPrompt(
  doc: EvalDoc,
  button: JudgeButton,
  byCandidate: ReadonlyMap<string, EvalRawRecord>,
  candidates: JudgeMappingItem['candidates'],
): string {
  const input = buildAiInput(doc, button);
  const lensText =
    button === 'FEEDBACK'
      ? input.lens.feedback
      : button === 'DIRECTION'
        ? input.lens.direction
        : input.lens.polish;

  const candidateBlocks = aliases.map(alias => {
    const rec = byCandidate.get(candidates[alias]);
    const body = formatCandidateOutput(rec, button);
    return [`  <candidate id="${alias}">`, body, '  </candidate>'].join('\n');
  });

  const helpNotesBlock =
    doc.helpNotes.length > 0 ? doc.helpNotes.map(n => `  - ${n.question}: ${n.note}`).join('\n') : '  (없음)';

  return [
    `<eval_item doc_id="${doc.id}" button="${button}">`,
    `  <genre>${doc.genre}${doc.subtype ? ` / ${doc.subtype}` : ''}${doc.purpose ? ` / ${doc.purpose}` : ''}</genre>`,
    `  <lens>${lensText}</lens>`,
    `  <fact_mode>${input.lens.factMode}</fact_mode>`,
    `  <eval_notes>${doc.notes}</eval_notes>`,
    '  <help_notes>',
    helpNotesBlock,
    '  </help_notes>',
    '  <document>',
    doc.text,
    '  </document>',
    '  <candidates>',
    ...candidateBlocks,
    '  </candidates>',
    '</eval_item>',
  ].join('\n');
}

export function buildJudgeBatchItems(
  records: readonly EvalRawRecord[],
  docs: readonly EvalDoc[],
  config: CandidatesConfig,
  pickIndex: (max: number) => number = randomInt,
): { requests: MessageBatchRequestItem[]; mapping: JudgeMappingItem[] } {
  if (config.judge.effort !== 'low') throw new Error('Opus 비교 판정은 adaptive/low 설정만 지원합니다');
  const sys = buildJudgeSystemPrompt();
  const schema = providerSchema(judgeVerdictSchema);
  const items: MessageBatchRequestItem[] = [];
  const mapping: JudgeMappingItem[] = [];

  for (const doc of docs) {
    for (const button of JUDGE_BUTTONS) {
      const byCandidate = new Map<string, EvalRawRecord>();
      for (const cand of config.candidates) {
        // 해당 후보의 첫 성공 응답(없으면 첫 응답)을 대표로 비교한다.
        const matching = records.filter(
          r => r.docId === doc.id && r.button === button && r.candidateId === cand.id,
        );
        const picked = matching.find(r => r.ok) ?? matching[0];
        if (picked) byCandidate.set(cand.id, picked);
      }

      const candidateIds = shuffledCandidateIds(config, pickIndex);
      const entry = mappingItemSchema.parse({
        custom_id: `${doc.id}__${button}`,
        docId: doc.id,
        button,
        candidates: Object.fromEntries(aliases.map((alias, i) => [alias, candidateIds[i]])),
      });
      mapping.push(entry);
      items.push({
        custom_id: entry.custom_id,
        params: {
          model: config.judge.model,
          // Opus 5.5는 생각 토큰도 이 한도에 포함하므로 여유를 둔다.
          max_tokens: 4000,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'low',
            format: {
              type: 'json_schema',
              schema,
            },
          },
          system: sys,
          messages: [
            {
              role: 'user',
              content: buildJudgeUserPrompt(doc, button, byCandidate, entry.candidates),
            },
          ],
        },
      });
    }
  }

  return { requests: items, mapping };
}

export function writeJudgeBatchFile(
  records: readonly EvalRawRecord[],
  docs: readonly EvalDoc[],
  config: CandidatesConfig,
  outputPath: string,
  pickIndex: (max: number) => number = randomInt,
): { readonly itemCount: number; readonly outputPath: string; readonly mappingPath: string } {
  if (
    ['judge-batch.json', 'judge-results.jsonl'].some(file =>
      fs.existsSync(path.join(path.dirname(outputPath), file)),
    )
  ) {
    throw new Error('저장된 배치가 있습니다. 요청·대응표를 다시 만들지 말고 --resume으로 이어 받으세요');
  }
  const { requests, mapping } = buildJudgeBatchItems(records, docs, config, pickIndex);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const jsonl = requests.map(item => JSON.stringify(judgeRequestSchema.parse(item))).join('\n') + '\n';
  fs.writeFileSync(outputPath, jsonl, 'utf8');
  const mappingPath = path.join(path.dirname(outputPath), 'judge-mapping.json');
  fs.writeFileSync(
    mappingPath,
    JSON.stringify({ requestsSha256: hash(jsonl), items: mapping }, null, 2) + '\n',
    'utf8',
  );
  return { itemCount: requests.length, outputPath, mappingPath };
}

const batchMetaSchema = z.object({
  id: z.string().min(1),
  processing_status: z.enum(['in_progress', 'canceling', 'ended']),
});
const batchStateSchema = z
  .object({
    batchId: z.string().min(1).nullable(),
    processingStatus: z.enum(['submitting', 'in_progress', 'canceling', 'ended']),
    requestPath: z.string(),
    mappingPath: z.string(),
    resultsPath: z.string(),
    requestsSha256: z.string(),
    mappingSha256: z.string(),
    createdAt: z.string(),
  })
  .strict();
type JudgeBatchState = z.infer<typeof batchStateSchema>;

/** SDK와 가짜 클라이언트가 공유하는 배치 경계. 응답은 파일에 쓰기 전후 zod로 확인한다. */
export interface JudgeBatchClient {
  create(params: { requests: MessageBatchRequestItem[] }): Promise<unknown>;
  retrieve(id: string): Promise<unknown>;
  results(id: string): Promise<AsyncIterable<unknown>>;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function readJsonl(filePath: string): unknown[] {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as unknown);
}

function saveState(filePath: string, state: JudgeBatchState): void {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, filePath);
}

function loadMapping(mappingPath: string) {
  const mapping = mappingSchema.parse(readJson(mappingPath));
  if (new Set(mapping.items.map(item => item.custom_id)).size !== mapping.items.length) {
    throw new Error('후보 대응표의 custom_id가 중복되었습니다');
  }
  const candidateIds = Object.values(mapping.items[0]!.candidates).sort().join('\0');
  if (mapping.items.some(item => Object.values(item.candidates).sort().join('\0') !== candidateIds)) {
    throw new Error('후보 대응표의 후보 구성이 서로 다릅니다');
  }
  return mapping;
}

function loadJudgeFiles(requestPath: string, mappingPath: string): MessageBatchRequestItem[] {
  const requests = readJsonl(requestPath).map(value => judgeRequestSchema.parse(value));
  const mapping = loadMapping(mappingPath);
  if (mapping.requestsSha256 !== hash(fs.readFileSync(requestPath, 'utf8'))) {
    throw new Error('요청 파일이 대응표를 만든 뒤 변경되었습니다');
  }
  const byId = new Map(mapping.items.map(item => [item.custom_id, item]));
  if (requests.length !== byId.size || new Set(requests.map(r => r.custom_id)).size !== requests.length) {
    throw new Error('요청과 대응표의 custom_id 구성이 다르거나 중복되었습니다');
  }
  for (const request of requests) {
    const entry = byId.get(request.custom_id);
    const prompt = request.params.messages[0]!.content;
    const visibleAliases = [...prompt.matchAll(/<candidate id="([ABC])">/g)].map(match => match[1]);
    if (
      !entry ||
      visibleAliases.join(',') !== aliases.join(',') ||
      prompt.includes('label=') ||
      Object.values(entry.candidates).some(id => prompt.includes(id))
    ) {
      throw new Error(`익명화되지 않았거나 대응표가 없는 요청입니다: ${request.custom_id}`);
    }
  }
  return requests;
}

export interface JudgeCandidateScore {
  readonly candidateId: string;
  readonly rank: number;
  readonly wins: number;
  readonly winRate: number;
  readonly passRate: number;
  readonly politeRate: number;
  readonly noGhostwritingRate: number;
  readonly lensScore: number;
}
export interface JudgeButtonSummary {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly ties: number;
  readonly candidates: readonly JudgeCandidateScore[];
}
export interface JudgeSummary {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly failures: Readonly<Record<string, number>>;
  readonly unexpectedResults: number;
  readonly byButton: Readonly<Record<JudgeButton, JudgeButtonSummary>>;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

const resultEnvelopeSchema = z.object({ custom_id: z.string(), result: z.unknown() });
const resultSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('succeeded'),
    message: z.object({
      stop_reason: z.string().nullable(),
      content: z.array(z.unknown()),
    }),
  }),
  z.object({ type: z.literal('errored') }),
  z.object({ type: z.literal('canceled') }),
  z.object({ type: z.literal('expired') }),
]);
const textBlockSchema = z.object({ type: z.literal('text'), text: z.string() });
const usageSchema = z.object({
  result: z.object({
    message: z.object({
      usage: z.object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
      }),
    }),
  }),
});

type ParsedVerdict = { ok: true; verdict: JudgeVerdict } | { ok: false; reason: string };
function parseResult(value: unknown): ParsedVerdict {
  const result = resultSchema.safeParse(value);
  if (!result.success) return { ok: false, reason: 'invalid_result' };
  if (result.data.type !== 'succeeded') return { ok: false, reason: result.data.type };
  const { message } = result.data;
  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
    return { ok: false, reason: message.stop_reason };
  }
  if (message.stop_reason !== 'end_turn') return { ok: false, reason: 'unexpected_stop_reason' };
  const text = message.content
    .flatMap(block => {
      const parsed = textBlockSchema.safeParse(block);
      return parsed.success ? [parsed.data.text] : [];
    })
    .join('');
  try {
    const parsed: unknown = JSON.parse(text);
    const verdict = judgeVerdictSchema.safeParse(parsed);
    return verdict.success ? { ok: true, verdict: verdict.data } : { ok: false, reason: 'invalid_verdict' };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}

/** 결과 순서와 무관하게 custom_id와 저장된 후보 대응표로 집계한다. */
export function loadJudgeSummary(
  resultsPath: string,
  mappingPath: string,
  requestPath = path.join(path.dirname(mappingPath), 'judge-requests.jsonl'),
): JudgeSummary {
  loadJudgeFiles(requestPath, mappingPath);
  const mapping = loadMapping(mappingPath);
  const byId = new Map<string, unknown[]>();
  const expectedIds = new Set(mapping.items.map(item => item.custom_id));
  let unexpectedResults = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const value of readJsonl(resultsPath)) {
    const envelope = resultEnvelopeSchema.safeParse(value);
    if (!envelope.success || !expectedIds.has(envelope.data.custom_id)) {
      unexpectedResults++;
      continue;
    }
    const id = envelope.data.custom_id;
    const results = byId.get(id) ?? [];
    results.push(envelope.data.result);
    byId.set(id, results);
    const usage = usageSchema.safeParse(value);
    if (usage.success) {
      inputTokens += usage.data.result.message.usage.input_tokens;
      outputTokens += usage.data.result.message.usage.output_tokens;
    }
  }
  const failures: Record<string, number> = {};
  const summaries = JUDGE_BUTTONS.map(button => {
    const items = mapping.items.filter(item => item.button === button);
    const scores = Object.values(mapping.items[0]!.candidates).map(candidateId => ({
      candidateId,
      wins: 0,
      pass: 0,
      polite: 0,
      noGhostwriting: 0,
      lens: 0,
    }));
    let succeeded = 0;
    let ties = 0;
    for (const entry of items) {
      const results = byId.get(entry.custom_id) ?? [];
      const result: ParsedVerdict =
        results.length === 0
          ? { ok: false, reason: 'missing_result' }
          : results.length !== 1
            ? { ok: false, reason: 'duplicate_result' }
            : parseResult(results[0]);
      if (!result.ok) {
        failures[result.reason] = (failures[result.reason] ?? 0) + 1;
        continue;
      }
      succeeded++;
      const verdict = result.verdict;
      if (verdict.winnerCandidateId === 'tie') ties++;
      for (const evaluation of verdict.evaluations) {
        const candidateId = entry.candidates[evaluation.candidateId];
        const score = scores.find(row => row.candidateId === candidateId)!;
        score.wins += Number(verdict.winnerCandidateId === evaluation.candidateId);
        score.pass += Number(evaluation.pass);
        score.polite += Number(evaluation.polite);
        score.noGhostwriting += Number(evaluation.noGhostwriting);
        score.lens += evaluation.lensScore;
      }
    }
    scores.sort((a, b) => b.wins - a.wins || a.candidateId.localeCompare(b.candidateId));
    const summary: JudgeButtonSummary = {
      total: items.length,
      succeeded,
      failed: items.length - succeeded,
      ties,
      candidates: scores.map(score => ({
        candidateId: score.candidateId,
        rank: 1 + scores.filter(other => other.wins > score.wins).length,
        wins: score.wins,
        winRate: succeeded ? score.wins / succeeded : 0,
        passRate: succeeded ? score.pass / succeeded : 0,
        politeRate: succeeded ? score.polite / succeeded : 0,
        noGhostwritingRate: succeeded ? score.noGhostwriting / succeeded : 0,
        lensScore: succeeded ? score.lens / succeeded : 0,
      })),
    };
    return [button, summary] as const;
  });
  const succeeded = summaries.reduce((sum, [, summary]) => sum + summary.succeeded, 0);
  return {
    total: mapping.items.length,
    succeeded,
    failed: mapping.items.length - succeeded,
    failures,
    unexpectedResults,
    byButton: Object.fromEntries(summaries) as Record<JudgeButton, JudgeButtonSummary>,
    usage: { inputTokens, outputTokens },
  };
}

export async function runJudgeBatch(options: {
  readonly client: JudgeBatchClient;
  readonly requestPath?: string;
  readonly resumePath?: string;
  readonly maxWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly onStatus?: (batchId: string, status: string, batchPath: string) => void;
}): Promise<{ completed: boolean; batchPath: string; resultsPath: string; summary?: JudgeSummary }> {
  const now = options.now ?? Date.now;
  const pause = options.sleep ?? sleep;
  const maxWaitMs = z
    .number()
    .positive()
    .finite()
    .parse(options.maxWaitMs ?? 60 * 60_000);
  const deadline = now() + maxWaitMs;
  let state: JudgeBatchState;
  let batchPath: string;
  if (options.resumePath) {
    batchPath = path.resolve(options.resumePath);
    state = batchStateSchema.parse(readJson(batchPath));
    if (!state.batchId)
      throw new Error(
        '배치 ID를 받기 전에 전송이 끊겼습니다. 자동 재전송하지 말고 콘솔에서 전송 여부를 확인하세요',
      );
    if (
      hash(fs.readFileSync(state.requestPath, 'utf8')) !== state.requestsSha256 ||
      hash(fs.readFileSync(state.mappingPath, 'utf8')) !== state.mappingSha256
    ) {
      throw new Error('전송 후 요청 또는 후보 대응표가 변경되었습니다');
    }
    loadJudgeFiles(state.requestPath, state.mappingPath);
  } else {
    if (!options.requestPath) throw new Error('전송할 요청 파일이 필요합니다');
    const requestPath = path.resolve(options.requestPath);
    const dir = path.dirname(requestPath);
    const mappingPath = path.join(dir, 'judge-mapping.json');
    batchPath = path.join(dir, 'judge-batch.json');
    const requests = loadJudgeFiles(requestPath, mappingPath);
    state = {
      batchId: null,
      processingStatus: 'submitting',
      requestPath,
      mappingPath,
      resultsPath: path.join(dir, 'judge-results.jsonl'),
      requestsSha256: hash(fs.readFileSync(requestPath, 'utf8')),
      mappingSha256: hash(fs.readFileSync(mappingPath, 'utf8')),
      createdAt: new Date().toISOString(),
    };
    // POST 전에 독점 기록을 남겨 전송 중 중단·동시 실행 때 비용이 중복 발생하지 않게 한다.
    fs.writeFileSync(batchPath, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    const created = batchMetaSchema.parse(await options.client.create({ requests }));
    state = { ...state, batchId: created.id, processingStatus: created.processing_status };
    saveState(batchPath, state);
  }
  const batchId = state.batchId;
  if (!batchId) throw new Error('저장된 배치 ID가 없습니다');
  for (;;) {
    const batch = batchMetaSchema.parse(await options.client.retrieve(batchId));
    if (batch.id !== batchId) throw new Error('조회한 배치 ID가 저장 기록과 다릅니다');
    state = { ...state, processingStatus: batch.processing_status };
    saveState(batchPath, state);
    options.onStatus?.(batchId, batch.processing_status, batchPath);
    if (batch.processing_status === 'ended') break;
    const remaining = deadline - now();
    if (remaining <= 0) return { completed: false, batchPath, resultsPath: state.resultsPath };
    await pause(Math.min(30_000, remaining));
    if (now() >= deadline) return { completed: false, batchPath, resultsPath: state.resultsPath };
  }
  // 끊긴 스트림은 완성 파일로 취급하지 않는다. 재개할 때 원격 결과 전체를 다시 받는다.
  const partialPath = `${state.resultsPath}.partial`;
  const fd = fs.openSync(partialPath, 'w');
  try {
    for await (const result of await options.client.results(batchId)) {
      fs.writeSync(fd, JSON.stringify(result) + '\n');
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(partialPath, state.resultsPath);
  const summary = loadJudgeSummary(state.resultsPath, state.mappingPath, state.requestPath);
  return { completed: true, batchPath, resultsPath: state.resultsPath, summary };
}

export async function runJudgeCli(
  argv: readonly string[],
  deps: {
    readonly apiKey: string;
    readonly createClient?: (apiKey: string) => JudgeBatchClient;
    readonly log?: (message: string) => void;
  },
): Promise<number> {
  const log = deps.log ?? console.log;
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (['--submit', '--yes-i-approved-cost'].includes(arg)) flags.add(arg);
    else if (['--input', '--output', '--requests', '--resume', '--max-wait-minutes'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 값이 필요합니다`);
      values.set(arg, value);
    } else throw new Error(`알 수 없는 인자입니다: ${arg}`);
  }
  const maxMinutes = Number(values.get('--max-wait-minutes') ?? 60);
  if (!Number.isFinite(maxMinutes) || maxMinutes <= 0)
    throw new Error('--max-wait-minutes는 0보다 큰 수여야 합니다');
  const resumePath = values.get('--resume');
  if (
    resumePath &&
    (flags.has('--submit') || values.has('--input') || values.has('--requests') || values.has('--output'))
  ) {
    throw new Error('--resume은 --submit·--input·--requests·--output과 함께 쓸 수 없습니다');
  }
  if (values.has('--requests') && (values.has('--input') || values.has('--output'))) {
    throw new Error('--requests는 --input·--output과 함께 쓸 수 없습니다');
  }
  const network = flags.has('--submit') || Boolean(resumePath);
  if (network && (!deps.apiKey.trim() || !flags.has('--yes-i-approved-cost'))) {
    log(
      '[judge] 전송·재개에는 ANTHROPIC_API_KEY와 --yes-i-approved-cost가 모두 필요합니다. API를 호출하지 않았습니다.',
    );
    return 1;
  }
  const dateStr = dayKey(Date.now(), defaultConfig.TIMEZONE);
  const inputPath = path.resolve(
    values.get('--input') ?? path.join(REPO_ROOT, '.local/eval', dateStr, 'raw.jsonl'),
  );
  const requestPath = path.resolve(
    values.get('--requests') ??
      values.get('--output') ??
      path.join(path.dirname(inputPath), 'judge-requests.jsonl'),
  );
  if (!resumePath) {
    const batchPath = path.join(path.dirname(requestPath), 'judge-batch.json');
    if (fs.existsSync(batchPath))
      throw new Error(`기존 배치 기록이 있습니다. --resume ${batchPath}로 이어 받으세요`);
    if (
      !network ||
      !fs.existsSync(requestPath) ||
      !fs.existsSync(path.join(path.dirname(requestPath), 'judge-mapping.json'))
    ) {
      if (values.has('--requests'))
        throw new Error('요청 파일 또는 judge-mapping.json이 없습니다. --input으로 먼저 생성하세요');
      const result = writeJudgeBatchFile(
        loadRawRecords(inputPath),
        loadDataset(),
        loadCandidatesConfig(),
        requestPath,
      );
      log(
        `[judge] 익명 비교 판정 요청 생성: ${result.itemCount}건 -> ${result.outputPath} (대응표: ${result.mappingPath})`,
      );
    }
  }
  if (!network) return 0;
  const createClient =
    deps.createClient ??
    ((apiKey: string) => {
      // 배치 생성 POST의 자동 재시도는 중복 과금을 부를 수 있어 끈다.
      const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 60_000 });
      return client.messages.batches;
    });
  const result = await runJudgeBatch({
    client: createClient(deps.apiKey.trim()),
    maxWaitMs: maxMinutes * 60_000,
    onStatus: (batchId, status, batchPath) => log(`[judge] 배치 ${batchId}: ${status} (기록: ${batchPath})`),
    ...(resumePath ? { resumePath } : { requestPath }),
  });
  log(`[judge] 배치 기록: ${result.batchPath}`);
  if (!result.completed) {
    log(
      `[judge] 대기 한도에 도달했습니다. 배치는 계속 처리됩니다. --resume ${result.batchPath} --yes-i-approved-cost로 이어 받으세요`,
    );
    return 2;
  }
  log(
    `[judge] 결과 저장: ${result.resultsPath} (성공 ${result.summary!.succeeded} / 실패 ${result.summary!.failed} / 전체 ${result.summary!.total})`,
  );
  log(`[judge] 실패 사유: ${JSON.stringify(result.summary!.failures)}`);
  return result.summary!.failed > 0 || result.summary!.unexpectedResults > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runJudgeCli(process.argv.slice(2), {
      apiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
    });
  } catch (error) {
    console.error(`[judge] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
