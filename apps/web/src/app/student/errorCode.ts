import { ko } from '@geulbang/core/copy';
import { errorCatalog, isErrorCode, type ErrorCode } from '@geulbang/core/errors';

/**
 * 유스케이스가 던진 것(REST `ApiError`, 채널 `CommandError`, `waitHello` 거부)을 오류 코드 하나로 모은다.
 * 모양을 모르는 것은 `E_INTERNAL`("잠깐 문제가 생겼어요")로 본다.
 */
export function errorCodeOf(error: unknown): ErrorCode {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string' && isErrorCode(code)) return code;
  }
  return 'E_INTERNAL';
}

/** 화면에 띄울 한 줄(PRD 7.2). 조용한 코드(`silent`)는 null: 기기가 알아서 처리한다. */
export function errorLineOf(code: ErrorCode): string | null {
  if (errorCatalog[code].silent) return null;
  return ko.errors[code] || ko.errors.E_INTERNAL;
}

/** 연결이 없어서 실패했는가(기기 사본으로 계속 쓸 수 있는 실패) */
export function isConnectionError(code: ErrorCode): boolean {
  return code === 'E_OFFLINE' || code === 'E_SERVER_DOWN';
}

export function isRetryable(code: ErrorCode): boolean {
  return errorCatalog[code].retryable;
}
