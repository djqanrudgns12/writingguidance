import { describe, expect, it } from 'vitest';
import { checkGenerated, endsPolitely } from '../../src/ai/guard/outputGuard.ts';
import { cleanDirection } from '../../src/ai/validate.ts';
import type { DictionaryPort } from '../../src/ai/dictionary.ts';
import { ruleOf } from '../../src/ai/guard/spellRules.ts';
import { refineSpellWithDictionary } from '../../src/application/aiSafety.ts';
import { finalizeSpell, maskForAi, unmaskForStudentText } from '../../src/application/aiSafety.ts';

const BAD = '시발'; // A 등급 욕설 예(시험용)

/** 2026-11-13 Codex 독립 검토(커밋 8ad9cab·814dcb1)에서 찾은 결함의 회귀 시험 */
describe('Codex 검토 결함(2026-11-13)', () => {
  it('1: 웹 주소 안의 욕설도 가리고 알리며, 되살린 주소에서는 ○○로 나간다', () => {
    const m = maskForAi(`여기 봐 https://example.com/${BAD} 재밌다.`, []);
    expect(m.text).not.toContain(BAD);
    expect(m.masking.notices).toContain('PROFANITY_IN_TEXT');
    const restored = unmaskForStudentText(m.text, m.masking);
    expect(restored).not.toContain(BAD);
    expect(restored).toContain('https://example.com/○○');
  });

  it('2: 학생이 직접 쓴 자리표시자 꼴은 진짜 번호로 바뀌지 않고, 메모와 본문 토큰이 겹치지 않는다', () => {
    const m = maskForAi('표시는 [전화번호1], 번호는 010-1234-5678.', [
      { question: '어디를 고칠까요?', note: '엄마 번호 010-9999-8888' },
    ]);
    const tokens = m.masking.pii.map(s => s.token);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(m.masking.pii.map(s => s.value)).toEqual(['010-1234-5678', '010-9999-8888']);
    expect(m.helpNotes[0]?.note).toContain('[전화번호2]');
    const back = unmaskForStudentText(m.text, m.masking);
    expect(back).toBe('표시는 ［전화번호1］, 번호는 010-1234-5678.');
  });

  it('3: 맞춤법 이유 속 자리표시자는 종류 이름으로 바꾼다', () => {
    const real = '번호는 010-1234-5678이야. 몇일 뒤에 왔다.';
    const m = maskForAi(real, []);
    const out = finalizeSpell(
      [
        {
          original: '몇일',
          suggestion: '며칠',
          reason: '[전화번호1] 주변을 살펴봐요.',
          kind: '맞춤법',
          context: { before: '. ', after: ' 뒤에' },
          severity: 'fix',
        },
      ],
      real,
      'story',
      m.masking,
    );
    expect(out.items[0]?.reason).not.toContain('[전화번호1]');
    expect(out.items[0]?.reason).not.toContain('010');
  });

  it('4: 문장부호 뒤 공백이 없거나 줄을 바꿔도 앞 문장 반말을 잡는다', () => {
    expect(endsPolitely('이 부분을 고쳐라.다음 장면도 써 봐요.')).toBe(false);
    expect(endsPolitely('이 부분을 고쳐라\n다음 장면도 써 봐요.')).toBe(false);
    // 숫자 속 점·이어진 부호·닫는 따옴표는 나누지 않는다
    expect(endsPolitely('별점은 3.5점이에요!? 정말 좋아요.')).toBe(true);
    expect(endsPolitely('"멈춰." 하고 말한 장면이 좋아요.')).toBe(true);
  });

  it('5: 검증 전 이름표로 말투·기술 용어 검사를 끌 수 없다', () => {
    expect(() =>
      cleanDirection({
        ideas: [
          { text: '누가 무엇을 했는지 한 줄 더 써 봐요.' },
          { text: '장면을 하나 더 넣어 봐요.' },
          { text: '이 부분을 고쳐라.', label: '123후보' },
        ],
      }),
    ).toThrow();
    // 허용된 후보 이름표라도 기술 용어는 본다
    expect(() =>
      cleanDirection({
        ideas: [
          { text: '누가 무엇을 했는지 한 줄 더 써 봐요.' },
          { text: '서버 속 비밀 상자', label: '제목 후보' },
        ],
      }),
    ).toThrow();
  });

  it('6: 원문에 기술 용어가 있어도 학생에게 건네는 말에는 못 쓴다(따옴표 인용만 허용)', () => {
    const source = '게임 서버가 멈춰서 친구랑 놀았다.';
    expect(checkGenerated('서버에 저장해 봐요.', { source, speech: true })).toBe('G06');
    expect(checkGenerated('"게임 서버가 멈춰서" 부분이 생생해요.', { source, speech: true })).toBeNull();
  });
});

