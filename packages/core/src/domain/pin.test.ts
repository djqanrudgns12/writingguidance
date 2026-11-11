import { describe, expect, it } from 'vitest';
import { isValidPin, isValidStartCode, maskPin, validatePin, validatePinPair } from './pin.ts';

describe('pin 및 선생님 시작 코드 모양 검사', () => {
  it('PIN은 6~8자리 ASCII 숫자만 허용하고 쉬운 숫자 패턴도 거절하지 않는다', () => {
    expect(validatePin('000000')).toEqual({ ok: true, pin: '000000' });
    expect(validatePin('123456')).toEqual({ ok: true, pin: '123456' });
    expect(validatePin('1234567')).toEqual({ ok: true, pin: '1234567' });
    expect(validatePin('12345678')).toEqual({ ok: true, pin: '12345678' });

    expect(validatePin('')).toEqual({ ok: false, reason: 'NOT_DIGITS' });
    expect(validatePin('12345a')).toEqual({ ok: false, reason: 'NOT_DIGITS' });
    expect(validatePin('123 456')).toEqual({ ok: false, reason: 'NOT_DIGITS' });
    expect(validatePin('１２３４５６')).toEqual({ ok: false, reason: 'NOT_DIGITS' });
    expect(validatePin('12345')).toEqual({ ok: false, reason: 'TOO_SHORT' });
    expect(validatePin('123456789')).toEqual({ ok: false, reason: 'TOO_LONG' });

    expect(isValidPin('654321')).toBe(true);
    expect(isValidPin('65432')).toBe(false);
  });

  it('두 번 입력한 PIN은 첫 값 모양을 먼저 보고, 모양이 맞을 때 일치 여부를 검사한다', () => {
    expect(validatePinPair('12345', '12345')).toEqual({ ok: false, reason: 'TOO_SHORT' });
    expect(validatePinPair('123456', '123457')).toEqual({ ok: false, reason: 'MISMATCH' });
    expect(validatePinPair('123456', '123456')).toEqual({ ok: true, pin: '123456' });
  });

  it('선생님 시작 코드는 설정 자리수(기본 8자리) ASCII 숫자만 통과한다', () => {
    expect(isValidStartCode('12345678')).toBe(true);
    expect(isValidStartCode('1234567')).toBe(false);
    expect(isValidStartCode('123456789')).toBe(false);
    expect(isValidStartCode('1234abcd')).toBe(false);
    expect(isValidStartCode('123456', { TEACHER_START_CODE_LENGTH: 6 })).toBe(true);
  });

  it('PIN 가림 문자열은 글자 수만큼 가운뎃점(•)을 만든다', () => {
    expect(maskPin('')).toBe('');
    expect(maskPin('123456')).toBe('••••••');
    expect(maskPin('12345678')).toBe('••••••••');
  });
});
