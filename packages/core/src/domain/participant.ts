import { defaultConfig, type Config } from '../config.ts';

/**
 * 참가자 별명·학교 이름 규칙(PRD F-04·F-17·F-25, ADR-022).
 * 쌤유니버스(`normalizeStudentNickname`)와 같은 정규화 순서(NFKC → 앞뒤 공백 제거 → 연속 공백 하나로 → 소문자)를 써서
 * 나중에 학급 명단과 이어 붙일 때도 같은 비교 키가 나오도록 한다(PRD 10.3).
 */

export type NicknameConfig = Pick<Config, 'NICKNAME_MAX_LENGTH'>;

export type NicknameRejectReason = 'EMPTY' | 'TOO_LONG' | 'CONTROL_CHAR' | 'FORBIDDEN';

export type NicknameValidation =
  | {
      readonly ok: true;
      readonly nickname: string;
      readonly nicknameKey: string;
      readonly length: number;
    }
  | {
      readonly ok: false;
      readonly reason: NicknameRejectReason;
    };

/** 줄바꿈·탭·제로폭 문자 등 보이지 않는 제어·서식 문자(위장 별명 방지). */
const CONTROL_OR_FORMAT_RE = /[\p{Cc}\p{Cf}]/u;

/** 금지어 우회용 공백·문장부호·기호·밑줄 제거 정규식. */
const SEPARATOR_STRIP_RE = /[\s\p{P}\p{S}]+/gu;

/**
 * 부분 일치로 거르는 최소 욕설·비속어 목록(PRD F-04 `[추천]`: 최소 목록으로만 거름).
 * 일상 낱말과 겹치지 않는 확실한 욕설만 두고, NFKC·소문자 기준으로 비교한다.
 */
const RAW_FORBIDDEN_SUBSTRINGS = [
  '씨발',
  '시발',
  '씨팔',
  '시팔',
  '개새끼',
  '개세끼',
  '병신',
  '븅신',
  '지랄',
  '미친놈',
  '미친년',
  '꺼져',
  '닥쳐',
  '썅',
  '좆',
  '창녀',
  '걸레년',
  '섹스',
  '야동',
  '성폭행',
  '강간',
  'ㅅㅂ',
  'ㅂㅅ',
  'ㅈㄹ',
  'ㄲㅈ',
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'cunt',
  'porn',
] as const;

/**
 * 단독 일치로만 거르는 짧은 금칙어('바보지'·'감자지'·'essex' 같은 정상 문자열 오탐 방지).
 */
const RAW_FORBIDDEN_EXACT = ['보지', '자지', 'sex'] as const;

export const FORBIDDEN_NICKNAME_SUBSTRINGS: readonly string[] = RAW_FORBIDDEN_SUBSTRINGS.map(w =>
  w.normalize('NFKC').toLowerCase(),
);

export const FORBIDDEN_NICKNAME_EXACT: readonly string[] = RAW_FORBIDDEN_EXACT.map(w =>
  w.normalize('NFKC').toLowerCase(),
);

/**
 * 화면에 표시할 별명 정규화: NFKC(분해 자모 결합·전각 변환) → 앞뒤 공백 제거 → 연속 공백 하나로.
 * 영문 대소문자는 사용자가 쓴 모양을 유지한다.
 */
export function normalizeNickname(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

/**
 * 수업방 안 별명 중복 판정 키(`participants.nickname_norm`, PRD F-04):
 * `normalizeNickname` 결과에 영문 소문자 변환을 더한다.
 */
export function nicknameKey(raw: string): string {
  return normalizeNickname(raw).toLowerCase();
}

/** 정규화 전후 별명에 금지어가 들어 있는지 확인한다(공백·기호를 끼운 우회 포함). */
export function containsForbiddenNickname(raw: string): boolean {
  const lowered = normalizeNickname(raw).toLowerCase();
  if (lowered.length === 0) return false;

  const compact = lowered.replace(SEPARATOR_STRIP_RE, '');
  for (const exact of FORBIDDEN_NICKNAME_EXACT) {
    if (lowered === exact || compact === exact) return true;
  }
  for (const sub of FORBIDDEN_NICKNAME_SUBSTRINGS) {
    if (lowered.includes(sub) || compact.includes(sub)) return true;
  }
  return false;
}

/**
 * 별명 전체 검사: 제어 문자 → NFKC·공백 정규화 → 코드 포인트 길이(1~`NICKNAME_MAX_LENGTH`) → 금지어.
 */
export function validateNickname(raw: string, config: NicknameConfig = defaultConfig): NicknameValidation {
  if (CONTROL_OR_FORMAT_RE.test(raw)) {
    return { ok: false, reason: 'CONTROL_CHAR' };
  }

  const nickname = normalizeNickname(raw);
  const length = [...nickname].length;
  if (length === 0) {
    return { ok: false, reason: 'EMPTY' };
  }
  if (length > config.NICKNAME_MAX_LENGTH) {
    return { ok: false, reason: 'TOO_LONG' };
  }
  if (containsForbiddenNickname(nickname)) {
    return { ok: false, reason: 'FORBIDDEN' };
  }

  return {
    ok: true,
    nickname,
    nicknameKey: nickname.toLowerCase(),
    length,
  };
}

export function isValidNickname(raw: string, config: NicknameConfig = defaultConfig): boolean {
  return validateNickname(raw, config).ok;
}

/**
 * 개인 모드 학교 이름 정규화(PRD F-25):
 * NFKC → 모든 공백 제거 → 소문자 → 끝의 `초`·`초교` 약칭을 `초등학교`로 통일한다.
 */
export function normalizeSchoolName(raw: string): string {
  const compact = raw.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
  return compact.replace(/^(.+?)(?:초등학교|초교|초)$/u, '$1초등학교');
}

const koCollator = new Intl.Collator('ko');

/** 교사 대시보드 타일 가나다순 고정 정렬(PRD F-17). 동률이면 코드 포인트 순으로 결정한다. */
export function compareNicknames(a: string, b: string): number {
  const cmp = koCollator.compare(a, b);
  if (cmp !== 0) return cmp;
  return a < b ? -1 : a > b ? 1 : 0;
}
