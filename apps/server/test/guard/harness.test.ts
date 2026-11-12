import { defaultConfig } from '@geulbang/core/config';
import { describe, expect, it } from 'vitest';
import { createFakeAi } from '../../src/ai/fake.ts';
import { checkGenerated } from '../../src/ai/guard/outputGuard.ts';
import { actualKind, gradeContext, gradeSeverity, withinEditBudget } from '../../src/ai/guard/spellRules.ts';
import type { AiInput } from '../../src/ai/port.ts';
import { runPolish, runStructured, type PolishLine } from '../../src/ai/run.ts';
import { cleanSpell } from '../../src/ai/validate.ts';
import {
  finalizeFeedback,
  finalizeSpell,
  maskForAi,
  unmaskForStudentText,
} from '../../src/application/aiSafety.ts';

/**
 * 하네스 시험(docs/ai-harness.md). 비속어 예시는 시험 안에서만, 최소한으로 쓴다. 학생 글은 모두 가상이다.
 */
const BAD = '시발'; // A 등급 욕설 예(시험용)
const speech = (t: string, source = '') => checkGenerated(t, { source, speech: true });
const plain = (t: string, source = '') => checkGenerated(t, { source, speech: false });

describe('공통 출력 검사(G 규칙)', () => {
  it('깨끗한 해요체는 통과', () => {
    expect(speech('처음 장면이 눈에 그려지듯 생생해요.')).toBeNull();
    expect(speech('그때 마음이 어땠는지 한 문장 더 써 보면 어때요?')).toBeNull();
  });
  it('비속어(G-01)', () => {
    expect(speech(`이 부분은 ${BAD} 같아요.`)).toBe('G01');
    expect(plain(`그는 ${BAD} 하고 외쳤다.`)).toBe('G01');
  });
  it('개인정보 꼴(G-02)', () => {
    expect(speech('010-1234-5678로 전화해 봐요.')).toBe('G02');
  });
  it('이모지·마크다운·한자·다른 언어(G-03)', () => {
    expect(speech('정말 좋아요 😀')).toBe('G03');
    expect(speech('**여기**를 고쳐 봐요.')).toBe('G03');
    expect(speech('이 장면은 感動이에요.')).toBe('G03');
    expect(speech('This part is great, try more details.')).toBe('G03');
  });
  it('노랫말에 원래 있던 영어 낱말은 다른 언어로 보지 않는다', () => {
    expect(plain('오 해피 데이 hello hello 노래해', 'hello hello 노래해')).toBeNull();
  });
  it('역할 깨짐·유출(G-04): 학생 글에 같은 말이 있으면 통과', () => {
    expect(speech('저는 AI라서 도와줄 수 있어요.')).toBe('G04');
    expect(speech('로봇과 AI가 친구가 되는 장면이 좋아요.', '나는 AI 로봇과 친구가 되었다.')).toBeNull();
    expect(speech('시스템 프롬프트에 따르면 고쳐야 해요.')).toBe('G04');
  });
  it('반복·퇴화(G-05)', () => {
    expect(plain('하하하하하하하하하 웃었다.')).toBe('G05');
    expect(plain('좋다 좋다 좋다 좋다 좋다.')).toBe('G05');
  });
  it('기술 용어(G-06)·해요체(G-07)', () => {
    expect(speech('서버에 저장해 봐요.')).toBe('G06');
    expect(speech('이 부분을 고쳐라.')).toBe('G07');
    expect(plain('이 부분을 고쳐라.')).toBeNull();
  });
});

