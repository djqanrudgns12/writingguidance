import { defaultConfig } from '@geulbang/core/config';
import { describe, expect, it } from 'vitest';
import {
  createStdictDictionary,
  parseStdict,
  type DictionaryPort,
  type DictVerdict,
} from '../../src/ai/dictionary.ts';
import { ruleOf } from '../../src/ai/guard/spellRules.ts';
import { refineSpellWithDictionary, type SpellOutItem } from '../../src/application/aiSafety.ts';

// 2026-11-13 실제 응답과 같은 모양(내용은 줄임)
const body = (word: string, defs: string[]) =>
  JSON.stringify({
    channel: {
      total: 1,
      item: [
        { word, sup_no: 0, sense: defs.map((d, i) => ({ sense_no: i + 1, type: '일반어', definition: d })) },
      ],
    },
  });

describe('표준국어대사전 응답 해석', () => {
  it('뜻풀이가 모두 화살표면 비표준어, 가리키는 말을 꺼낸다', () => {
    expect(parseStdict(body('몇-일', ['→ 며칠.']))).toEqual({ kind: 'nonstandard', to: '며칠' });
  });
  it('보통 뜻풀이면 표준어', () => {
    expect(parseStdict(body('며칠', ['그달의 몇째 되는 날.']))).toEqual({ kind: 'standard' });
  });
  it('빈 본문은 사전에 없음, 오류·깨진 본문은 모름', () => {
    expect(parseStdict('')).toEqual({ kind: 'absent' });
    expect(parseStdict('{"error":{"error_code":"020","message":"Unregistered key"}}')).toEqual({
      kind: 'unknown',
    });
    expect(parseStdict('<html>')).toEqual({ kind: 'unknown' });
  });
});

describe('조회기', () => {
  const config = { ...defaultConfig, DICT_LOOKUPS_PER_DAY: 2, DICT_CACHE_SIZE: 10 };
  it('같은 낱말은 기억해 두고 다시 묻지 않는다, 하루 상한을 넘으면 모름', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls += 1;
      return new Response(body('몇-일', ['→ 며칠.']));
    }) as unknown as typeof globalThis.fetch;
    const dict = createStdictDictionary({ key: '0'.repeat(32), config, fetch });
    const signal = new AbortController().signal;
    expect((await dict.lookup('몇일', signal)).kind).toBe('nonstandard');
    expect((await dict.lookup('몇일', signal)).kind).toBe('nonstandard');
    expect(calls).toBe(1);
    await dict.lookup('웬지', signal);
    expect((await dict.lookup('오랫만', signal)).kind).toBe('unknown');
    expect(calls).toBe(2);
  });
  it('한글 낱말이 아니면 묻지 않는다(글 조각·숫자·영문)', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls += 1;
      return new Response('');
    }) as unknown as typeof globalThis.fetch;
    const dict = createStdictDictionary({ key: '0'.repeat(32), config, fetch });
    const signal = new AbortController().signal;
    expect((await dict.lookup('나는 학교에', signal)).kind).toBe('unknown');
    expect((await dict.lookup('abc', signal)).kind).toBe('unknown');
    expect(calls).toBe(0);
  });
  it('네트워크 오류·시간 초과는 모름(맞춤법 결과는 그대로 나간다)', async () => {
    const fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;
    const errors: string[] = [];
    const dict = createStdictDictionary({ key: '0'.repeat(32), config, fetch, onError: c => errors.push(c) });
    expect((await dict.lookup('몇일', new AbortController().signal)).kind).toBe('unknown');
    expect(errors).toEqual(['TypeError']);
  });
});

describe('사전 보정(U-25)', () => {
  const item = (
    original: string,
    severity: SpellOutItem['severity'],
    kind: SpellOutItem['kind'] = '맞춤법',
    suggestion = original + '?',
  ): SpellOutItem => ({
    original,
    suggestion,
    reason: '고쳐 보면 좋아요.',
    kind,
    context: { before: '', after: '' },
    severity,
    rule: ruleOf('DICT'),
  });
  const fakeDict = (table: Record<string, DictVerdict>): DictionaryPort & { asked: string[] } => {
    const asked: string[] = [];
    return {
      asked,
      lookup: async word => {
        asked.push(word);
        return table[word] ?? { kind: 'absent' };
      },
    };
  };
  const signal = new AbortController().signal;

  it('사전이 비표준어라고 하면 대사 안(그대로)이어도 고쳐요로, 등급 순서로 다시 줄 세운다', async () => {
    const dict = fakeDict({ 오랫만: { kind: 'nonstandard', to: '오랜만' } });
    const out = await refineSpellWithDictionary(
      [item('진짜루', 'suggest'), item('오랫만이야', 'keep', '맞춤법', '오랜만이야')],
      dict,
      12,
      signal,
    );
    expect(out.map(i => [i.original, i.severity])).toEqual([
      ['오랫만이야', 'fix'],
      ['진짜루', 'suggest'],
    ]);
    // 조사·서술격을 떼고 다시 찾았다
    expect(dict.asked).toContain('오랫만');
  });
  it('제안이 사전의 표준어를 담지 않으면 고쳐요로 올리지 않는다(Codex 검토 7)', async () => {
    const dict = fakeDict({ 오랫만: { kind: 'nonstandard', to: '오랜만' } });
    const out = await refineSpellWithDictionary(
      [item('오랫만이야', 'suggest', '맞춤법', '오랫밤이야')],
      dict,
      12,
      signal,
    );
    expect(out[0]?.severity).toBe('suggest');
  });
  it('표준어·사전에 없음·조회 실패는 바꾸지 않는다, 고쳐요·띄어쓰기는 묻지 않는다', async () => {
    const dict = fakeDict({ 가르쳐: { kind: 'standard' }, 문득: { kind: 'unknown' } });
    const items = [
      item('가르쳐', 'suggest'),
      item('문득', 'suggest'),
      item('몇일', 'fix'),
      item('할수', 'suggest', '띄어쓰기'),
    ];
    const out = await refineSpellWithDictionary(items, dict, 12, signal);
    expect(out.map(i => i.severity)).toEqual(['fix', 'suggest', 'suggest', 'suggest']);
    expect(dict.asked).not.toContain('몇일');
    expect(dict.asked).not.toContain('할수');
  });
  it('요청당 조회 상한을 지킨다', async () => {
    const dict = fakeDict({});
    await refineSpellWithDictionary(
      ['가', '나', '다', '라'].map(w => item(`${w}가나`, 'suggest')),
      dict,
      2,
      signal,
    );
    expect(dict.asked.length).toBeLessThanOrEqual(2);
  });
});
