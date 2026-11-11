import { ko } from '@geulbang/core/copy';
import { isErrorCode, type ErrorCode } from '@geulbang/core/errors';

/**
 * 결합 부품의 실패 처리. REST(`ApiError`)와 채널 명령(`CommandError`)은 모두 `code`를 가진다.
 * 모르는 실패(던진 예외·모양 검사 실패)는 `E_INTERNAL`로 본다.
 */
export function errorCodeOf(error: unknown): ErrorCode {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (isErrorCode(code)) return code;
  }
  return 'E_INTERNAL';
}

/**
 * 토스트에 띄울 문구(`ko.errors[code]`). 학생 화면에서 조용히 넘기는 코드(빈 문구)도 교사는 무엇이 안 됐는지
 * 알아야 하므로 일반 안내로 바꿔 보인다.
 */
export function errorMessage(code: ErrorCode): string {
  return ko.errors[code] || ko.errors.E_INTERNAL;
}