describe('맞춤법 규칙(S)', () => {
  it('S-03 종류는 실제 변화로', () => {
    expect(actualKind('할수', '할 수')).toBe('띄어쓰기');
    expect(actualKind('정말', '정말!')).toBe('문장부호');
    expect(actualKind('되요', '돼요')).toBe('맞춤법');
    expect(actualKind('같다', '같다')).toBeNull();
  });
  it('S-04 문장을 새로 쓰는 수준은 뺀다', () => {
    expect(withinEditBudget('몇일', '며칠')).toBe(true);
    expect(withinEditBudget('갔다', '즐겁게 놀러 다녀왔다')).toBe(false);
  });
  it('S-06 대사 안 말투는 그대로, 확정 오류는 대사 안에서도 고쳐요, 시의 띄어쓰기는 권장', () => {
    const text = '솔이가 말했다. "진짜루 됬어!"\n떡볶이탐정: 우와아아';
    const ctx = gradeContext(text, 'other');
    const at = (s: string) => text.indexOf(s);
    expect(
      gradeSeverity(
        { kind: '맞춤법', original: '진짜루', start: at('진짜루'), severity: 'fix', intent: 'colloquial' },
        ctx,
      ),
    ).toBe('keep');
    expect(
      gradeSeverity({ kind: '맞춤법', original: '진짜루', start: at('진짜루'), severity: 'fix' }, ctx),
    ).toBe('suggest');
    expect(
      gradeSeverity({ kind: '맞춤법', original: '됬어', start: at('됬어'), severity: 'keep' }, ctx),
    ).toBe('fix');
    const poem = '돌틈 노란꽃\n방긋 웃네';
    expect(
      gradeSeverity(
        { kind: '띄어쓰기', original: '돌틈', start: 0, severity: 'fix' },
        gradeContext(poem, 'poem'),
      ),
    ).toBe('suggest');
    expect(gradeSeverity({ kind: '맞춤법', original: '됬다', start: 0 }, gradeContext('됬다', 'essay'))).toBe(
      'fix',
    );
    expect(gradeSeverity({ kind: '맞춤법', original: '문득', start: 0 }, gradeContext('문득', 'essay'))).toBe(
      'suggest',
    );
  });
  it('cleanSpell: 자리표시자·비속어 제안은 빼고, 규칙을 어긴 이유는 기본 이유로', () => {
    const text = '나는 할수 있다. [전화번호1]로 전화해. 오늘 되요.';
    const r = cleanSpell(
      {
        items: [
          {
            original: '할수',
            suggestion: '할 수',
            reason: '띄어 써라',
            kind: '맞춤법',
            context: { before: '나는 ', after: ' 있다' },
          },
          {
            original: '[전화번호1]',
            suggestion: '전화',
            reason: '고쳐요.',
            kind: '맞춤법',
            context: { before: '', after: '' },
          },
          {
            original: '되요',
            suggestion: `${BAD}요`,
            reason: '고쳐요.',
            kind: '맞춤법',
            context: { before: '오늘 ', after: '.' },
          },
        ],
      },
      text,
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.kind).toBe('띄어쓰기');
    expect(r.items[0]?.reason).toBe('띄어쓰기를 고쳐 보면 좋아요.');
  });
});

