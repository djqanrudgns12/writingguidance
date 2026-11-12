import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { AI_BUTTONS, countChars, dayKey, type AiButton } from '@geulbang/core';
import { defaultConfig, type Config } from '@geulbang/core/config';
import { AppError } from '@geulbang/core/errors';
import { createAnthropicAi } from '../../apps/server/src/ai/anthropic.ts';
import { createFakeAi } from '../../apps/server/src/ai/fake.ts';
import type { AiInput, AiPort, Usage } from '../../apps/server/src/ai/port.ts';
import {
  runPolish,
  runStructured,
  structuredBudgetMs,
  type Attempt,
  type RunDeps,
  type RunLog,
} from '../../apps/server/src/ai/run.ts';
import { LIMITS, type SpellResult } from '../../apps/server/src/ai/schemas.ts';
import {
  finalizeDirection,
  finalizeFeedback,
  finalizeSpell,
  maskForAi,
  unmaskForStudentText,
} from '../../apps/server/src/application/aiSafety.ts';
import { chunkForSpell, mapLimited } from '../../apps/server/src/application/spellChunks.ts';
import {
  buildAiInput,
  effortFor,
  estimateEvalCost,
  formatEstimateTable,
  isCautionDoc,
  loadCandidatesConfig,
  minCharsFor,
  REPO_ROOT,
  type CandidateDef,
  type CandidatesConfig,
} from './estimate.ts';
import { writeJudgeBatchFile } from './judge.ts';
import { formatMetricsSummaryTable, formatSafetySummaryTable, type EvalRawRecord } from './metrics.ts';
import { EVAL_SETS, loadDocsForSet, type AnyEvalDoc, type EvalSet } from './redteam.ts';
import { writeEvalReport } from './report.ts';
import { redteamRows } from './safety.ts';

/**
 * AI 평가 실행기(`tools/eval/run.ts`, PLAN §8.7, PRD 6.7, docs/ai-harness.md L6).
 * - 각 글 × 버튼(4개) × 후보 × 반복(기본 3회, `--repeat N`)을 **운영과 같은 흐름**으로 돌린다
 *   (`application/aiRequest.ts`): 최소 글자 확인 → `maskForAi`(개인정보·학생 글 속 비속어 가림, 위험 신호면 `care`)
 *   → `runStructured`/`runPolish`(재시도·대체·검사기) → `finalizeSpell`/`finalizeFeedback`/`finalizeDirection`/`unmaskForStudentText`.
 *   기록에는 화면에 나간 결과를 남긴다.
 * - `--set dataset`(기본, 24편) 또는 `--set redteam`(레드팀 묶음, 후보 기본 `prod`).
 * - 기본 제공사는 `fake`(비용 $0).
 * - `--provider anthropic`은 환경 변수 `ANTHROPIC_API_KEY`와 `--yes-i-approved-cost`가 모두 있을 때만 실행하며,
 *   하나라도 없으면 시작 전에 비용 어림표만 출력하고 즉시 종료한다.
 */
export interface RunCliOptions {
  readonly provider: 'fake' | 'anthropic';
  readonly repeat: number;
  readonly estimateOnly: boolean;
  readonly approvedCost: boolean;
  readonly dateStr: string;
  readonly set: EvalSet;
  /** 일부 후보만 돌릴 때 후보 ID 목록 */
  readonly only?: readonly string[];
}

/** 레드팀은 지금 운영 조합만 기본으로 돌린다(`--only`로 바꿀 수 있음). */
export const REDTEAM_DEFAULT_CANDIDATES: readonly string[] = ['prod'];

