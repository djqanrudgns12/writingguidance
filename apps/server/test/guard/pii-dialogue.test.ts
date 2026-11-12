import { describe, expect, it } from 'vitest';
import { dialogueRanges, inside } from '../../src/ai/guard/dialogue.ts';
import { findPiiLike, maskPii, namePii, restorePii } from '../../src/ai/guard/pii.ts';

// 가상 값만 쓴다(실제 번호·주소 아님).
describe('개인정보 가림(docs/ai-harness.md P-01)', () => {
  it('전화번호·이메일·주민번호 꼴·웹 주소를 자리표시자로 바꾸고 되돌린다', () => {
    const text =
      '우리 집 번호는 010-1234-5678이고 메일은 kid@example.com이에요. 711212-3456789. www.example.com 놀러 와.';
    const m = maskPii(text);
    expect(m.text).not.toContain('010-1234-5678');
    expect(m.text).not.toContain('kid@example.com');
    expect(m.text).not.toContain('711212-3456789');
    expect(m.text).not.toContain('www.example.com');
    expect(m.text).toContain('[전화번호1]');
    expect(m.text).toContain('[이메일1]');
    expect(m.text).toContain('[주민번호1]');
    expect(m.text).toContain('[주소1]');
    expect(restorePii(m.text, m.spans)).toBe(text);
  });

  it('같은 번호가 두 번이면 같은 자리표시자', () => {
    const m = maskPii('01012345678 그리고 다시 01012345678');
    expect(m.spans).toHaveLength(1);
    expect(m.text).toBe('[전화번호1] 그리고 다시 [전화번호1]');
  });

  it('보통 숫자·날짜·학년 반은 건드리지 않는다', () => {
    const text = '2026년 11월 13일, 3학년 2반 25명이 100미터를 달렸다. 점수는 95점.';
    expect(maskPii(text).text).toBe(text);
  });

  it('한마디에서는 종류 이름으로 바꾼다', () => {
    const m = maskPii('전화 010 1234 5678');
    expect(
      namePii('[전화번호1]은 빼 볼까요?', m.spans, {
        phone: '전화번호',
        email: '이메일',
        rrn: '주민등록번호',
        url: '인터넷 주소',
      }),
    ).toBe('전화번호은 빼 볼까요?');
  });

  it('출력에 새로 생긴 개인정보 꼴을 찾는다(G-02)', () => {
    expect(findPiiLike('연락은 02-123-4567로 해요.')).toBe('phone');
    expect(findPiiLike('정말 멋진 생각이에요.')).toBeNull();
  });
});

describe('대사 범위(docs/ai-harness.md 5절)', () => {
  it('따옴표 안과 웹툰 대사 줄을 대사로 본다', () => {
    const text =
      '솔이가 말했다. "진짜루 찾았어!"\n장면: 화단 구석\n떡볶이탐정: 우와아아 열어 보자\n‘이상하다’ 하고 생각했다.';
    const r = dialogueRanges(text);
    const at = (s: string) => text.indexOf(s);
    expect(inside(r, at('진짜루'), at('진짜루') + 3)).toBe(true);
    expect(inside(r, at('우와아아'), at('우와아아') + 4)).toBe(true);
    expect(inside(r, at('이상하다'), at('이상하다') + 4)).toBe(true);
    expect(inside(r, at('화단'), at('화단') + 2)).toBe(false);
    expect(inside(r, at('말했다'), at('말했다') + 3)).toBe(false);
  });

  it('짝이 없는 따옴표는 대사로 보지 않는다', () => {
    const text = '그는 "안녕 이라고 썼다.';
    expect(dialogueRanges(text)).toEqual([]);
  });
});
