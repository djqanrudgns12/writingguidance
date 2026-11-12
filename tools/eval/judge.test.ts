import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadCandidatesConfig, loadDataset } from './estimate.ts';
import {
  buildJudgeBatchItems,
  loadJudgeSummary,
  runJudgeBatch,
  runJudgeCli,
  writeJudgeBatchFile,
  type JudgeBatchClient,
} from './judge.ts';
import { writeEvalReport } from './report.ts';
import type { EvalRawRecord } from './metrics.ts';

// 비교 판정은 후보 3개용이다. 후보 목록이 늘어도(생각 깊이 비교) 처음 세 후보로 시험한다.
const loaded = loadCandidatesConfig();
const JUDGE_IDS = ['haiku-off', 'haiku-low', 'sonnet-low'];
const config = { ...loaded, candidates: loaded.candidates.filter(c => JUDGE_IDS.includes(c.id)) };
const docs = loadDataset().slice(0, 2);

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geulbang-judge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const requestPath = path.join(dir, 'judge-requests.jsonl');
  const written = writeJudgeBatchFile([], docs, config, requestPath, () => 0);
  const requests = fs
    .readFileSync(requestPath, 'utf8')
    .trim()
    .split('\n')
    .map(line => {
      const parsed: unknown = JSON.parse(line);
      return parsed as { custom_id: string; params: { messages: { content: string }[] } };
    });
  return { dir, requestPath, written, requests };
}

function success(custom_id: string, winnerCandidateId = 'A', stop_reason = 'end_turn') {
  const verdict = {
    evaluations: ['C', 'A', 'B'].map(candidateId => ({
      candidateId,
      pass: candidateId === 'A',
      polite: true,
      noGhostwriting: candidateId !== 'C',
      lensScore: candidateId === 'A' ? 5 : 2,
      issues: candidateId === 'A' ? [] : ['관점 보완이 필요해요.'],
    })),
    winnerCandidateId,
    summary: '가상 응답의 구체성을 비교했어요.',
  };
  return {
    custom_id,
    result: {
      type: 'succeeded',
      message: {
        stop_reason,
        content: [
          { type: 'thinking', thinking: '비공개 추론' },
          { type: 'text', text: JSON.stringify(verdict) },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    },
  };
}

test('요청은 무작위 A/B/C만 노출하고 Opus 제약을 지킨다', () => {
  const records: EvalRawRecord[] = docs.flatMap(doc =>
    config.candidates.map((candidate, index) => ({
      docId: doc.id,
      genre: doc.genre,
      caution: false,
      button: 'FEEDBACK',
      candidateId: candidate.id,
      model: candidate.model,
      effort: candidate.effort,
      provider: 'fake',
      repeatIndex: 1,
      ok: true,
      errorCode: null,
      firstByteMs: 1,
      latencyMs: 1,
      usage: [],
      attempts: [],
      feedbackResult: { praise: `가상 응답 ${index + 1}`, improve: ['흐름을 살펴보면 어때요?'] },
    })),
  );
  const first = buildJudgeBatchItems(records, docs, config, () => 0);
  const second = buildJudgeBatchItems(records, docs, config, max => max - 1);
  assert.notDeepEqual(first.mapping, second.mapping);
  for (const request of first.requests) {
    assert.equal(request.params.max_tokens, 4000);
    assert.deepEqual(request.params.thinking, { type: 'adaptive' });
    assert.equal(request.params.output_config.effort, 'low');
    const prompt = request.params.messages[0]?.content ?? '';
    assert.deepEqual(
      [...prompt.matchAll(/<candidate id="([ABC])">/g)].map(m => m[1]),
      ['A', 'B', 'C'],
    );
    for (const candidate of config.candidates) {
      assert.equal(prompt.includes(candidate.id), false);
      assert.equal(prompt.includes(candidate.label), false);
      assert.equal(prompt.includes(candidate.model), false);
    }
    for (const forbidden of ['temperature', 'budget_tokens', 'tool_choice']) {
      assert.equal(JSON.stringify(request.params).includes(`"${forbidden}"`), false);
    }
  }
  const prompt = first.requests[0]!.params.messages[0]!.content;
  assert.match(prompt.match(/<candidate id="A">([\s\S]*?)<\/candidate>/)?.[1] ?? '', /가상 응답 2/);
  assert.match(prompt.match(/<candidate id="B">([\s\S]*?)<\/candidate>/)?.[1] ?? '', /가상 응답 3/);
  assert.match(prompt.match(/<candidate id="C">([\s\S]*?)<\/candidate>/)?.[1] ?? '', /가상 응답 1/);
});

test('create → 30초 폴링 → 순서가 섞인 결과 → 실패 집계와 보고서', async t => {
  const { dir, requestPath, written, requests } = fixture(t);
  const ids = requests.map(request => request.custom_id);
  const events: string[] = [];
  let polls = 0;
  let elapsed = 0;
  const client: JudgeBatchClient = {
    async create({ requests: sent }) {
      events.push('create');
      assert.equal(sent.length, 6);
      return { id: 'batch-test', processing_status: 'in_progress' };
    },
    async retrieve(id) {
      events.push('retrieve');
      assert.equal(id, 'batch-test');
      const saved: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'judge-batch.json'), 'utf8'));
      assert.equal((saved as { batchId: string }).batchId, 'batch-test');
      return { id, processing_status: ++polls === 1 ? 'in_progress' : 'ended' };
    },
    async results() {
      events.push('results');
      return (async function* () {
        yield success(ids[5]!);
        yield { custom_id: ids[1], result: { type: 'errored', error: { type: 'invalid_request_error' } } };
        yield success(ids[4]!, 'A', 'refusal');
        yield success(ids[0]!);
        yield success(ids[3]!, 'tie');
        yield success(ids[2]!);
      })();
    },
  };
  const result = await runJudgeBatch({
    requestPath,
    client,
    now: () => elapsed,
    sleep: async ms => {
      assert.equal(ms, 30_000);
      elapsed += ms;
    },
  });
  assert.deepEqual(events, ['create', 'retrieve', 'retrieve', 'results']);
  assert.equal(result.completed, true);
  assert.deepEqual(result.summary?.failures, { errored: 1, refusal: 1 });
  assert.equal(result.summary?.succeeded, 4);
  const summary = loadJudgeSummary(path.join(dir, 'judge-results.jsonl'), written.mappingPath);
  const feedback = summary.byButton.FEEDBACK;
  assert.equal(feedback.succeeded, 2);
  assert.equal(feedback.ties, 1);
  // 주입한 순서에서 A는 두 번째 후보다. 응답 배열 순서로 짝지으면 이 검사가 실패한다.
  assert.equal(feedback.candidates.find(c => c.candidateId === config.candidates[1]?.id)?.wins, 1);
  const out = writeEvalReport({
    dateStr: '2099-01-01',
    records: [],
    docs,
    config,
    rawPath: path.join(dir, 'raw.jsonl'),
    judgeBatchPath: requestPath,
    localDatedReportPath: path.join(dir, 'dated-report.md'),
  });
  const report = fs.readFileSync(out.reportPaths[0]!, 'utf8');
  assert.match(report, /비교 판정 결과/);
  assert.match(report, /errored: 1, refusal: 1/);
  assert.match(report, /50\.0% \(1\/2\)/);
  assert.match(report, /5\.00/);
  for (const button of ['FEEDBACK', 'DIRECTION', 'POLISH']) assert.ok(report.includes(button));
});