/** 같은 날 Codex 재검토(수정본)에서 찾은 가장자리 경우 */
describe('Codex 재검토 결함(2026-11-13)', () => {
  it('1: 겹친 가짜 토큰 ⟦[전화번호1]⟧도 진짜 번호로 바뀌지 않는다', () => {
    const m = maskForAi('표시는 ⟦[전화번호1]⟧, 번호는 010-1234-5678.', []);
    expect(unmaskForStudentText(m.text, m.masking)).toBe('표시는 〔［전화번호1］〕, 번호는 010-1234-5678.');
  });
  it('2: 주소 안의 이메일은 주소 하나로 가리고 그대로 되살린다', () => {
    const real = 'https://example.com/?email=kid@example.com';
    const m = maskForAi(real, []);
    expect(m.masking.pii).toHaveLength(1);
    expect(unmaskForStudentText(m.text, m.masking)).toBe(real);
  });
  it('3: 비속어 가림이 이메일 인식을 깨뜨리지 않고, 이메일 속 욕설은 ○○로 되살린다', () => {
    const m = maskForAi('메일은 kid@sex.example.com 이야.', []); // Codex 재현 입력
    expect(m.text).toBe('메일은 [이메일1] 이야.');
    expect(m.masking.notices).toEqual(['PII_IN_TEXT', 'PROFANITY_IN_TEXT']);
    expect(unmaskForStudentText(m.text, m.masking)).toBe('메일은 kid@○○.example.com 이야.');
  });
  it('4: 원문에 없는 말을 따옴표로 감싸도 기술 용어 예외가 되지 않는다', () => {
    expect(checkGenerated('“서버”에 저장해 봐요.', { source: '오늘 소풍을 다녀왔다.', speech: true })).toBe(
      'G06',
    );
  });
  it('5: 방향 이름표도 기술 용어를 본다', () => {
    const r = cleanDirection({
      ideas: [
        { text: '누가 무엇을 했는지 한 줄 더 써 봐요.' },
        { text: '장면을 하나 더 넣어 봐요.', label: '서버 후보' },
      ],
    });
    expect(r.ideas[1]?.label).toBeUndefined();
  });
  it('6: 숫자로 시작하는 다음 문장·괄호 속 반말을 잡고, 문장 중간 줄바꿈은 막지 않는다', () => {
    expect(endsPolitely('고쳐라.3일 뒤 장면도 써 봐요.')).toBe(false);
    expect(endsPolitely('(이 부분을 고쳐라.) 다음 장면도 써 봐요.')).toBe(false);
    expect(endsPolitely('친구의 마음이\n잘 드러나 있어요.')).toBe(true);
    expect(endsPolitely('첫 줄이 좋아요.\n둘째 줄도 좋아요.')).toBe(true);
  });
  it('7: 사전 표준어로 바꾼 결과와 제안이 같을 때만 고쳐요로 올린다', async () => {
    const dict: DictionaryPort = {
      lookup: async w => (w === '찌게' ? { kind: 'nonstandard', to: '찌개' } : { kind: 'absent' }),
    };
    const base = {
      reason: '고쳐 보면 좋아요.',
      kind: '맞춤법' as const,
      context: { before: '', after: '' },
      severity: 'keep' as const,
      rule: ruleOf('DICT'),
    };
    const signal = new AbortController().signal;
    const wrong = await refineSpellWithDictionary(
      [{ ...base, original: '찌게', suggestion: '찌게찌개' }],
      dict,
      12,
      signal,
    );
    expect(wrong[0]?.severity).toBe('keep');
    const right = await refineSpellWithDictionary(
      [{ ...base, original: '찌게를', suggestion: '찌개를' }],
      dict,
      12,
      signal,
    );
    expect(right[0]?.severity).toBe('fix');
  });
});