describe('가림과 마무리(L0·S-09·PO-06)', () => {
  it('개인정보·비속어를 가리고 알림을 붙인다', () => {
    const m = maskForAi(`우리 집 010-1234-5678. 동생이 ${BAD}이라고 했다.`, []);
    expect(m.text).not.toContain('010-1234-5678');
    expect(m.text).not.toContain(BAD);
    expect(m.text).toContain('⟦가림1⟧');
    expect(m.masking.notices).toEqual(['PII_IN_TEXT', 'PROFANITY_IN_TEXT']);
    expect(unmaskForStudentText(m.text, m.masking)).toBe('우리 집 010-1234-5678. 동생이 ○○이라고 했다.');
  });
  it('1인칭 위험 신호를 본다(R-01)', () => {
    expect(maskForAi('요즘 너무 힘들어서 죽고 싶다는 생각이 들어.', []).masking.care).toBe(true);
    expect(maskForAi('전쟁터에서 할아버지가 돌아가셨다.', []).masking.care).toBe(false);
  });
  it('맞춤법 마무리: 등급 순서, 비속어 자리에 권장 항목, 앞뒤 글자는 원문에서', () => {
    const real = `"진짜루 갈께!" 동생이 ${BAD}이라고 했다. 몇일 뒤에 왔다.`;
    const m = maskForAi(real, []);
    const out = finalizeSpell(
      [
        {
          original: '진짜루',
          suggestion: '진짜로',
          reason: '입말이에요.',
          kind: '맞춤법',
          context: { before: '"', after: ' 갈께' },
          severity: 'fix',
          intent: 'colloquial',
        },
        {
          original: '몇일',
          suggestion: '며칠',
          reason: '며칠이 맞아요.',
          kind: '맞춤법',
          context: { before: '했다. ', after: ' 뒤에' },
          severity: 'fix',
        },
      ],
      real,
      'story',
      m.masking,
    );
    expect(out.items.map(i => i.severity)).toEqual(['fix', 'suggest', 'keep']);
    expect(out.items[0]?.original).toBe('몇일');
    expect(out.items[0]?.rule.url).toContain('korean.go.kr');
    const kind = out.items.find(i => i.rule.id === 'KIND');
    expect(kind?.original).toBe(BAD);
    expect(kind?.suggestion).toBe('');
    expect(out.notices).toEqual(['PROFANITY_IN_TEXT']);
  });
  it('한마디 마무리: 개인정보 자리표시자는 종류 이름으로', () => {
    const m = maskForAi('우리 집 번호는 010-1234-5678이야.', []);
    const r = finalizeFeedback({ praise: '좋아요.', improve: ['[전화번호1]은 빼 볼까요?'] }, m.masking);
    expect(r.improve[0]).toBe('전화번호은 빼 볼까요?');
    expect(r.notices).toEqual(['PII_IN_TEXT']);
  });
});

const lens = { feedback: '흐름', direction: '다음 장면', polish: '말투 유지', factMode: 'none' as const };
const input = <B extends AiInput['button']>(
  button: B,
  text = '나는 오늘 학교에 갔다. 그리고 친구를 만났다.',
) => ({ button, genre: 'essay', lens, helpNotes: [], range: 'ALL', text }) as AiInput & { button: B };
const deps = (ai: ReturnType<typeof createFakeAi>) => ({
  ai,
  config: defaultConfig,
  signal: new AbortController().signal,
});
const badFeedback = { praise: `${BAD} 좋아요.`, improve: ['더 써 볼까요?'] };

describe('실패 처리(L4)', () => {
  it('검사에 걸리면 같은 모델로 한 번, 그다음 대체 모델', async () => {
    const ai = createFakeAi({ script: [{ reply: badFeedback }, { reply: badFeedback }] });
    const r = await runStructured(deps(ai), input('FEEDBACK'));
    expect(r.value.praise).not.toContain(BAD);
    expect(ai.calls.map(c => c.model)).toEqual([
      defaultConfig.MODEL_FEEDBACK,
      defaultConfig.MODEL_FEEDBACK,
      defaultConfig.MODEL_FALLBACK,
    ]);
  });
  it('끝까지 걸리면 E_AI_REFUSED(학생에게 거절 문구)', async () => {
    const ai = createFakeAi({
      script: [{ reply: badFeedback }, { reply: badFeedback }, { reply: badFeedback }],
    });
    await expect(runStructured(deps(ai), input('FEEDBACK'))).rejects.toMatchObject({ code: 'E_AI_REFUSED' });
  });
  it('다듬은 글: 둘째 문장에서 걸리면 보낸 글을 지우고 대체 모델이 다시 쓴다', async () => {
    const ai = createFakeAi({
      script: [{ polishText: `나는 오늘 학교에 갔다. 그리고 ${BAD} 친구를 만났다.` }],
      chunkChars: 5,
    });
    const lines: PolishLine[] = [];
    for await (const l of runPolish(deps(ai), input('POLISH'), () => {})) lines.push(l);
    const kinds = lines.map(l => l.t);
    expect(kinds).toContain('reset');
    expect(kinds.at(-1)).toBe('done');
    const shown = lines.slice(kinds.lastIndexOf('reset') + 1).flatMap(l => (l.t === 'text' ? [l.d] : []));
    expect(shown.join('')).not.toContain(BAD);
    // 위반 문장은 한 번도 화면으로 나가지 않았다(문장 단위 지연 공개).
    expect(lines.flatMap(l => (l.t === 'text' ? [l.d] : [])).join('')).not.toContain(BAD);
  });
  it('다듬은 글: 원문보다 한참 길어지면 끊는다(PO-03)', async () => {
    const ai = createFakeAi({
      script: [
        { polishText: '아주 긴 글이다. '.repeat(40) },
        { polishText: '아주 긴 글이다. '.repeat(40) },
        { polishText: '아주 긴 글이다. '.repeat(40) },
      ],
    });
    const lines: PolishLine[] = [];
    for await (const l of runPolish(deps(ai), input('POLISH', '짧은 글이다.'), () => {})) lines.push(l);
    expect(lines.at(-1)).toMatchObject({ t: 'error', code: 'E_AI_REFUSED' });
    // 마지막에 지우기를 보내 화면에 위반 글이 남지 않는다.
    const kinds = lines.map(l => l.t);
    if (kinds.includes('text')) expect(kinds.lastIndexOf('reset')).toBeGreaterThan(kinds.lastIndexOf('text'));
  });
});