test('대기 종료·재개는 create를 반복하지 않고 대응표와 기존 요청을 보존한다', async t => {
  const { dir, requestPath, written, requests } = fixture(t);
  const before = fs.readFileSync(written.mappingPath, 'utf8');
  let createCount = 0;
  const client: JudgeBatchClient = {
    async create() {
      createCount++;
      return { id: 'batch-resume', processing_status: 'in_progress' };
    },
    async retrieve() {
      return { id: 'batch-resume', processing_status: 'in_progress' };
    },
    async results() {
      throw new Error('미완료 배치의 결과를 받으면 안 된다');
    },
  };
  let elapsed = 0;
  const timedOut = await runJudgeBatch({
    requestPath,
    client,
    maxWaitMs: 10,
    now: () => elapsed,
    sleep: async ms => {
      elapsed += ms;
    },
  });
  assert.equal(timedOut.completed, false);
  assert.equal(fs.existsSync(path.join(dir, 'judge-results.jsonl')), false);
  assert.throws(() => writeJudgeBatchFile([], docs, config, requestPath), /배치/);
  const resumed = await runJudgeBatch({
    resumePath: path.join(dir, 'judge-batch.json'),
    client: {
      ...client,
      async retrieve() {
        return { id: 'batch-resume', processing_status: 'ended' };
      },
      async results() {
        return (async function* () {
          for (const item of requests) yield success(item.custom_id);
        })();
      },
    },
  });
  assert.equal(resumed.completed, true);
  assert.equal(createCount, 1);
  assert.equal(fs.readFileSync(written.mappingPath, 'utf8'), before);
  assert.equal(resumed.summary?.succeeded, 6);
  fs.appendFileSync(requestPath, '\n');
  await assert.rejects(runJudgeBatch({ resumePath: path.join(dir, 'judge-batch.json'), client }), /변경/);
});

