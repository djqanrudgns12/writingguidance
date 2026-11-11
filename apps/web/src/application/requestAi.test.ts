import 'fake-indexeddb/auto';
import type { ApiOutput, PolishLine } from '@geulbang/core/api';
import { defaultConfig, type Config } from '@geulbang/core/config';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { openLocalDb } from '../adapters/local/idb.ts';
import { createIndexedDbStore } from '../adapters/local/localDocStore.ts';
import type { AiRequestInput, ApiError, SpellResult } from '../ports/api.ts';
import type { StudentRoomMemory } from '../ports/deviceMemory.ts';
import type { AiResultRecordOf, LocalStorePort } from '../ports/localStore.ts';
import { aiChipView } from './aiChip.ts';
import {
  activityFor,
  aiResultNotices,
  createAiRequester,
  locateSpellItems,
  polishLengthWarning,
  prepareAiText,
  stripPolishHeader,
  type AiDeps,
  type AiDocInput,
  type PolishHandlers,
} from './requestAi.ts';

const ROOM = '00000000-0000-4000-8000-000000000001';
const DOC = '20000000-0000-4000-8000-000000000001';
const TOKEN = 'device-token-of-student';
const NOW = Date.UTC(2026, 10, 11, 3, 0, 0);

const entry: StudentRoomMemory = {
  roomId: ROOM,
  entryCode: '482911',
  className: '4학년 2반',
  title: '가을 글쓰기',
  nickname: '하늘고래',
  participantId: '10000000-0000-4000-8000-000000000001',
  deviceToken: TOKEN,
  lastDocId: DOC,
  lastUsedAt: NOW,
  expiresAt: NOW + 30 * 86_400_000,
};

/** 버튼마다 맞는 모양의 기본 응답 */
const SAMPLE_RESULTS: Record<AiRequestInput['button'], unknown> = {
  SPELL: { items: [] },
  FEEDBACK: { praise: 'p', improve: ['i'] },
  DIRECTION: { ideas: [{ text: 'a' }, { text: 'b' }] },
  POLISH: null,
};

interface Call {
  readonly roomId: string;
  readonly token: string;
  readonly input: AiRequestInput;
  readonly signal?: AbortSignal;
}

/** 가짜 REST: 구조화 응답은 `reply`, 다듬은 글은 `lines`(멈출 자리 `hold`에서 끊길 때까지 기다림). */
function fakeApi() {
  const calls: Call[] = [];
  const state = {
    reply: (input: AiRequestInput): Promise<ApiOutput<'aiStructuredResult'>> =>
      Promise.resolve({
        button: input.button,
        result: SAMPLE_RESULTS[input.button],
        receivedAt: 1,
        textHash: 'x',
      }),
    lines: [] as (PolishLine | 'hold' | Error)[],
  };
  const api: AiDeps['api'] = {
    aiStructured: async (roomId, token, input) => {
      calls.push({ roomId, token, input });
      return state.reply(input);
    },
    aiPolish: (roomId, token, input, signal) => ({
      async *[Symbol.asyncIterator]() {
        calls.push({ roomId, token, input, signal });
        for (const line of state.lines) {
          if (line === 'hold') {
            await new Promise((_, reject) =>
              signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
            );
          } else if (line instanceof Error) {
            throw line;
          } else {
            yield line;
          }
        }
      },
    }),
  };
  return { api, calls, state };
}

let db: IDBDatabase;
let store: LocalStorePort;
let clock: { t: number };
let fake: ReturnType<typeof fakeApi>;
let deps: AiDeps;

