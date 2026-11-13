import { describe, expect, it } from 'vitest';
import { checkGenerated, endsPolitely } from '../../src/ai/guard/outputGuard.ts';
import { cleanDirection } from '../../src/ai/validate.ts';
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