export function parseRunArgs(argv: readonly string[], defaultRepeat: number): RunCliOptions {
  let provider: 'fake' | 'anthropic' = 'fake';
  let repeat = defaultRepeat;
  let estimateOnly = false;
  let approvedCost = false;
  let dateStr = dayKey(Date.now(), defaultConfig.TIMEZONE);
  let set: EvalSet = 'dataset';
  let only: readonly string[] | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--estimate') {
      estimateOnly = true;
    } else if (arg === '--yes-i-approved-cost') {
      approvedCost = true;
    } else if (arg === '--provider') {
      const next = argv[i + 1];
      if (next === 'fake' || next === 'anthropic') {
        provider = next;
        i += 1;
      } else {
        throw new Error(`알 수 없는 --provider 값입니다: ${String(next)} (fake 또는 anthropic)`);
      }
    } else if (arg === '--repeat') {
      const next = Number(argv[i + 1]);
      if (!Number.isInteger(next) || next <= 0) {
        throw new Error(`--repeat 값은 1 이상의 정수여야 합니다: ${String(argv[i + 1])}`);
      }
      repeat = next;
      i += 1;
    } else if (arg === '--date') {
      const next = argv[i + 1];
      if (!next || !/^\d{4}-\d{2}-\d{2}$/.test(next)) {
        throw new Error(`--date 형식은 YYYY-MM-DD여야 합니다: ${String(next)}`);
      }
      dateStr = next;
      i += 1;
    } else if (arg === '--set') {
      const next = argv[i + 1];
      if (!EVAL_SETS.some(s => s === next)) {
        throw new Error(`알 수 없는 --set 값입니다: ${String(next)} (${EVAL_SETS.join(' 또는 ')})`);
      }
      set = next as EvalSet;
      i += 1;
    } else if (arg === '--only') {
      // 이미 돌린 후보를 다시 돌리지 않으려고 일부 후보만 고른다(쉼표로 구분한 후보 ID).
      const next = argv[i + 1];
      if (!next) throw new Error('--only 뒤에 후보 ID를 쉼표로 이어 주세요');
      only = next
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);
      i += 1;
    }
  }

  if (set === 'redteam' && !only) only = REDTEAM_DEFAULT_CANDIDATES;
  return { provider, repeat, estimateOnly, approvedCost, dateStr, set, ...(only ? { only } : {}) };
}

/** 후보 조합을 운영 설정 꼴로(버튼별 모델·생각 깊이, 대체 모델은 운영 기본값 그대로). */
export function configForCandidate(candidate: CandidateDef): Readonly<Config> {
  return {
    ...defaultConfig,
    MODEL_SPELL: candidate.model,
    MODEL_FEEDBACK: candidate.model,
    MODEL_DIRECTION: candidate.model,
    MODEL_POLISH: candidate.model,
    AI_EFFORT_SPELL: effortFor(candidate, 'SPELL'),
    AI_EFFORT_FEEDBACK: effortFor(candidate, 'FEEDBACK'),
    AI_EFFORT_DIRECTION: effortFor(candidate, 'DIRECTION'),
    AI_EFFORT_POLISH: effortFor(candidate, 'POLISH'),
  };
}

type AttemptRecord = EvalRawRecord['attempts'][number];

/** 알림(`notices`)은 기록 칸(`masking.notices`)에 따로 두고, 결과에서는 뺀다(판정 프롬프트에 섞이지 않게). */
function withoutNotices<T extends { notices?: unknown }>(value: T): Omit<T, 'notices'> {
  const { notices: _notices, ...rest } = value;
  return rest;
}

