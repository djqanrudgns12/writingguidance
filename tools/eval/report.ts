import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isCautionDoc,
  loadCandidatesConfig,
  loadDataset,
  REPO_ROOT,
  type CandidatesConfig,
  type EvalDoc,
} from './estimate.ts';
import { JUDGE_RUBRIC } from './judge.ts';
import {
  computeMetrics,
  loadRawRecords,
  PRD_PASS_TARGETS,
  type CandidateMetrics,
  type EvalRawRecord,
} from './metrics.ts';

/**
 * AI 평가 보고서 생성기(`tools/eval/report.ts`, PLAN §8.7, PRD 6.7).
 * - 진짜 제공사(`anthropic`) 결과일 때만 `docs/eval/YYYYMMDD.md`에 기록한다.
 * - 가짜 제공사(`fake`) 결과로 만든 보고서는 `.local/eval/<날짜>/report.md` 및 `.local/eval/YYYYMMDD.md`에만 둔다.
 */
const passMark = (ok: boolean) => (ok ? 'PASS' : 'FAIL');

export function generateReportMarkdown(options: {
  readonly dateStr: string;
  readonly metrics: readonly CandidateMetrics[];
  readonly docs: readonly EvalDoc[];
  readonly config: CandidatesConfig;
  readonly rawRelPath: string;
  readonly judgeBatchRelPath?: string;
}): string {
  const { dateStr, metrics, docs, config, rawRelPath, judgeBatchRelPath } = options;
  const provider = metrics[0]?.provider ?? 'fake';
  const repeatCount = metrics[0]?.repeatCount ?? 1;
  const totalPlantedPerPass = docs.reduce((s, d) => s + d.plantedErrors.length, 0);
  const totalMustNotPerPass = docs.reduce((s, d) => s + d.mustNotFlag.length, 0);
  const cautionCount = docs.filter(isCautionDoc).length;

  const lines: string[] = [
    `# AI 모델·프롬프트 품질 평가 보고서 (${dateStr})`,
    '',
    provider === 'fake'
      ? '> **[시험 실행 안내]** 이 보고서는 가짜 AI(`--provider fake`, 비용 $0)로 평가 파이프라인을 검증한 결과이므로 `.local/eval/`에만 저장되었습니다. 실제 모델 선택(U-01)은 U-11 비용 승인 뒤 `--provider anthropic` 결과로 진행합니다.'
      : '> PRD 6.7 및 PLAN §8.7에 따른 가상 초등 글 24편 실측 평가 보고서입니다.',
    '',
    '## 1. 실행 개요',
    '',
    `- **실행 날짜**: \`${dateStr}\``,
    `- **제공사(어댑터)**: \`${provider}\``,
    `- **평가 데이터셋**: 총 ${docs.length}편 (이야기·시·노래 가사·기사·생활글·기타 문구 각 4편, 주의 주제 ${cautionCount}편)`,
    `- **1회전 기준 정답 수**: 심은 오류(\`plantedErrors\`) ${totalPlantedPerPass}개, 고치면 안 되는 표현(\`mustNotFlag\`) ${totalMustNotPerPass}개`,
    `- **후보 수 / 반복 횟수**: 후보 ${config.candidates.length}개 × 버튼 4개 × ${repeatCount}회 반복`,
    `- **원시 기록**: \`${rawRelPath}\``,
    ...(judgeBatchRelPath ? [`- **비교 판정 요청 묶음(Message Batches)**: \`${judgeBatchRelPath}\``] : []),
    '',
    '## 2. PRD 6.7 통과(PASS) 기준 및 종합 판정',
    '',
    '| 평가 항목 (PRD 6.7) | 통과 기준 | ' +
      metrics.map(m => `${m.label} (\`${m.candidateId}\`)`).join(' | ') +
      ' |',
    '|---|---|' + metrics.map(() => '---:').join('|') + '|',
    `| 맞춤법 정밀도 (Precision) | ≥ ${(PRD_PASS_TARGETS.spellPrecisionMin * 100).toFixed(0)}% | ` +
      metrics
        .map(
          m =>
            `${(m.spell.precision * 100).toFixed(1)}% (${m.spell.truePositives}/${m.spell.totalPredicted}) **${passMark(m.pass.spellPrecision)}**`,
        )
        .join(' | ') +
      ' |',
    `| 맞춤법 재현율 (Recall) | ≥ ${(PRD_PASS_TARGETS.spellRecallMin * 100).toFixed(0)}% | ` +
      metrics
        .map(
          m =>
            `${(m.spell.recall * 100).toFixed(1)}% (${m.spell.recalledPlanted}/${m.spell.totalPlanted}) **${passMark(m.pass.spellRecall)}**`,
        )
        .join(' | ') +
      ' |',
    `| 고치면 안 되는 표현 지적 (\`mustNotFlag\`) | ${PRD_PASS_TARGETS.mustNotFlagMax}건 | ` +
      metrics.map(m => `${m.spell.mustNotFlagHits}건 **${passMark(m.pass.mustNotFlag)}**`).join(' | ') +
      ' |',
    `| 한마디·방향 형식 위반 | ${PRD_PASS_TARGETS.formatViolationsMax}건 | ` +
      metrics
        .map(m => `${m.format.feedbackDirectionViolations}건 **${passMark(m.pass.formatViolations)}**`)
        .join(' | ') +
      ' |',
    `| 다듬은 글 길이 비율 (${PRD_PASS_TARGETS.polishLengthMinRatio}~${PRD_PASS_TARGETS.polishLengthMaxRatio}) | ≥ ${(PRD_PASS_TARGETS.polishInRangeRateMin * 100).toFixed(0)}% | ` +
      metrics
        .map(
          m =>
            `${(m.polish.inRangeRate * 100).toFixed(1)}% (${m.polish.inRangeRuns}/${m.polish.totalRuns}) **${passMark(m.pass.polishLength)}**`,
        )
        .join(' | ') +
      ' |',
    `| 구조 머리말 보존 (\`[1절]\`·\`[1컷]\`·\`[1장]\` 등) | ${(PRD_PASS_TARGETS.headingPreserveRateMin * 100).toFixed(0)}% | ` +
      metrics
        .map(
          m =>
            `${(m.polish.headingPreserveRate * 100).toFixed(1)}% (${m.polish.preservedHeadings}/${m.polish.expectedHeadings}) **${passMark(m.pass.headingPreserve)}**`,
        )
        .join(' | ') +
      ' |',
    `| 주의 주제(전쟁·죽음 4편) 거절률 | ${(PRD_PASS_TARGETS.cautionRefusalRateMax * 100).toFixed(0)}% | ` +
      metrics
        .map(
          m =>
            `${(m.refusal.cautionRefusalRate * 100).toFixed(1)}% (${m.refusal.cautionRefusedCalls}/${m.refusal.cautionCalls}) **${passMark(m.pass.cautionRefusal)}**`,
        )
        .join(' | ') +
      ' |',
    `| **종합 판정** | **전 항목 PASS** | ` +
      metrics.map(m => `**${passMark(m.pass.all)}**`).join(' | ') +
      ' |',
    '',
    '## 3. 후보별 상세 품질 지표',
    '',
    '| 후보 | 모델 (`effort`) | 성공/전체 호출 | 다듬은 글 길이 비율 (평균 / 최소~최대) | 머리말 보존 문서 수 | 전체 거절 (초기 거절 시도) | 주의 주제 거절 (초기 거절 시도) | 형식 재시도 횟수 |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
  ];

  for (const m of metrics) {
    const ratioDesc = `${m.polish.meanRatio.toFixed(2)} (${m.polish.minRatio.toFixed(2)}~${m.polish.maxRatio.toFixed(2)})`;
    const headDocs = `${m.polish.headingDocsPreserved}/${m.polish.headingDocsTotal}편`;
    const allRef = `${m.refusal.refusedCalls}/${m.refusal.totalCalls} (${m.refusal.initialRefusalAttempts}회)`;
    const cautRef = `${m.refusal.cautionRefusedCalls}/${m.refusal.cautionCalls} (${m.refusal.cautionInitialRefusalAttempts}회)`;
    lines.push(
      `| ${m.label} (\`${m.candidateId}\`) | \`${m.model}\` (\`${m.effort}\`) | ${m.okCalls}/${m.totalCalls} | ${ratioDesc} | ${headDocs} | ${allRef} | ${cautRef} | ${m.format.retryAttempts}회 |`,
    );
  }

  lines.push(
    '',
    '## 4. 지연 시간 (p50 / p95, 단위: ms)',
    '',
    '| 후보 | 전체 p50 / p95 | 맞춤법(`SPELL`) | 글벗 한마디(`FEEDBACK`) | 다음 방향(`DIRECTION`) | 다듬은 글(`POLISH`) 첫 글자 | 다듬은 글(`POLISH`) 전체 |',
    '|---|---:|---:|---:|---:|---:|---:|',
  );

  for (const m of metrics) {
    const l = m.latency;
    lines.push(
      `| ${m.label} (\`${m.candidateId}\`) | ${l.overall.p50Ms} / ${l.overall.p95Ms} | ${l.byButton.SPELL.p50Ms} / ${l.byButton.SPELL.p95Ms} | ${l.byButton.FEEDBACK.p50Ms} / ${l.byButton.FEEDBACK.p95Ms} | ${l.byButton.DIRECTION.p50Ms} / ${l.byButton.DIRECTION.p95Ms} | ${l.polishFirstByte.p50Ms} / ${l.polishFirstByte.p95Ms} | ${l.byButton.POLISH.p50Ms} / ${l.byButton.POLISH.p95Ms} |`,
    );
  }

  lines.push(
    '',
    '## 5. 토큰 사용량 및 비용',
    '',
    `- 단가 출처: ${config.source}`,
    '',
    '| 후보 | 입력 토큰 합계 | 출력 토큰 합계 | 1회전(96호출) 비용 ($) | 전체 실행 비용 ($) |',
    '|---|---:|---:|---:|---:|',
  );

  for (const m of metrics) {
    lines.push(
      `| ${m.label} (\`${m.candidateId}\`) | ${m.usage.inputTokens.toLocaleString('en-US')} | ${m.usage.outputTokens.toLocaleString('en-US')} | $${m.usage.costPerPassUsd.toFixed(4)} | $${m.usage.totalCostUsd.toFixed(4)} |`,
    );
  }

  lines.push(
    '',
    '## 6. 비교 판정 기준표 (`tools/eval/judge.ts`)',
    '',
    '| 기준 ID | 대상 버튼 | 항목 | 통과 기준 |',
    '|---|---|---|---|',
  );

  for (const c of JUDGE_RUBRIC) {
    lines.push(`| \`${c.id}\` | \`${c.target}\` | ${c.title} | ${c.passRule} |`);
  }

  return lines.join('\n') + '\n';
}

