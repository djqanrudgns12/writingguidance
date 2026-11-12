import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { AI_BUTTONS, dayKey, type AiButton } from '@geulbang/core';
import { defaultConfig, type Config } from '@geulbang/core/config';
import { AppError } from '@geulbang/core/errors';
import { createAnthropicAi } from '../../apps/server/src/ai/anthropic.ts';
import { createFakeAi } from '../../apps/server/src/ai/fake.ts';
import type { AiPort, Usage } from '../../apps/server/src/ai/port.ts';
import {
  runPolish,
  runStructured,
  type Attempt,
  type RunDeps,
  type RunLog,
} from '../../apps/server/src/ai/run.ts';
import { LIMITS, type SpellResult } from '../../apps/server/src/ai/schemas.ts';
import { chunkForSpell, mapLimited } from '../../apps/server/src/application/spellChunks.ts';
import {
  buildAiInput,
  estimateEvalCost,
  formatEstimateTable,
  isCautionDoc,
  loadCandidatesConfig,
  loadDataset,
  REPO_ROOT,
  type CandidateDef,
  type CandidatesConfig,
  type EvalDoc,
} from './estimate.ts';
import { writeJudgeBatchFile } from './judge.ts';
import { formatMetricsSummaryTable, type EvalRawRecord } from './metrics.ts';
import { writeEvalReport } from './report.ts';

/**
 * AI 평가 실행기(`tools/eval/run.ts`, PLAN §8.7, PRD 6.7).
 * - 각 글(24편) × 버튼(4개) × 후보(3개) × 반복(기본 3회, `--repeat N`)을 서버 `runStructured`/`runPolish`로 직접 실행한다.
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
  /** 일부 후보만 돌릴 때 후보 ID 목록 */
  readonly only?: readonly string[];
}

export function parseRunArgs(argv: readonly string[], defaultRepeat: number): RunCliOptions {
  let provider: 'fake' | 'anthropic' = 'fake';
  let repeat = defaultRepeat;
  let estimateOnly = false;
  let approvedCost = false;
  let dateStr = dayKey(Date.now(), defaultConfig.TIMEZONE);
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

  return { provider, repeat, estimateOnly, approvedCost, dateStr, ...(only ? { only } : {}) };
}

function configForCandidate(candidate: CandidateDef): Readonly<Config> {
  return {
    ...defaultConfig,
    MODEL_SPELL: candidate.model,
    MODEL_FEEDBACK: candidate.model,
    MODEL_DIRECTION: candidate.model,
    MODEL_POLISH: candidate.model,
    AI_EFFORT_SPELL: candidate.effort,
    AI_EFFORT_FEEDBACK: candidate.effort,
    AI_EFFORT_DIRECTION: candidate.effort,
    AI_EFFORT_POLISH: candidate.effort,
  };
}

