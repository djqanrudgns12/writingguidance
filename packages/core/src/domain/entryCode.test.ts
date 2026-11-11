import { describe, expect, it } from 'vitest';
import { generateEntryCode, generateUniqueEntryCode, isValidEntryCode } from './entryCode.ts';

describe('entryCode 모양 검사 및 생성', () => {
  it('설정 자리수의 ASCII 숫자만 유효한 입장 코드로 인정한다', () => {
    expect(isValidEntryCode('100000')).toBe(true);
    expect(isValidEntryCode('999999')).toBe(true);
    expect(isValidEntryCode('012345')).toBe(true);

    expect(isValidEntryCode('12345')).toBe(false);
    expect(isValidEntryCode('1234567')).toBe(false);
    expect(isValidEntryCode('12a456')).toBe(false);
    expect(isValidEntryCode('123 56')).toBe(false);
    expect(isValidEntryCode('１２３４５６')).toBe(false);
    expect(isValidEntryCode('1234', { ENTRY_CODE_LENGTH: 4 })).toBe(true);
  });

  it('첫 자리는 1~9, 나머지 자리는 0~9 범위로 생성하여 선행 0이 생기지 않는다', () => {
    expect(generateEntryCode(() => 0)).toBe('100000');
    expect(generateEntryCode(max => max - 1)).toBe('999999');

    const seq = [4, 0, 7, 2, 9, 1];
    let idx = 0;
    expect(generateEntryCode(() => seq[idx++] ?? 0)).toBe('507291');
  });

  it('무작위 원천이 범위를 벗어나거나 코드 길이가 잘못되면 RangeError를 던진다', () => {
    expect(() => generateEntryCode(() => -1)).toThrow(RangeError);
    expect(() => generateEntryCode(max => max)).toThrow(RangeError);
    expect(() => generateEntryCode(() => 1.5)).toThrow(RangeError);
    expect(() => generateEntryCode(() => 0, { ENTRY_CODE_LENGTH: 0 })).toThrow(RangeError);
  });

  it('충돌 시 최대 횟수 안에서 다시 뽑고 모두 겹치면 null을 돌려준다', () => {
    const firstDigits = [0, 0, 1]; // '100000', '100000', '200000'
    let call = 0;
    const rng = (max: number): number => {
      if (max === 9) return firstDigits[call++] ?? 0;
      return 0;
    };

    const picked = generateUniqueEntryCode(rng, code => code === '100000');
    expect(picked).toBe('200000');

    const exhausted = generateUniqueEntryCode(
      () => 0,
      () => true,
    );
    expect(exhausted).toBeNull();
  });
});
