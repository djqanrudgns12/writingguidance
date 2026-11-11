import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TOKEN_PATTERN } from '../protocol/auth.ts';
import { applyChange, diffForInput, outerChangedRange } from './diff.ts';
import { codePointBefore, isHangul, isHangulCodePoint } from './hangul.ts';
import { randomTokenBase64Url, sha256Hex } from './hash.ts';

describe('hangul', () => {
  it.each([
    [0xac00, true],
    [0xd7a3, true],
    [0xabff, false],
    [0xd7a4, false],
    [0x1100, true],
    [0x11ff, true],
    [0x10ff, false],
    [0x1200, false],
    [0xa960, true],
    [0xa97f, true],
    [0xd7b0, true],
    [0xd7ff, true],
    [0x3130, true],
    [0x318f, true],
    [0x312f, false],
    [0x3190, false],
  ])('U+%s → %s', (cp, expected) => {
    expect(isHangulCodePoint(cp)).toBe(expected);
  });

  it('문자열 첫 코드 포인트를 본다', () => {
    expect(isHangul('한a')).toBe(true);
    expect(isHangul('ㄱ')).toBe(true);
    expect(isHangul('a한')).toBe(false);
    expect(isHangul('')).toBe(false);
    expect(isHangul('😀')).toBe(false);
  });

  it('커서 앞 코드 포인트(짝 문자는 하나로)', () => {
    expect(codePointBefore('가나', 2)).toBe('나'.codePointAt(0));
    expect(codePointBefore('a😀', 3)).toBe(0x1f600);
    expect(codePointBefore('a😀', 2)).toBe(0xd83d); // 쌍 가운데: 높은 쪽 하나만
    expect(codePointBefore('가', 0)).toBeUndefined();
    expect(codePointBefore('가', 2)).toBeUndefined();
    // 첫가끝: 'ᄒ' + 'ᅡ' + 'ᆫ'
    const jamo = '한';
    expect(isHangulCodePoint(codePointBefore(jamo, 3)!)).toBe(true);
  });
});

describe('diffForInput', () => {
  it.each<[string, string, string, number, { index: number; deleteCount: number; insert: string }]>([
    ['끝에 넣기', '가나', '가나다', 3, { index: 2, deleteCount: 0, insert: '다' }],
    ['앞에 넣기', '나다', '가나다', 1, { index: 0, deleteCount: 0, insert: '가' }],
    ['반복 글자 + 커서 앞', '가가', '가가가', 1, { index: 0, deleteCount: 0, insert: '가' }],
    ['반복 글자 + 커서 끝', '가가', '가가가', 3, { index: 2, deleteCount: 0, insert: '가' }],
    ['조합 바꾸기', '하', '한', 1, { index: 0, deleteCount: 1, insert: '한' }],
    ['한 + ㅏ = 하나', '한', '하나', 2, { index: 0, deleteCount: 1, insert: '하나' }],
    ['가운데 지우기', '가나다', '가다', 1, { index: 1, deleteCount: 1, insert: '' }],
    ['줄바꿈', '가나', '가\n나', 2, { index: 1, deleteCount: 0, insert: '\n' }],
    ['짝 문자 경계', 'a😀', 'a😁', 3, { index: 1, deleteCount: 2, insert: '😁' }],
  ])('%s', (_name, prev, next, caret, expected) => {
    expect(diffForInput(prev, next, caret)).toEqual(expected);
  });

  it('같으면 null', () => {
    expect(diffForInput('가', '가', 1)).toBeNull();
    expect(outerChangedRange('가', '가')).toBeNull();
  });

  const text = fc.string({ unit: fc.constantFrom('가', '나', 'a', ' ', '\n', '😀', 'ᄒ', 'ᅡ') });

  it('성질: 차이를 적용하면 다음 글이 된다(무작위 1,000회)', () => {
    fc.assert(
      fc.property(text, text, fc.nat(), (prev, next, c) => {
        const caret = next.length === 0 ? 0 : c % (next.length + 1);
        const change = diffForInput(prev, next, caret);
        if (prev === next) return change === null;
        return change !== null && applyChange(prev, change) === next;
      }),
      { numRuns: 1000 },
    );
  });

  it('성질: 한 곳 편집이면 바뀐 범위가 커서에서 끝난다', () => {
    fc.assert(
      fc.property(text, fc.nat(), fc.nat(), text, (prev, at, del, ins) => {
        // 실제 입력은 코드 포인트를 반으로 자르지 않는다 → 코드 포인트 단위로 편집한다.
        const points = [...prev];
        const at2 = points.length === 0 ? 0 : at % (points.length + 1);
        const del2 = Math.min(del % 4, points.length - at2);
        const index = points.slice(0, at2).join('').length;
        const next = points.slice(0, at2).join('') + ins + points.slice(at2 + del2).join('');
        const caret = index + ins.length;
        const change = diffForInput(prev, next, caret);
        if (prev === next) return change === null;
        if (!change) return false;
        return applyChange(prev, change) === next && change.index + change.insert.length === caret;
      }),
      { numRuns: 1000 },
    );
  });

  it('성질: 바깥 범위로 가운데를 바꾸면 다음 글이 되고, 경계가 짝 문자를 가르지 않는다', () => {
    const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
    fc.assert(
      fc.property(text, text, (prev, next) => {
        const r = outerChangedRange(prev, next);
        if (prev === next) return r === null;
        if (!r) return false;
        const rebuilt = prev.slice(0, r.start) + next.slice(r.start, r.endNew) + prev.slice(r.endOld);
        const cuts = [
          [prev, r.start],
          [next, r.start],
          [prev, r.endOld],
          [next, r.endNew],
        ] as const;
        return rebuilt === next && cuts.every(([s, i]) => !isLow(s.charCodeAt(i)));
      }),
      { numRuns: 1000 },
    );
  });
});

describe('hash', () => {
  it('알려진 SHA-256', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex('가')).toBe(await sha256Hex(new TextEncoder().encode('가')));
  });

  it('토큰은 43자 base64url이고 매번 다르다', () => {
    const a = randomTokenBase64Url();
    const b = randomTokenBase64Url();
    expect(a).toMatch(TOKEN_PATTERN);
    expect(a).not.toBe(b);
  });
});
