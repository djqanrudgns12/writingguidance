import { describe, expect, it } from 'vitest';
import { lexiconStats, maskStudentProfanity, scanText, type LexHit } from '../../src/ai/guard/lexicon.ts';
import { syllableKey, toBaseView, toSyllableView } from '../../src/ai/guard/normalize.ts';

// 가상 문장만 쓴다. 비속어 예시는 이 파일 안에서만, 회피 수법마다 하나씩 최소한으로.
const hitTexts = (text: string) => scanText(text).map(h => text.slice(h.start, h.end));
const strongest = (hits: LexHit[]) => hits.find(h => h.grade === 'A') ?? hits[0];

describe('정규화', () => {
  it('NFKC만으로는 받침이 첫소리로 남아 자체 조립기가 필요하다(실행 확인)', () => {
    expect('ㅅㅣㅂㅏㄹ'.normalize('NFKC')).toBe('시바ᄅ');
    expect(syllableKey('ㅅㅣㅂㅏㄹ')).toBe('시발');
    expect(syllableKey('ㅂ ㅕ ㅇ')).toBe('ㅂ ㅕ ㅇ');
    expect(syllableKey('벼ㅇ신')).toBe('병신');
  });

  it('보기 칸마다 원문 위치를 기억한다(BMP 밖 글자·보이지 않는 글자)', () => {
    const text = '\u{1F600}가​나';
    const base = toBaseView(text);
    expect(base.text).toBe(' 가나');
    expect([...base.origStart]).toEqual([0, 2, 4]);
    expect([...base.origEnd]).toEqual([2, 3, 5]);
    expect(toSyllableView(base).text).toBe(' 가나');
  });

  it('숫자·로마자는 한글 자모와 맞물릴 때만 닮은 글자로 바꾼다', () => {
    expect(syllableKey('1학년 AI가 좋아요^^')).toBe('1학년 ai가 좋아요^^');
    expect(syllableKey('ㅅ1발')).toBe('시발');
  });
});

describe('회피 수법을 잡는다', () => {
  const cases: [string, string][] = [
    ['초성', '아 ㅅㅂ 진짜'],
    ['자모 분리', 'ㅅㅣㅂㅏㄹ'],
    ['띄어 쓴 자모', 'ㅆ ㅣ ㅂ ㅏ ㄹ'],
    ['기호 끼우기', '시.발'],
    ['숫자 끼우기', '시1발'],
    ['띄어쓰기 끼우기', '이 개 새끼야'],
    ['영타', 'tlqkf'],
    ['닮은 글자', 'ㅆ|발'],
    ['닮은 글자(캐럿)', '^^l발'],
    ['늘임', '시이이발'],
    ['같은 글자 반복', '개새새새끼'],
    ['보이지 않는 글자', '씨​발'],
    ['이체 선택자·결합 부호', '씨️발́'],
    ['전각 로마자', 'ｓｅｘ'],
    ['풀어 쓴 한글(NFD)', '씨발'.normalize('NFD')],
  ];
  it.each(cases)('%s: %s', (_name, text) => {
    const hits = scanText(text);
    expect(hits.length).toBeGreaterThan(0);
    expect(strongest(hits)?.grade).toBe('A');
  });
});

describe('일상어는 잡지 않는다', () => {
  const clean = [
    '시발점에서 다시 출발했다.',
    '시발역 앞에서 만났다.',
    '수박씨발라 먹었다.',
    '개나리와 개구리가 봄에 나온다.',
    '노무사 아저씨가 오셨다.',
    '장난감이 망가지다니 속상했다.',
    '자살 예방 교육을 들었다.',
    '할아버지가 돌아가셔서 슬펐다.',
    '전쟁 이야기에서 많은 사람이 죽었다.',
    '다시 발로 공을 찼다.',
    '몇 시 발표야?',
    '무지개색 크레파스로 칠했다.',
    '그림을 보지 않고 그렸다.',
    '늦게 자지 말고 일찍 자자.',
    '새끼 고양이가 태어났다.',
    '우리 개 새끼가 태어났다.',
    '개 소리가 크게 들렸다.',
    '새 키를 받았다.',
    '그 애 널 좋아해.',
    '엄마를 졸라 장난감을 샀다.',
    '영향을 미친 사람을 조사했다.',
    '혼자 살 방법을 생각했다.',
    '전염병을 막으려고 손을 씻었다.',
    '5개년 계획을 배웠다.',
    '하루 세끼를 먹는다.',
    '하늘이 새까맣게 변했다.',
    '그랜드 캐년에 갔다.',
    '아버지 냄새가 좋다.',
    '불이 꺼져 있었다.',
    '옷이 젖도록 놀았다.',
    'ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅅ ㅇ 자음을 배웠다. ㄱㄴㄷㄹㅁㅂㅅㅇ',
    '2018년에 태어났다.',
    'isexcluded wheel amatorial',
    '시바견이 귀엽다.',
    '성교육 시간에 배웠다.',
    '애벌레가 나비로 완전 변태를 한다.',
  ];
  it.each(clean)('%s', text => {
    expect(hitTexts(text)).toEqual([]);
  });
});