test('거절·잘림·잘못된 판정·누락·중복을 성공으로 세지 않는다', t => {
  const { dir, written, requests } = fixture(t);
  const ids = requests.map(r => r.custom_id);
  const invalid = success(ids[2]!);
  invalid.result.message.content = [{ type: 'text', text: '{"evaluations":[]}' }];
  const resultPath = path.join(dir, 'judge-results.jsonl');
  fs.writeFileSync(
    resultPath,
    [
      success(ids[0]!, 'A', 'max_tokens'),
      { custom_id: ids[1], result: { type: 'canceled' } },
      invalid,
      { custom_id: ids[3], result: { type: 'expired' } },
      success(ids[4]!),
      success(ids[4]!),
    ]
      .map(value => JSON.stringify(value))
      .join('\n'),
  );
  const summary = loadJudgeSummary(resultPath, written.mappingPath);
  assert.equal(summary.succeeded, 0);
  assert.deepEqual(summary.failures, {
    max_tokens: 1,
    canceled: 1,
    invalid_verdict: 1,
    expired: 1,
    duplicate_result: 1,
    missing_result: 1,
  });
});

test('키·승인 표식이 없거나 잘못된 옵션이면 클라이언트를 만들지 않는다', async t => {
  const { requestPath } = fixture(t);
  const createClient = () => {
    throw new Error('API 클라이언트를 만들면 안 된다');
  };
  const input = ['--requests', requestPath, '--submit'];
  assert.equal(await runJudgeCli(input, { apiKey: '', createClient, log: () => {} }), 1);
  assert.equal(await runJudgeCli(input, { apiKey: 'test-placeholder', createClient, log: () => {} }), 1);
  await assert.rejects(
    runJudgeCli([...input, '--max-wait-minutes', '0'], { apiKey: '', createClient }),
    /max-wait-minutes/,
  );
});

test('전송 응답을 잃어도 재전송하지 않으며 배치 ID 확인을 요구한다', async t => {
  const { dir, requestPath } = fixture(t);
  let createCount = 0;
  const client: JudgeBatchClient = {
    async create() {
      createCount++;
      throw new Error('가상 연결 중단');
    },
    async retrieve() {
      throw new Error('ID를 모르므로 조회할 수 없다');
    },
    async results() {
      throw new Error('ID를 모르므로 수집할 수 없다');
    },
  };
  await assert.rejects(runJudgeBatch({ requestPath, client }), /가상 연결 중단/);
  await assert.rejects(runJudgeBatch({ requestPath, client }), /EEXIST/);
  await assert.rejects(
    runJudgeBatch({ resumePath: path.join(dir, 'judge-batch.json'), client }),
    /전송 여부/,
  );
  assert.equal(createCount, 1);
});

test('승인된 CLI 전송과 끊긴 결과 스트림 재개가 완성 파일을 보장한다', async t => {
  const { dir, requestPath, requests } = fixture(t);
  let createCount = 0;
  const client: JudgeBatchClient = {
    async create() {
      createCount++;
      return { id: 'batch-stream', processing_status: 'in_progress' };
    },
    async retrieve() {
      return { id: 'batch-stream', processing_status: 'ended' };
    },
    async results() {
      return (async function* () {
        yield success(requests[0]!.custom_id);
        throw new Error('가상 스트림 중단');
      })();
    },
  };
  await assert.rejects(
    runJudgeCli(['--requests', requestPath, '--submit', '--yes-i-approved-cost'], {
      apiKey: 'test-placeholder',
      createClient: () => client,
      log: () => {},
    }),
    /가상 스트림 중단/,
  );
  assert.equal(fs.existsSync(path.join(dir, 'judge-results.jsonl')), false);
  assert.equal(fs.existsSync(path.join(dir, 'judge-results.jsonl.partial')), true);
  const resumed = await runJudgeCli(
    ['--resume', path.join(dir, 'judge-batch.json'), '--yes-i-approved-cost'],
    {
      apiKey: 'test-placeholder',
      log: () => {},
      createClient: () => ({
        ...client,
        async results() {
          return (async function* () {
            for (const request of requests) yield success(request.custom_id);
          })();
        },
      }),
    },
  );
  assert.equal(resumed, 0);
  assert.equal(createCount, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'judge-results.jsonl'), 'utf8').trim().split('\n').length, 6);
});