/** 글 하나·버튼 하나를 운영 흐름으로 실행한다(시험에서도 부른다). */
export async function runSingleEvaluation(options: {
  readonly ai: AiPort;
  readonly doc: AnyEvalDoc;
  readonly button: AiButton;
  readonly candidate: CandidateDef;
  readonly provider: 'fake' | 'anthropic';
  readonly repeatIndex: number;
  readonly set: EvalSet;
}): Promise<EvalRawRecord> {
  const { ai, doc, button, candidate, provider, repeatIndex, set } = options;
  const config = configForCandidate(candidate);
  const base = buildAiInput(doc, button);
  const common = {
    docId: doc.id,
    genre: doc.genre,
    caution: isCautionDoc(doc),
    button,
    candidateId: candidate.id,
    model: candidate.model,
    effort: effortFor(candidate, button),
    provider,
    repeatIndex,
    set,
  } as const;

  // 1. 최소 글자(운영 prepareAiRequest와 같음): 모자라면 AI로 보내지 않는다.
  if (countChars(doc.text) < minCharsFor(doc)) {
    return {
      ...common,
      ok: false,
      errorCode: 'E_INPUT',
      firstByteMs: null,
      latencyMs: 0,
      usage: [],
      attempts: [],
    };
  }

  // 2. 가림(docs/ai-harness.md L0): 개인정보·학생 글 속 비속어 → 자리표시자, 1인칭 위험 신호 → care.
  const realText = base.text;
  const masked = maskForAi(realText, base.helpNotes);
  const masking = masked.masking;
  const input: AiInput = {
    ...base,
    text: masked.text,
    helpNotes: masked.helpNotes,
  };
  const maskingMeta = {
    pii: masking.pii.length,
    words: masking.words.length,
    notices: [...masking.notices],
  };

  const attempts: AttemptRecord[] = [];
  const log: RunLog = {
    attempt(a: Attempt, outcome, ms, detail) {
      attempts.push({
        model: a.model,
        effort: a.effort,
        outcome,
        ms: Math.max(0, Math.round(ms)),
        ...(a.formatRetry ? { formatRetry: true } : {}),
        ...(a.serverFallback ? { serverFallback: true } : {}),
        ...(a.safetyRetry ? { safetyRetry: true } : {}),
        ...(detail ? { detail } : {}),
      });
    },
  };

  const controller = new AbortController();
  const runDeps: RunDeps = { ai, config, signal: controller.signal, log };
  const startedAt = performance.now();
  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));

  // 3~4. 호출(검사기는 runStructured/runPolish 안) → finalize·되돌림
  if (button === 'POLISH') {
    const usage: Usage[] = [];
    const chunks: string[] = [];
    let firstByteMs: number | null = null;
    let stop: 'end' | 'limit' = 'end';
    let resets = 0;
    let errorCode: string | null = null;

    for await (const line of runPolish(runDeps, { ...input, button: 'POLISH' }, u => usage.push(u))) {
      if (line.t === 'text') {
        if (firstByteMs === null) firstByteMs = elapsed();
        // 자리표시자를 되돌린다(개인정보는 학생 자신의 글이라 원래 값, 가린 비속어는 ○○, PO-06).
        chunks.push(unmaskForStudentText(line.d, masking));
      } else if (line.t === 'reset') {
        resets += 1;
        chunks.length = 0;
        firstByteMs = null;
      } else if (line.t === 'done') {
        stop = line.stop;
      } else if (line.t === 'error') {
        errorCode = line.code;
      }
    }

    const latencyMs = elapsed();
    const ok = errorCode === null;
    return {
      ...common,
      ok,
      errorCode,
      firstByteMs: ok ? (firstByteMs ?? latencyMs) : firstByteMs,
      latencyMs,
      usage,
      attempts,
      masking: maskingMeta,
      ...(ok ? { polishResult: { text: chunks.join(''), stop, resets } } : {}),
    };
  }

  const usage: Usage[] = [];
  try {
    if (button === 'SPELL') {
      // 운영처럼 조각 전체가 시간 예산 하나를 나눠 쓰고, 한 조각이 실패하면 나머지를 멈춘다.
      const textChunks = chunkForSpell(input.text, config.AI_SPELL_CHUNK_CHARS);
      const budgetMs = structuredBudgetMs(config);
      const siblings = new AbortController();
      const spellDeps: RunDeps = {
        ...runDeps,
        deadline: Date.now() + budgetMs,
        signal: AbortSignal.any([runDeps.signal, siblings.signal, AbortSignal.timeout(budgetMs)]),
      };
      let parts: Awaited<ReturnType<typeof runStructured<'SPELL'>>>[];
      try {
        parts = await mapLimited(textChunks, config.AI_SPELL_MAX_PARALLEL, chunk =>
          runStructured(spellDeps, { ...input, button: 'SPELL', text: chunk }),
        );
      } catch (err) {
        siblings.abort();
        throw err;
      }
      const items: SpellResult['items'] = [];
      for (const part of parts) {
        usage.push(...part.usage);
        items.push(...part.value.items);
      }
      const final = finalizeSpell(items.slice(0, LIMITS.spellItems), realText, input.genre, masking);
      const latencyMs = elapsed();
      return {
        ...common,
        ok: true,
        errorCode: null,
        firstByteMs: latencyMs,
        latencyMs,
        usage,
        attempts,
        masking: maskingMeta,
        spellResult: { items: final.items },
      };
    }

    if (button === 'FEEDBACK') {
      const reply = await runStructured(runDeps, { ...input, button: 'FEEDBACK' });
      usage.push(...reply.usage);
      const latencyMs = elapsed();
      return {
        ...common,
        ok: true,
        errorCode: null,
        firstByteMs: latencyMs,
        latencyMs,
        usage,
        attempts,
        masking: maskingMeta,
        feedbackResult: withoutNotices(finalizeFeedback(reply.value, masking)),
      };
    }

    const reply = await runStructured(runDeps, { ...input, button: 'DIRECTION' });
    usage.push(...reply.usage);
    const latencyMs = elapsed();
    return {
      ...common,
      ok: true,
      errorCode: null,
      firstByteMs: latencyMs,
      latencyMs,
      usage,
      attempts,
      masking: maskingMeta,
      directionResult: withoutNotices(finalizeDirection(reply.value, masking)),
    };
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'E_AI_PROVIDER';
    return {
      ...common,
      ok: false,
      errorCode: code,
      firstByteMs: null,
      latencyMs: elapsed(),
      usage,
      attempts,
      masking: maskingMeta,
    };
  }
}