async function runSingleEvaluation(options: {
  readonly ai: AiPort;
  readonly doc: EvalDoc;
  readonly button: AiButton;
  readonly candidate: CandidateDef;
  readonly provider: 'fake' | 'anthropic';
  readonly repeatIndex: number;
}): Promise<EvalRawRecord> {
  const { ai, doc, button, candidate, provider, repeatIndex } = options;
  const config = configForCandidate(candidate);
  const input = buildAiInput(doc, button);
  const caution = isCautionDoc(doc);

  const attempts: {
    model: string;
    effort: 'off' | 'low' | 'medium' | 'high';
    outcome: string;
    ms: number;
    formatRetry?: boolean;
    serverFallback?: boolean;
  }[] = [];

  const log: RunLog = {
    attempt(a: Attempt, outcome, ms) {
      attempts.push({
        model: a.model,
        effort: a.effort,
        outcome,
        ms: Math.max(0, Math.round(ms)),
        ...(a.formatRetry ? { formatRetry: true } : {}),
        ...(a.serverFallback ? { serverFallback: true } : {}),
      });
    },
  };

  const controller = new AbortController();
  const runDeps: RunDeps = {
    ai,
    config,
    signal: controller.signal,
    log,
  };

  const startedAt = performance.now();

  if (button === 'POLISH') {
    const usage: Usage[] = [];
    const chunks: string[] = [];
    let firstByteMs: number | null = null;
    let stop: 'end' | 'limit' = 'end';
    let resets = 0;
    let errorCode: string | null = null;

    for await (const line of runPolish(runDeps, { ...input, button: 'POLISH' }, u => usage.push(u))) {
      if (line.t === 'text') {
        if (firstByteMs === null) {
          firstByteMs = Math.max(0, Math.round(performance.now() - startedAt));
        }
        chunks.push(line.d);
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

    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    const ok = errorCode === null;

    return {
      docId: doc.id,
      genre: doc.genre,
      caution,
      button: 'POLISH',
      candidateId: candidate.id,
      model: candidate.model,
      effort: candidate.effort,
      provider,
      repeatIndex,
      ok,
      errorCode,
      firstByteMs: ok ? (firstByteMs ?? latencyMs) : firstByteMs,
      latencyMs,
      usage,
      attempts,
      ...(ok ? { polishResult: { text: chunks.join(''), stop, resets } } : {}),
    };
  }

  // SPELL / FEEDBACK / DIRECTION
  try {
    if (button === 'SPELL') {
      const textChunks = chunkForSpell(input.text, config.AI_SPELL_CHUNK_CHARS);
      const siblings = new AbortController();
      const spellDeps: RunDeps = {
        ...runDeps,
        signal: AbortSignal.any([runDeps.signal, siblings.signal]),
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
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const usage: Usage[] = [];
      const items: SpellResult['items'] = [];
      for (const part of parts) {
        usage.push(...part.usage);
        items.push(...part.value.items);
      }
      return {
        docId: doc.id,
        genre: doc.genre,
        caution,
        button: 'SPELL',
        candidateId: candidate.id,
        model: candidate.model,
        effort: candidate.effort,
        provider,
        repeatIndex,
        ok: true,
        errorCode: null,
        firstByteMs: latencyMs,
        latencyMs,
        usage,
        attempts,
        spellResult: { items: items.slice(0, LIMITS.spellItems) },
      };
    }

    if (button === 'FEEDBACK') {
      const reply = await runStructured(runDeps, { ...input, button: 'FEEDBACK' });
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      return {
        docId: doc.id,
        genre: doc.genre,
        caution,
        button: 'FEEDBACK',
        candidateId: candidate.id,
        model: candidate.model,
        effort: candidate.effort,
        provider,
        repeatIndex,
        ok: true,
        errorCode: null,
        firstByteMs: latencyMs,
        latencyMs,
        usage: reply.usage,
        attempts,
        feedbackResult: reply.value,
      };
    }

    const reply = await runStructured(runDeps, { ...input, button: 'DIRECTION' });
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    return {
      docId: doc.id,
      genre: doc.genre,
      caution,
      button: 'DIRECTION',
      candidateId: candidate.id,
      model: candidate.model,
      effort: candidate.effort,
      provider,
      repeatIndex,
      ok: true,
      errorCode: null,
      firstByteMs: latencyMs,
      latencyMs,
      usage: reply.usage,
      attempts,
      directionResult: reply.value,
    };
  } catch (error) {
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    const code = error instanceof AppError ? error.code : 'E_AI_PROVIDER';
    return {
      docId: doc.id,
      genre: doc.genre,
      caution,
      button,
      candidateId: candidate.id,
      model: candidate.model,
      effort: candidate.effort,
      provider,
      repeatIndex,
      ok: false,
      errorCode: code,
      firstByteMs: null,
      latencyMs,
      usage: [],
      attempts,
    };
  }
}

export async function runEvaluation(
  cli: RunCliOptions,
  config: CandidatesConfig = loadCandidatesConfig(),
  docs: readonly EvalDoc[] = loadDataset(),
): Promise<void> {
  if (cli.only) {
    const wanted = new Set(cli.only);
    const unknown = [...wanted].filter(id => !config.candidates.some(c => c.id === id));
    if (unknown.length > 0) throw new Error(`알 수 없는 후보 ID: ${unknown.join(', ')}`);
    config = { ...config, candidates: config.candidates.filter(c => wanted.has(c.id)) };
  }
  const estimate = estimateEvalCost(docs, config, cli.repeat);

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

  const outDir = path.join(REPO_ROOT, '.local/eval', cli.dateStr);
  fs.mkdirSync(outDir, { recursive: true });
  const rawPath = path.join(outDir, 'raw.jsonl');
  const judgePath = path.join(outDir, 'judge-requests.jsonl');

  const records: EvalRawRecord[] = [];
  const totalPlanned = docs.length * AI_BUTTONS.length * config.candidates.length * cli.repeat;
  console.log(
    `[eval] 실행 시작: provider=${cli.provider}, 글=${docs.length}편, 버튼=${AI_BUTTONS.length}개, 후보=${config.candidates.length}개, 반복=${cli.repeat}회 (총 ${totalPlanned}건)`,
  );

  for (let repeatIndex = 1; repeatIndex <= cli.repeat; repeatIndex++) {
    for (const candidate of config.candidates) {
      for (const doc of docs) {
        for (const button of AI_BUTTONS) {
          const rec = await runSingleEvaluation({
            ai,
            doc,
            button,
            candidate,
            provider: cli.provider,
            repeatIndex,
          });
          records.push(rec);
        }
      }
    }
  }

  const rawContent = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(rawPath, rawContent, 'utf8');

  // 비교 판정(A/B/C)은 후보 3개일 때만 만든다. 생각 깊이 비교처럼 후보가 많으면 건너뛴다(비싼 생성이 끝난 뒤 멈추지 않게).
  const judgeRes =
    config.candidates.length === 3 ? writeJudgeBatchFile(records, docs, config, judgePath) : undefined;
  const reportRes = writeEvalReport({
    dateStr: cli.dateStr,
    records,
    docs,
    config,
    rawPath,
    ...(judgeRes ? { judgeBatchPath: judgeRes.outputPath } : {}),
  });

  console.log(`[eval] 원시 결과 저장: ${path.relative(REPO_ROOT, rawPath)} (${records.length}줄)`);
  console.log(
    judgeRes
      ? `[eval] 판정 묶음 저장: ${path.relative(REPO_ROOT, judgeRes.outputPath)} (${judgeRes.itemCount}줄, 전송 안 함)`
      : `[eval] 판정 묶음 건너뜀: 후보 ${config.candidates.length}개(비교 판정은 3개일 때만)`,
  );
  console.log(
    `[eval] 보고서 저장: ${reportRes.reportPaths.map(p => path.relative(REPO_ROOT, p)).join(', ')}`,
  );
  console.log('');
  console.log(formatMetricsSummaryTable(reportRes.metrics));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadCandidatesConfig();
  const docs = loadDataset();
  const cli = parseRunArgs(process.argv.slice(2), config.defaultRepeat);
  await runEvaluation(cli, config, docs);
}
