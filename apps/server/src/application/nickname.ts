import { validateNickname } from '@geulbang/core';
import type { Config } from '@geulbang/core/config';
import { AppError } from '@geulbang/core/errors';

/**
 * 별명 확인(PRD F-04). 규칙은 `domain/participant.ts` 하나다: 제어 문자 거부 → NFKC·공백 정규화 → 1~`NICKNAME_MAX_LENGTH`자
 * → 금지어("다른 별명을 골라 볼까요?"). 같은 별명 판정 키는 영문 소문자까지 맞춘 값이다.
 */
export interface NormalizedNickname {
  /** 화면에 보일 별명 */
  readonly display: string;
  /** 수업방 안 중복 판정용(`participants.nickname_norm`) */
  readonly norm: string;
}

export function normalizeNickname(raw: string, config: Readonly<Config>): NormalizedNickname {
  const result = validateNickname(raw, config);
  if (!result.ok) {
    throw new AppError('E_NICK_INVALID', 'nickname rejected', { nickname: result.reason.toLowerCase() });
  }
  return { display: result.nickname, norm: result.nicknameKey };
}
