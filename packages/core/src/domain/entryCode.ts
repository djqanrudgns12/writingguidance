import { defaultConfig, type Config } from '../config.ts';

/**
 * 수업방 입장 코드 모양 검사·생성 규칙(PRD F-02, PRD 12.3 `ENTRY_CODE_LENGTH`, ADR-016).
 * 생성 시 첫 자리는 `1~9`로 뽑아 6자리 기준 `100000~999999`(90만 가지)가 되게 한다.
 */

export type EntryCodeConfig = Pick<Config, 'ENTRY_CODE_LENGTH'>;

/** `0` 이상 `maxExclusive` 미만의 정수를 돌려주는 무작위 원천(예: `crypto.randomInt`). */
export type RandomInt = (maxExclusive: number) => number;

const ASCII_DIGITS_RE = /^\d+$/;
const DEFAULT_MAX_COLLISION_ATTEMPTS = 5;

function sampleInt(randomInt: RandomInt, maxExclusive: number): number {
  const value = randomInt(maxExclusive);
  if (!Number.isInteger(value) || value < 0 || value >= maxExclusive) {
    throw new RangeError(`randomInt(${maxExclusive}) 결과가 범위를 벗어났습니다: ${String(value)}`);
  }
  return value;
}

/** 입장 코드가 설정 길이의 ASCII 숫자 문자열인지 검사한다(API 스키마와 같은 모양). */
export function isValidEntryCode(code: string, config: EntryCodeConfig = defaultConfig): boolean {
  return code.length === config.ENTRY_CODE_LENGTH && ASCII_DIGITS_RE.test(code);
}

/**
 * 무작위 원천으로 입장 코드 하나를 만든다(ADR-016: 첫 자리 `1~9`, 나머지 `0~9`).
 */
export function generateEntryCode(randomInt: RandomInt, config: EntryCodeConfig = defaultConfig): string {
  const length = config.ENTRY_CODE_LENGTH;
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`ENTRY_CODE_LENGTH는 1 이상의 정수여야 합니다: ${String(length)}`);
  }

  let out = String(sampleInt(randomInt, 9) + 1);
  for (let i = 1; i < length; i++) {
    out += String(sampleInt(randomInt, 10));
  }
  return out;
}

/**
 * 이미 쓰이는 입장 코드와 겹치면 최대 `maxAttempts`(기본 5, PLAN §2.3 ①)번까지 다시 뽑는다.
 * 모두 겹치면 `null`을 돌려준다.
 */
export function generateUniqueEntryCode(
  randomInt: RandomInt,
  isTaken: (code: string) => boolean,
  config: EntryCodeConfig = defaultConfig,
  maxAttempts: number = DEFAULT_MAX_COLLISION_ATTEMPTS,
): string | null {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = generateEntryCode(randomInt, config);
    if (!isTaken(candidate)) return candidate;
  }
  return null;
}