const makeDeps = (
  config: Readonly<Config> = defaultConfig,
  memory: AiDeps['memory'] | null = null,
): AiDeps => {
  let n = 0;
  return {
    config,
    api: fake.api,
    now: () => clock.t,
    newId: () => `30000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    sha256Hex: async input => `hash:${input}`,
    localStore: store,
    memory: memory ?? { student: async roomId => (roomId === ROOM ? entry : null) },
  };
};

beforeEach(async () => {
  db = await openLocalDb(new IDBFactory());
  store = createIndexedDbStore(db);
  clock = { t: NOW };
  fake = fakeApi();
  deps = makeDeps();
});

const story = (body: string, patch: Partial<AiDocInput> = {}): AiDocInput => ({
  roomId: ROOM,
  docId: DOC,
  genre: { genre: 'story', subtype: 'short' },
  body,
  helpNotes: [],
  ...patch,
});

const BODY = '어제 운동장에서 친구들과 공놀이를 했다. 정말 재미있었다.';

const chipFor = (
  requester: ReturnType<typeof createAiRequester>,
  button: 'FEEDBACK',
  record: { textHash: string } | null,
  currentTextHash: string,
) =>
  aiChipView(
    {
      button,
      enabledButtons: ['SPELL', 'FEEDBACK', 'DIRECTION', 'POLISH'],
      connection: 'online',
      genre: { genre: 'story' },
      chars: 30,
      now: clock.t,
      record,
      currentTextHash,
      ...activityFor(requester.activity.get(), { roomId: ROOM, docId: DOC }, button),
    },
    defaultConfig,
  );

describe('보내는 글(PRD 6.1·F-26)', () => {
  it('본문·지금 글 종류의 메모만 보내고, 제목·별명은 없다. 학생 토큰은 기기 기억에서', async () => {
    const requester = createAiRequester(deps);
    await requester.structured(
      story(BODY, {
        helpNotes: [
          { questionId: 'story_who', note: '나와 민지' },
          { questionId: 'story_event', note: '   ' },
          { questionId: 'poem_subject', note: '다른 글 종류의 메모' },
        ],
        song: { mood: '신나게', tempo: '빠르게' },
      }),
      'FEEDBACK',
    );
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.roomId).toBe(ROOM);
    expect(call.token).toBe(TOKEN);
    expect(call.input).toEqual({
      docId: DOC,
      button: 'FEEDBACK',
      text: BODY,
      range: 'ALL',
      meta: { helpNotes: [{ questionId: 'story_who', note: '나와 민지' }] },
      commandId: expect.any(String),
    });
    expect(JSON.stringify(call.input)).not.toContain(entry.nickname);
  });

  it('노래 가사만 분위기·빠르기를 보낸다(둘 다 있을 때)', async () => {
    const requester = createAiRequester(deps);
    const lyrics = { genre: { genre: 'lyrics' as const } };
    await requester.structured(
      story(BODY, { ...lyrics, song: { mood: '신나게', tempo: '빠르게' } }),
      'DIRECTION',
    );
    await requester.structured(story(BODY, { ...lyrics, song: { mood: '신나게', tempo: ' ' } }), 'FEEDBACK');
    expect(fake.calls[0]?.input.meta).toEqual({ helpNotes: [], mood: '신나게', tempo: '빠르게' });
    expect(fake.calls[1]?.input.meta).toEqual({ helpNotes: [] });
  });

  it('길면 뒷부분만: 맞춤법은 `AI_SPELL_MAX_CHARS`(범위 ALL), 나머지는 `AI_MAX_INPUT_CHARS`(범위 TAIL)', () => {
    const config = { ...defaultConfig, AI_MAX_INPUT_CHARS: 10, AI_SPELL_MAX_CHARS: 20 };
    const body = '가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허';
    expect(prepareAiText(config, 'FEEDBACK', body)).toEqual({
      text: body.slice(-10),
      range: 'TAIL',
      truncated: true,
    });
    expect(prepareAiText(config, 'SPELL', body)).toEqual({
      text: body.slice(-20),
      range: 'ALL',
      truncated: true,
    });
    expect(prepareAiText(config, 'POLISH', '짧은 글')).toEqual({
      text: '짧은 글',
      range: 'ALL',
      truncated: false,
    });
    // 짝 문자 가운데를 가르지 않는다
    const cut = prepareAiText(config, 'FEEDBACK', `가나다${'\u{1F31F}'}라마바사아자차`);
    expect(cut.text.charCodeAt(0)).not.toBeGreaterThanOrEqual(0xdc00);
    expect(cut.text.length).toBeLessThanOrEqual(10);
  });

  it('잘라 보낸 결과는 "마지막 부분만 볼게요" 안내가 붙는다(맞춤법 제외)', async () => {
    const requester = createAiRequester(makeDeps({ ...defaultConfig, AI_MAX_INPUT_CHARS: 10 }));
    const { record } = await requester.structured(story(BODY), 'FEEDBACK');
    expect(fake.calls[0]?.input).toMatchObject({ text: BODY.slice(-10), range: 'TAIL' });
    expect(record).toMatchObject({ truncated: true, requestText: BODY.slice(-10), textHash: `hash:${BODY}` });
    expect(aiResultNotices(record)).toEqual(['aiLongInputTailNotice']);
  });

  it('기기 기억이 없으면 보내지 않고 E_AUTH', async () => {
    const requester = createAiRequester(makeDeps(defaultConfig, { student: async () => null }));
    await expect(requester.structured(story(BODY), 'FEEDBACK')).rejects.toMatchObject({ code: 'E_AUTH' });
    expect(fake.calls).toHaveLength(0);
  });
});

describe('구조화 결과 저장과 다시 열기(PRD F-08)', () => {
  it('받은 결과를 기기에 남기고, 저장소를 다시 열어도 바로 보인다', async () => {
    const requester = createAiRequester(deps);
    const { record } = await requester.structured(story(BODY), 'FEEDBACK');
    expect(record).toEqual({
      docId: DOC,
      button: 'FEEDBACK',
      result: { praise: 'p', improve: ['i'] },
      textHash: `hash:${BODY}`,
      receivedAt: NOW,
      requestText: BODY,
      truncated: false,
    });

    // 새로고침: 같은 IndexedDB를 새 저장소·새 요청 묶음으로
    const reopened = createAiRequester({ ...deps, localStore: createIndexedDbStore(db) });
    expect(await reopened.lastResult(DOC, 'FEEDBACK')).toEqual(record);
    expect((await reopened.results(DOC)).map(r => r.button)).toEqual(['FEEDBACK']);
    expect(await reopened.lastResult(DOC, 'SPELL')).toBeNull();
  });

  it('글이 그대로면 신선, 바뀌면 "글이 바뀌었어요"', async () => {
    const requester = createAiRequester(deps);
    const { record } = await requester.structured(story(BODY), 'FEEDBACK');
    clock.t += 60_000;
    const same = chipFor(requester, 'FEEDBACK', record, await deps.sha256Hex(BODY));
    expect(same).toMatchObject({ state: 'fresh', result: 'fresh', hintKey: null, canRequest: true });
    const changed = chipFor(requester, 'FEEDBACK', record, await deps.sha256Hex(`${BODY} 더 썼다.`));
    expect(changed).toMatchObject({ state: 'stale', result: 'stale', hintKey: 'aiStaleBadge' });
  });

  it('보낸 뒤 쿨다운이 걸리고 요청 중에는 기다림, 같은 버튼을 다시 눌러도 요청은 하나', async () => {
    let release: (v: ApiOutput<'aiStructuredResult'>) => void = () => {};
    fake.state.reply = () => new Promise(resolve => (release = resolve));
    const requester = createAiRequester(deps);
    const first = requester.structured(story(BODY), 'FEEDBACK');
    const second = requester.structured(story(BODY), 'FEEDBACK');
    expect(second).toBe(first);
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 0));
    expect(chipFor(requester, 'FEEDBACK', null, 'h').state).toBe('pending');
    release({ button: 'FEEDBACK', result: { praise: 'p', improve: ['i'] }, receivedAt: 1, textHash: 'x' });
    const { record } = await first;
    expect(fake.calls).toHaveLength(1);
    clock.t += 3000;
    expect(chipFor(requester, 'FEEDBACK', record, record.textHash)).toMatchObject({
      state: 'cooldown',
      cooldownLeftSec: 7,
    });
    clock.t += 7000;
    expect(chipFor(requester, 'FEEDBACK', record, record.textHash).state).toBe('fresh');
  });

  it('결과 모양이 다르면 E_VERSION이고 저장하지 않는다(쿨다운은 남음: 서버가 예약했으므로)', async () => {
    fake.state.reply = input =>
      Promise.resolve({ button: input.button, result: { wrong: true }, receivedAt: 1, textHash: 'x' });
    const requester = createAiRequester(deps);
    await expect(requester.structured(story(BODY), 'DIRECTION')).rejects.toMatchObject({ code: 'E_VERSION' });
    expect(await requester.lastResult(DOC, 'DIRECTION')).toBeNull();
    expect(
      activityFor(requester.activity.get(), { roomId: ROOM, docId: DOC }, 'DIRECTION').lastRequestAt,
    ).toBe(NOW);
  });

  it('하루 한도를 받으면 칩이 한도로 바뀌고, 서버가 받지 않은 실패는 쿨다운을 되돌린다', async () => {
    const fail = (code: ApiError['code']): ApiError => ({ code, message: '', retryable: false });
    const requester = createAiRequester(deps);

    fake.state.reply = () => Promise.reject(fail('E_AI_LIMIT'));
    await expect(requester.structured(story(BODY), 'FEEDBACK')).rejects.toMatchObject({ code: 'E_AI_LIMIT' });
    const limited = activityFor(requester.activity.get(), { roomId: ROOM, docId: DOC }, 'FEEDBACK');
    expect(limited).toEqual({ lastRequestAt: null, limitHitAt: NOW, pending: false });
    expect(chipFor(requester, 'FEEDBACK', null, 'h')).toMatchObject({
      state: 'limit',
      hintKey: 'aiDailyLimitGuide',
    });

    const fresh = createAiRequester(deps);
    fake.state.reply = () => Promise.reject(fail('E_OFFLINE'));
    await expect(fresh.structured(story(BODY), 'SPELL')).rejects.toMatchObject({ code: 'E_OFFLINE' });
    expect(activityFor(fresh.activity.get(), { roomId: ROOM, docId: DOC }, 'SPELL').lastRequestAt).toBeNull();

    fake.state.reply = () => Promise.reject(fail('E_AI_TIMEOUT'));
    await expect(fresh.structured(story(BODY), 'SPELL')).rejects.toMatchObject({ code: 'E_AI_TIMEOUT' });
    expect(activityFor(fresh.activity.get(), { roomId: ROOM, docId: DOC }, 'SPELL').lastRequestAt).toBe(NOW);
  });
});

describe('맞춤법 위치(PLAN §8.6)', () => {
  const REQUEST = '오늘은 정말 재미있었다 되요. 내일도 되요.';
  const spellResult: SpellResult = {
    items: [
      {
        original: '되요',
        suggestion: '돼요',
        reason: 'r',
        kind: '맞춤법',
        context: { before: '있었다 ', after: '.' },
      },
      {
        original: '되요',
        suggestion: '돼요',
        reason: 'r',
        kind: '맞춤법',
        context: { before: '내일도 ', after: '.' },
      },
      {
        original: '않되',
        suggestion: '안 돼',
        reason: 'r',
        kind: '띄어쓰기',
        context: { before: '', after: '' },
      },
    ],
  };

  it('응답이 올 때 글이 바뀌었어도 지금 글의 자리를 찾는다', async () => {
    fake.state.reply = () =>
      Promise.resolve({ button: 'SPELL', result: spellResult, receivedAt: 1, textHash: 'x' });
    const now = `아침에 일어났다. ${REQUEST}`;
    const requester = createAiRequester(deps);
    const { record, spellItems } = await requester.structured(
      story(REQUEST, { currentBody: () => now }),
      'SPELL',
    );
    expect(record.requestText).toBe(REQUEST);
    const [a, b, c] = spellItems;
    expect(a?.range).toEqual({ start: now.indexOf('있었다 되요') + 4, end: now.indexOf('있었다 되요') + 6 });
    expect(b?.range).toEqual({ start: now.indexOf('내일도 되요') + 4, end: now.indexOf('내일도 되요') + 6 });
    expect(c?.range).toBeNull(); // 글에 없는 표현: 목록에는 보이되 누를 수 없음
  });

  it('저장된 결과로 다시 찾아도 맞고, 고친 항목은 자리를 잃되 남은 항목은 제자리', () => {
    const record: Pick<AiResultRecordOf<'SPELL'>, 'requestText' | 'result'> = {
      requestText: REQUEST,
      result: spellResult,
    };
    const edited = `제목 없음\n${REQUEST.replace('있었다 되요', '있었다 돼요')} 끝.`;
    const [a, b] = locateSpellItems(record, edited);
    expect(a?.range).toBeNull();
    expect(edited.slice(b!.range!.start, b!.range!.end)).toBe('되요');
    expect(b?.range?.start).toBe(edited.indexOf('내일도 되요') + 4);
  });
});

describe('다듬은 글 스트림(PLAN §8.3·§8.6)', () => {
  const text = (d: string): PolishLine => ({ t: 'text', d });

  function collect() {
    const log: string[] = [];
    const seen: {
      texts: string[];
      done: AiResultRecordOf<'POLISH'> | null;
      error: [ApiError, string] | null;
    } = {
      texts: [],
      done: null,
      error: null,
    };
    const handlers: PolishHandlers = {
      onText: t => {
        log.push('text');
        seen.texts.push(t);
      },
      onReset: () => log.push('reset'),
      onDone: r => {
        log.push('done');
        seen.done = r;
      },
      onError: (e, partial) => {
        log.push('error');
        seen.error = [e, partial];
      },
    };
    return { handlers, log, seen };
  }

  const POLISH_BODY = '어제 운동장에서 친구들과 공놀이를 했다 재미있었다';

  it('조각을 이어 보이고, reset이면 지우고, 끝나면 저장한다(머리말은 뗀다)', async () => {
    fake.state.lines = [
      text('다듬은 글:\n'),
      text('엉뚱한 '),
      { t: 'reset' },
      text('어제 운동장에서 '),
      text('친구들과 공놀이를 했다. 정말 재미있었다.'),
      { t: 'done', stop: 'end' },
    ];
    const { handlers, log, seen } = collect();
    const requester = createAiRequester(deps);
    const handle = requester.polish(story(POLISH_BODY), handlers);
    expect(activityFor(requester.activity.get(), { roomId: ROOM, docId: DOC }, 'POLISH').pending).toBe(true);
    await handle.finished;
    expect(log).toEqual(['text', 'text', 'reset', 'text', 'text', 'done']);
    expect(seen.texts).toEqual([
      '',
      '엉뚱한 ',
      '어제 운동장에서 ',
      '어제 운동장에서 친구들과 공놀이를 했다. 정말 재미있었다.',
    ]);
    expect(seen.done?.result).toEqual({
      text: '어제 운동장에서 친구들과 공놀이를 했다. 정말 재미있었다.',
      stop: 'end',
      lengthWarning: false,
    });
    expect(await requester.lastResult(DOC, 'POLISH')).toEqual(seen.done);
    expect(aiResultNotices(seen.done!)).toEqual([]);
    expect(activityFor(requester.activity.get(), { roomId: ROOM, docId: DOC }, 'POLISH')).toMatchObject({
      pending: false,
      lastRequestAt: NOW,
    });
  });

  it('길이 비율이 0.5 미만·1.6 초과면 "많이 달라졌어요", 출력 한도로 잘리면 "일부만 다듬었어요"', async () => {
    const requester = createAiRequester(deps);
    fake.state.lines = [text('짧다.'), { t: 'done', stop: 'end' }];
    const short = collect();
    await requester.polish(story(POLISH_BODY), short.handlers).finished;
    expect(short.seen.done?.result.lengthWarning).toBe(true);
    expect(aiResultNotices(short.seen.done!)).toEqual(['aiPolishDiffWarning']);

    fake.state.lines = [text('어제 운동장'), { t: 'done', stop: 'limit' }];
    const cut = collect();
    await requester.polish(story(POLISH_BODY), cut.handlers).finished;
    expect(aiResultNotices(cut.seen.done!)).toEqual(['aiPolishTruncatedNotice']);

    expect(polishLengthWarning('가'.repeat(10), '가'.repeat(5), 'end')).toBe(false);
    expect(polishLengthWarning('가'.repeat(10), '가'.repeat(4), 'end')).toBe(true);
    expect(polishLengthWarning('가'.repeat(10), '가'.repeat(16), 'end')).toBe(false);
    expect(polishLengthWarning('가'.repeat(10), '가'.repeat(17), 'end')).toBe(true);
    expect(polishLengthWarning('가'.repeat(10), '가'.repeat(17), 'limit')).toBe(true);
    expect(polishLengthWarning('', '가', 'end')).toBe(false);
  });

  it('오류 줄이면 받은 데까지와 그 오류를 알리고, 앞 결과는 지우지 않는다', async () => {
    const requester = createAiRequester(deps);
    fake.state.lines = [text('어제 운동장에서 친구들과 공놀이를 했다.'), { t: 'done', stop: 'end' }];
    await requester.polish(story(POLISH_BODY), collect().handlers).finished;
    const before = await requester.lastResult(DOC, 'POLISH');

    fake.state.lines = [text('어제 '), { t: 'error', code: 'E_AI_REFUSED' }];
    const { handlers, seen, log } = collect();
    await requester.polish(story(POLISH_BODY), handlers).finished;
    expect(log).toEqual(['text', 'error']);
    expect(seen.error?.[0].code).toBe('E_AI_REFUSED');
    expect(seen.error?.[1]).toBe('어제 ');
    expect(await requester.lastResult(DOC, 'POLISH')).toEqual(before);
  });

  it('끝 표시 없이 끊기면 받은 데까지 보이고 "잠깐 뒤에 다시"', async () => {
    fake.state.lines = [text('어제 운동장에서 '), new TypeError('network')];
    const { handlers, seen } = collect();
    await createAiRequester(deps).polish(story(POLISH_BODY), handlers).finished;
    expect(seen.error?.[0].code).toBe('E_AI_PROVIDER');
    expect(seen.error?.[1]).toBe('어제 운동장에서 ');

    fake.state.lines = [text('어제')];
    const quiet = collect();
    await createAiRequester(deps).polish(story(POLISH_BODY), quiet.handlers).finished;
    expect(quiet.seen.error?.[0].code).toBe('E_AI_PROVIDER');
  });

  it('패널을 닫으면 요청을 끊고, 그 뒤로는 아무것도 부르지 않으며 저장하지 않는다', async () => {
    fake.state.lines = [text('어제 '), 'hold', text('운동장에서'), { t: 'done', stop: 'end' }];
    let firstText: () => void = () => {};
    const gotText = new Promise<void>(resolve => (firstText = resolve));
    const { handlers, log } = collect();
    const requester = createAiRequester(deps);
    const handle = requester.polish(story(POLISH_BODY), {
      ...handlers,
      onText: t => {
        handlers.onText(t);
        firstText();
      },
    });
    await gotText;
    handle.abort();
    expect(fake.calls[0]?.signal?.aborted).toBe(true);
    expect(activityFor(requester.activity.get(), { roomId: ROOM, docId: DOC }, 'POLISH').pending).toBe(false);
    await handle.finished;
    expect(log).toEqual(['text']);
    expect(await requester.lastResult(DOC, 'POLISH')).toBeNull();
  });
});

describe('다듬은 글 머리말 떼기(PLAN §8.5)', () => {
  it.each([
    ['다듬은 글:\n어제 나는', '어제 나는'],
    ['**다듬은 글**\n\n어제 나는', '어제 나는'],
    ['다듬은 글: 어제 나는\n오늘도', '어제 나는\n오늘도'],
    ['다듬은 글', ''],
    ['다듬은 글씨가 예뻤다.', '다듬은 글씨가 예뻤다.'],
    ['어제 나는 다듬은 글: 을 봤다', '어제 나는 다듬은 글: 을 봤다'],
    ['다듬', '다듬'],
  ])('%j → %j', (input, output) => {
    expect(stripPolishHeader(input)).toBe(output);
  });
});
