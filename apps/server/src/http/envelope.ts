import { AppError, errorCatalog, type ErrorCode, type FieldIssues } from '@geulbang/core/errors';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * 응답 봉투(PRD 12.4, 쌤유니버스와 같은 모양).
 * 성공 `{data, requestId}`, 실패 `{error: {code, message, retryable, fields?}, requestId}`.
 * `message`는 기록·개발용 짧은 영어 설명이다. 화면 문구는 기기가 코드로 고른다.
 */
export interface AppEnv {
  Variables: { requestId: string };
}

export function ok<T>(c: Context<AppEnv>, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ data, requestId: c.get('requestId') }, status);
}

/** 쓰기 응답은 `commandId`도 싣는다(PLAN §7.2). 다시 보낸 요청에도 같은 모양으로 답한다. */
export function okCommand<T>(c: Context<AppEnv>, data: T, commandId: string) {
  return c.json({ data, requestId: c.get('requestId'), commandId }, 200);
}

export function fail(
  c: Context<AppEnv>,
  code: ErrorCode,
  options: { status?: number; message?: string; fields?: FieldIssues } = {},
) {
  const status = (options.status ?? errorCatalog[code].http ?? 500) as ContentfulStatusCode;
  return c.json(
    {
      error: {
        code,
        message: options.message ?? code,
        retryable: errorCatalog[code].retryable,
        ...(options.fields ? { fields: options.fields } : {}),
      },
      requestId: c.get('requestId'),
    },
    status,
  );
}

export function failFromError(c: Context<AppEnv>, error: AppError) {
  return fail(c, error.code, { message: error.message, ...(error.fields ? { fields: error.fields } : {}) });
}