describe('등급과 분류', () => {
  it('위험 신호는 B risk_signal', () => {
    const hits = scanText('요즘 너무 힘들어서 죽고 싶어.');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ grade: 'B', category: 'risk_signal' });
  });

  it('자해 방법은 A selfharm, 위험 제조는 A danger', () => {
    expect(scanText('자살하는 방법')[0]).toMatchObject({ grade: 'A', category: 'selfharm' });
    expect(scanText('폭탄을 만드는 방법')[0]).toMatchObject({ grade: 'A', category: 'danger' });
  });

  it('문맥이 필요한 말은 B', () => {
    expect(scanText('자살')[0]).toMatchObject({ grade: 'B', category: 'selfharm' });
    expect(scanText('새끼')[0]).toMatchObject({ grade: 'B', category: 'profanity' });
  });

  it('더 무거운 일치 안에 든 가벼운 일치는 버린다', () => {
    const hits = scanText('개새끼');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ start: 0, end: 3, grade: 'A' });
  });
});

describe('위치는 원문 UTF-16 기준', () => {
  it('앞에 BMP 밖 글자가 있어도 맞다', () => {
    const text = '\u{1F600} 오늘 tlqkf 진짜';
    const [hit] = scanText(text);
    expect(hit).toBeDefined();
    expect(text.slice(hit?.start, hit?.end)).toBe('tlqkf');
  });

  it('끼운 글자까지 덮는다', () => {
    const text = '그건 시.발 같다';
    const [hit] = scanText(text);
    expect(text.slice(hit?.start, hit?.end)).toBe('시.발');
  });

  it('풀어 쓴 한글은 자모 전체를 덮는다', () => {
    const word = '씨발'.normalize('NFD');
    const text = `가 ${word} 나`;
    const [hit] = scanText(text);
    expect(hit).toMatchObject({ start: 2, end: 2 + word.length });
  });
});

describe('maskStudentProfanity', () => {
  it('A·C 구간만 가리고 대응표로 원문을 되살릴 수 있다', () => {
    const text = '오늘 ㅅㅂ 너무 졸라 힘들어서 죽고 싶어. tlqkf';
    const { masked, spans } = maskStudentProfanity(text);
    expect(spans.map(s => s.token)).toEqual(['⟦가림1⟧', '⟦가림2⟧', '⟦가림3⟧']);
    expect(masked).toBe('오늘 ⟦가림1⟧ 너무 ⟦가림2⟧ 힘들어서 죽고 싶어. ⟦가림3⟧');
    let restored = masked;
    for (const s of spans) restored = restored.replace(s.token, text.slice(s.start, s.end));
    expect(restored).toBe(text);
  });

  it('비속어가 없으면 그대로', () => {
    const text = '새끼 고양이와 놀았다.';
    expect(maskStudentProfanity(text)).toEqual({ masked: text, spans: [] });
  });
});

describe('사전', () => {
  it('출처마다 낱말이 들어 있다', () => {
    const stats = lexiconStats();
    const bySource = new Map<string, number>();
    for (const s of stats) bySource.set(s.source, (bySource.get(s.source) ?? 0) + s.count);
    expect(bySource.get('korcen') ?? 0).toBeGreaterThan(500);
    expect(bySource.get('lisuugi') ?? 0).toBeGreaterThan(1000);
    expect(bySource.get('own') ?? 0).toBeGreaterThan(100);
    expect(stats.some(s => s.category === 'risk_signal' && s.grade === 'B')).toBe(true);
  });

  it('5,000자 글 한 편을 목록 전체로 빨리 훑는다', () => {
    const sentence =
      '푸른내 마을 한가운데에는 오래된 시계탑이 서 있다. 다온이는 매일 방과 후에 시계탑 앞을 지나간다. ';
    const text = sentence.repeat(Math.ceil(5000 / sentence.length)).slice(0, 4980) + ' 시 발 tlqkf';
    expect(text.length).toBe(4990);
    for (let i = 0; i < 5; i++) scanText(text);
    const runs = 20;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) scanText(text);
    const avg = (performance.now() - t0) / runs;
    console.info(`[lexicon] 5000자 평균 ${avg.toFixed(2)}ms`);
    expect(scanText(text)).toHaveLength(2);
    // 목표는 5ms 안팎. 시험 기계 부하를 감안해 여유를 둔다.
    expect(avg).toBeLessThan(15);
  });
});
