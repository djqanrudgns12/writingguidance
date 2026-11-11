import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AiButton } from '@geulbang/core';
import { z } from 'zod';
import { providerSchema } from '../../apps/server/src/ai/schemas.ts';
import {
  buildAiInput,
  loadCandidatesConfig,
  loadDataset,
  type CandidatesConfig,
  type EvalDoc,
} from './estimate.ts';
import { loadRawRecords, type EvalRawRecord } from './metrics.ts';

/**
 * 비교 판정 요청 묶음 생성기(`tools/eval/judge.ts`, PLAN §8.7, PRD 6.2·6.3·6.7).
 * - 글벗 한마디(`FEEDBACK`)·다음 방향(`DIRECTION`)·다듬은 글(`POLISH`)을 세 후보(`haiku-off`, `haiku-low`, `sonnet-low`)
 *   한꺼번에 비교 판정하는 Anthropic Message Batches 형식 JSONL(24편 × 3버튼 = 72건)을 **만들기만** 한다.
 * - 네트워크 전송은 하지 않는다(`--submit`은 `ANTHROPIC_API_KEY`와 `--yes-i-approved-cost`가 모두 있을 때만 허용).
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

export const candidateEvaluationSchema = z.object({
  candidateId: z.string(),
  pass: z.boolean(),
  polite: z.boolean(),
  noGhostwriting: z.boolean(),
  lensScore: z.number().int(),
  issues: z.array(z.string()),
});

export const judgeVerdictSchema = z.object({
  evaluations: z.array(candidateEvaluationSchema),
  winnerCandidateId: z.string(),
  summary: z.string(),
});

export type JudgeVerdict = z.output<typeof judgeVerdictSchema>;

export interface MessageBatchRequestItem {
  readonly custom_id: string;
  readonly params: {
    readonly model: string;
    readonly max_tokens: number;
    readonly thinking: { readonly type: 'adaptive' } | { readonly type: 'disabled' };
    readonly output_config: {
      readonly effort?: 'low' | 'medium' | 'high';
      readonly format: {
        readonly type: 'json_schema';
        readonly schema: Record<string, unknown>;
      };
    };
    readonly system: string;
    readonly messages: readonly [{ readonly role: 'user'; readonly content: string }];
  };
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
  config: CandidatesConfig,
): string {
  const input = buildAiInput(doc, button);
  const lensText =
    button === 'FEEDBACK'
      ? input.lens.feedback
      : button === 'DIRECTION'
        ? input.lens.direction
        : input.lens.polish;

  const candidateBlocks = config.candidates.map(cand => {
    const rec = byCandidate.get(cand.id);
    const body = formatCandidateOutput(rec, button);
    return [`  <candidate id="${cand.id}" label="${cand.label}">`, body, '  </candidate>'].join('\n');
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
): MessageBatchRequestItem[] {
  const sys = buildJudgeSystemPrompt();
  const schema = providerSchema(judgeVerdictSchema);
  const items: MessageBatchRequestItem[] = [];

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

      const effort = config.judge.effort;
      items.push({
        custom_id: `${doc.id}__${button}`,
        params: {
          model: config.judge.model,
          max_tokens: 1200,
          thinking: effort === 'off' ? { type: 'disabled' } : { type: 'adaptive' },
          output_config: {
            ...(effort !== 'off' ? { effort } : {}),
            format: {
              type: 'json_schema',
              schema,
            },
          },
          system: sys,
          messages: [
            {
              role: 'user',
              content: buildJudgeUserPrompt(doc, button, byCandidate, config),
            },
          ],
        },
      });
    }
  }

  return items;
}

export function writeJudgeBatchFile(
  records: readonly EvalRawRecord[],
  docs: readonly EvalDoc[],
  config: CandidatesConfig,
  outputPath: string,
): { readonly itemCount: number; readonly outputPath: string } {
  const items = buildJudgeBatchItems(records, docs, config);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const jsonl = items.map(item => JSON.stringify(item)).join('\n') + '\n';
  fs.writeFileSync(outputPath, jsonl, 'utf8');
  return { itemCount: items.length, outputPath };
}

function findArg(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const inputPath = findArg(argv, '--input');
  if (!inputPath) {
    console.error(
      '사용법: node --conditions=@geulbang/source tools/eval/judge.ts --input <.local/eval/YYYY-MM-DD/raw.jsonl> [--output <judge-requests.jsonl>]',
    );
    process.exit(1);
  }
  const resolvedInput = path.resolve(inputPath);
  const defaultOut = path.join(path.dirname(resolvedInput), 'judge-requests.jsonl');
  const outputPath = path.resolve(findArg(argv, '--output') ?? defaultOut);

  const config = loadCandidatesConfig();
  const docs = loadDataset();
  const records = loadRawRecords(resolvedInput);
  const result = writeJudgeBatchFile(records, docs, config, outputPath);
  console.log(
    `[judge] 비교 판정 Message Batches 요청 묶음 생성 완료: ${result.itemCount}건 -> ${result.outputPath}`,
  );

  if (argv.includes('--submit')) {
    const hasKey = Boolean(process.env['ANTHROPIC_API_KEY']?.trim());
    const approved = argv.includes('--yes-i-approved-cost');
    if (!hasKey || !approved) {
      console.log(
        '[judge] --submit은 ANTHROPIC_API_KEY 환경 변수와 --yes-i-approved-cost 승인 표식이 모두 있을 때만 실행할 수 있습니다. (요청 파일만 생성하고 종료합니다)',
      );
      process.exit(0);
    }
    console.log(
      '[judge] P4-19에서는 판정 묶음 파일 생성까지만 수행하며 외부 전송은 P4-20(U-11 승인 후)에서 진행합니다.',
    );
  }
}