export function writeEvalReport(options: {
  readonly dateStr: string;
  readonly records: readonly EvalRawRecord[];
  readonly docs: readonly EvalDoc[];
  readonly config: CandidatesConfig;
  readonly rawPath: string;
  readonly judgeBatchPath?: string;
}): { readonly reportPaths: readonly string[]; readonly metrics: readonly CandidateMetrics[] } {
  const { dateStr, records, docs, config, rawPath, judgeBatchPath } = options;
  const metrics = computeMetrics(records, docs, config);
  const provider = metrics[0]?.provider ?? 'fake';
  const yyyymmdd = dateStr.replaceAll('-', '');

  const rawRelPath = path.relative(REPO_ROOT, rawPath).replaceAll('\\', '/');
  const judgeBatchRelPath = judgeBatchPath
    ? path.relative(REPO_ROOT, judgeBatchPath).replaceAll('\\', '/')
    : undefined;

  const markdown = generateReportMarkdown({
    dateStr,
    metrics,
    docs,
    config,
    rawRelPath,
    ...(judgeBatchRelPath ? { judgeBatchRelPath } : {}),
  });

  const localRunReportPath = path.join(path.dirname(rawPath), 'report.md');
  const localDatedReportPath = path.join(REPO_ROOT, '.local/eval', `${yyyymmdd}.md`);
  fs.mkdirSync(path.dirname(localRunReportPath), { recursive: true });
  fs.mkdirSync(path.dirname(localDatedReportPath), { recursive: true });
  fs.writeFileSync(localRunReportPath, markdown, 'utf8');
  fs.writeFileSync(localDatedReportPath, markdown, 'utf8');

  const written: string[] = [localRunReportPath, localDatedReportPath];

  // 진짜 제공사(anthropic) 실행일 때만 docs/eval/YYYYMMDD.md에 기록한다.
  if (provider === 'anthropic') {
    const docsEvalPath = path.join(REPO_ROOT, 'docs/eval', `${yyyymmdd}.md`);
    fs.mkdirSync(path.dirname(docsEvalPath), { recursive: true });
    fs.writeFileSync(docsEvalPath, markdown, 'utf8');
    written.push(docsEvalPath);
  }

  return { reportPaths: written, metrics };
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
      '사용법: node --conditions=@geulbang/source tools/eval/report.ts --input <.local/eval/YYYY-MM-DD/raw.jsonl>',
    );
    process.exit(1);
  }
  const resolvedInput = path.resolve(inputPath);
  const dirName = path.basename(path.dirname(resolvedInput));
  const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(dirName) ? dirName : new Date().toISOString().slice(0, 10);
  const judgeCandidate = path.join(path.dirname(resolvedInput), 'judge-requests.jsonl');

  const config = loadCandidatesConfig();
  const docs = loadDataset();
  const records = loadRawRecords(resolvedInput);
  const out = writeEvalReport({
    dateStr,
    records,
    docs,
    config,
    rawPath: resolvedInput,
    ...(fs.existsSync(judgeCandidate) ? { judgeBatchPath: judgeCandidate } : {}),
  });
  console.log(`[report] 보고서 저장 완료: ${out.reportPaths.join(', ')}`);
}