/** 묶음별 출력 폴더(레드팀은 같은 날짜의 데이터셋 기록을 덮어쓰지 않게 하위 폴더). */
export function outDirFor(dateStr: string, set: EvalSet): string {
  const base = path.join(REPO_ROOT, '.local/eval', dateStr);
  return set === 'dataset' ? base : path.join(base, set);
}

export async function runEvaluation(
  cli: RunCliOptions,
  config: CandidatesConfig = loadCandidatesConfig(),
  docs: readonly AnyEvalDoc[] = loadDocsForSet(cli.set),
): Promise<void> {
  if (cli.only) {
    const wanted = new Set(cli.only);
    const unknown = [...wanted].filter(id => !config.candidates.some(c => c.id === id));
    if (unknown.length > 0) throw new Error(`알 수 없는 후보 ID: ${unknown.join(', ')}`);
    config = { ...config, candidates: config.candidates.filter(c => wanted.has(c.id)) };
  }
  // 비교 판정(A/B/C)은 기존 데이터셋·후보 3개일 때만 만든다.
  const withJudge = cli.set === 'dataset' && config.candidates.length === 3;
  const estimate = estimateEvalCost(docs, config, cli.repeat, { includeJudge: withJudge });

  if (cli.estimateOnly) {
    console.log(formatEstimateTable(estimate, config.source));
    return;
  }

  let ai: AiPort;
  if (cli.provider === 'anthropic') {
    const apiKey = process.env['ANTHROPIC_API_KEY']?.trim() ?? '';
    if (apiKey.length === 0 || !cli.approvedCost) {
      console.log(formatEstimateTable(estimate, config.source));
      console.log('');
      console.log(
        '[안내] --provider anthropic 실행에는 환경 변수 ANTHROPIC_API_KEY와 --yes-i-approved-cost 표식이 모두 필요합니다(U-11 비용 승인). 비용 어림표만 출력하고 종료합니다.',
      );
      return;
    }
    ai = createAnthropicAi({ apiKey });
  } else {
    ai = createFakeAi();
  }

  const outDir = outDirFor(cli.dateStr, cli.set);
  fs.mkdirSync(outDir, { recursive: true });
  const rawPath = path.join(outDir, 'raw.jsonl');
  const judgePath = path.join(outDir, 'judge-requests.jsonl');

  const records: EvalRawRecord[] = [];
  const totalPlanned = docs.length * AI_BUTTONS.length * config.candidates.length * cli.repeat;
  console.log(
    `[eval] 실행 시작: set=${cli.set}, provider=${cli.provider}, 글=${docs.length}편, 버튼=${AI_BUTTONS.length}개, 후보=${config.candidates.length}개(${config.candidates.map(c => c.id).join(', ')}), 반복=${cli.repeat}회 (총 ${totalPlanned}건)`,
  );

  for (let repeatIndex = 1; repeatIndex <= cli.repeat; repeatIndex++) {
    for (const candidate of config.candidates) {
      for (const doc of docs) {
        for (const button of AI_BUTTONS) {
          records.push(
            await runSingleEvaluation({
              ai,
              doc,
              button,
              candidate,
              provider: cli.provider,
              repeatIndex,
              set: cli.set,
            }),
          );
        }
      }
    }
  }

  const rawContent = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(rawPath, rawContent, 'utf8');

  const judgeRes = withJudge ? writeJudgeBatchFile(records, docs, config, judgePath) : undefined;
  const reportRes = writeEvalReport({
    dateStr: cli.dateStr,
    records,
    docs,
    config,
    rawPath,
    set: cli.set,
    ...(judgeRes ? { judgeBatchPath: judgeRes.outputPath } : {}),
  });

  console.log(`[eval] 원시 결과 저장: ${path.relative(REPO_ROOT, rawPath)} (${records.length}줄)`);
  console.log(
    judgeRes
      ? `[eval] 판정 묶음 저장: ${path.relative(REPO_ROOT, judgeRes.outputPath)} (${judgeRes.itemCount}줄, 전송 안 함)`
      : `[eval] 판정 묶음 건너뜀: set=${cli.set}, 후보 ${config.candidates.length}개(비교 판정은 기존 데이터셋·후보 3개일 때만)`,
  );
  console.log(
    `[eval] 보고서 저장: ${reportRes.reportPaths.map(p => path.relative(REPO_ROOT, p)).join(', ')}`,
  );
  console.log('');
  if (cli.set === 'dataset') {
    console.log(formatMetricsSummaryTable(reportRes.metrics));
    console.log('');
  }
  console.log(formatSafetySummaryTable(reportRes.metrics));
  if (cli.set === 'redteam') {
    for (const m of reportRes.metrics) {
      const rows = redteamRows(
        records.filter(r => r.candidateId === m.candidateId),
        docs,
      );
      console.log('');
      console.log(
        `[레드팀] ${m.candidateId}: 기대 모두 통과 ${rows.filter(r => r.pass).length}/${rows.length}편`,
      );
      console.log('| 글 | 공격 종류 | 결과 | 실패한 기대 |');
      console.log('|---|---|---|---|');
      for (const r of rows) {
        const failed = r.expectations.filter(e => !e.pass).map(e => `${e.key} (${e.detail})`);
        console.log(
          `| ${r.docId} | ${r.attack} | ${r.pass ? 'PASS' : 'FAIL'} | ${failed.join('; ') || '-'} |`,
        );
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadCandidatesConfig();
  const cli = parseRunArgs(process.argv.slice(2), config.defaultRepeat);
  await runEvaluation(cli, config, loadDocsForSet(cli.set));
}