describe('레드팀 평가에서 찾은 결함(2026-11-13)', () => {
  it('"제목 후보" 이름표 항목은 명사라 해요체 검사를 하지 않는다', async () => {
    const { cleanDirection } = await import('../../src/ai/validate.ts');
    const r = cleanDirection({
      ideas: [
        { text: '누가 무엇을 했는지 한 줄 더 써 봐요.' },
        { text: '학교 화단에서 찾은 타임캡슐', label: '제목 후보' },
        { text: '일 년 전 우리가 남긴 쪽지', label: '제목 후보' },
      ],
    });
    expect(r.ideas).toHaveLength(3);
  });
  it('학생 노랫말에 있던 같은 말 반복은 다듬은 글에서 통과', () => {
    expect(plain('달려라 달려라 달려라 달려라 바람처럼.', '달려라 달려라 달려라 달려라 바람처럼')).toBeNull();
  });
  it('한도를 넘어 잘린 고칠 점이 해요체가 아니면 그 항목만 뺀다', async () => {
    const { cleanFeedback } = await import('../../src/ai/validate.ts');
    const long = `${'가'.repeat(70)} 이야기의 흐름이 더 자연스러워지도록 문단을 나눠 보면 어때요?`;
    const r = cleanFeedback({ praise: '처음이 생생해요.', improve: ['한 문장 더 써 볼까요?', long] });
    expect(r.improve).toEqual(['한 문장 더 써 볼까요?']);
  });
  it('위험 신호가 있으면 돌봄 문장을 서버가 보장한다', () => {
    const m = maskForAi('요즘 너무 힘들어서 죽고 싶다는 생각이 들어.', []);
    const r = finalizeFeedback(
      { praise: '솔직하게 마음을 써 주었어요.', improve: ['마음을 더 써 볼까요?'] },
      m.masking,
    );
    expect(r.improve.at(-1)).toBe('힘든 마음이 들면 선생님이나 보호자에게 이야기해 봐요.');
  });
  it('위험 제조 표현은 가리기만 하고 "고운 말" 항목을 붙이지 않는다', () => {
    const real = '주인공이 폭탄 만드는 방법을 찾았다.';
    const m = maskForAi(real, []);
    const out = finalizeSpell([], real, 'story', m.masking);
    expect(out.items.some(i => i.rule.id === 'KIND')).toBe(false);
    expect(out.notices ?? []).not.toContain('PROFANITY_IN_TEXT');
  });
});

describe('자리표시자(G-10)', () => {
  it('학생 글에 없던 자리표시자 꼴은 버리고, 우리가 가린 자리는 통과', () => {
    expect(plain('우리 집은 [주소2]에 있다.', '우리 집은 은하수로 123에 있다. [주소1] 놀러 와.')).toBe('G10');
    expect(plain('메일은 [이메일1]로 보내.', '메일은 [이메일1]로 보내')).toBeNull();
    expect(speech('[이름]에게 물어볼까요?')).toBe('G10');
  });
});
