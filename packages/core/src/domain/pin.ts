import { defaultConfig, type Config } from '../config.ts';

/**
 * 선생님 PIN·시작 코드 모양 검사(PRD F-15·F-20, PRD 12.3).
 * PRD F-20은 길이(`PIN_MIN_LENGTH`~`PIN_MAX_LENGTH`, 기본 6~8자리)와 활성 수업방 간 유일성만 요구하며
 * 별도의 쉬운 숫자 패턴 거절 규칙은 두지 않는다.
 */

export type PinLengthConfig = Pick<Config, 'PIN_MIN_LENGTH' | 'PIN_MAX_LENGTH'>;
export type StartCodeLengthConfig = Pick<Config, 'TEACHER_START_CODE_LENGTH'>;

export type PinRejectReason = 'NOT_DIGITS' | 'TOO_SHORT' | 'TOO_LONG' | 'MISMATCH';

export type PinValidation =
  { readonly ok: true; readonly pin: string } | { readonly ok: false; readonly reason: PinRejectReason };

const ASCII_DIGITS_RE = /^\d+$/;

/** 선생님 PIN 한 개가 ASCII 숫자이고 설정 길이 범위 안인지 검사한다. */
export function validatePin(pin: string, config: PinLengthConfig = defaultConfig): PinValidation {
  if (pin.length === 0 || !ASCII_DIGITS_RE.test(pin)) {
    return { ok: false, reason: 'NOT_DIGITS' };
  }
  if (pin.length < config.PIN_MIN_LENGTH) {
    return { ok: false, reason: 'TOO_SHORT' };
  }
  if (pin.length > config.PIN_MAX_LENGTH) {
    return { ok: false, reason: 'TOO_LONG' };
  }
  return { ok: true, pin };
}

/** 수업방 만들기 때 두 번 입력한 PIN의 모양과 일치 여부를 함께 검사한다(PRD F-15). */
export function validatePinPair(
  pin: string,
  confirmPin: string,
  config: PinLengthConfig = defaultConfig,
): PinValidation {
  const first = validatePin(pin, config);
  if (!first.ok) return first;
  if (pin !== confirmPin) {
    return { ok: false, reason: 'MISMATCH' };
  }
  return first;
}

export function isValidPin(pin: string, config: PinLengthConfig = defaultConfig): boolean {
  return validatePin(pin, config).ok;
}

/** 선생님 시작 코드 모양 검사(ASCII 숫자 `TEACHER_START_CODE_LENGTH`자리, PRD F-15). */
export function isValidStartCode(code: string, config: StartCodeLengthConfig = defaultConfig): boolean {
  return code.length === config.TEACHER_START_CODE_LENGTH && ASCII_DIGITS_RE.test(code);
}

/** 수업 준비 화면에서 PIN을 가려서 보여 줄 문자열(PRD F-16). */
export function maskPin(pin: string): string {
  return '•'.repeat(pin.length);
}
