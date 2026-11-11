import { createHash } from 'node:crypto';
import { AppError } from '@geulbang/core/errors';
import { TOKEN_PATTERN } from '@geulbang/core/protocol';

export { TOKEN_PATTERN };

/** SHA-256 hex(64자 소문자). 서버 DB에는 토큰 원문 대신 이 해시만 저장한다(PLAN §7.4, PRD 13.3). */
export const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

const BEARER_PREFIX = /^Bearer\s+(\S+)$/i;

/** 기기가 만든 토큰(32바이트 무작위 → base64url 43자) 형식인가. */
export function isValidToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** SHA-256 hex(64자 소문자) 형식인가. */
export function isValidTokenHash(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_HASH_PATTERN.test(value);
}

/**
 * 기기가 만든 토큰의 형식을 확인하고 SHA-256 hex 해시를 돌려준다.
 * 형식이 맞지 않으면 `AppError('E_AUTH')`를 던진다.
 */
export function hashToken(token: string): string {
  if (!isValidToken(token)) {
    throw new AppError('E_AUTH', 'invalid token format');
  }
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

interface HeaderBag {
  get(name: string): string | null | undefined;
}

function isHeaderBag(source: unknown): source is HeaderBag {
  return typeof source === 'object' && source !== null && typeof (source as HeaderBag).get === 'function';
}

/**
 * `Authorization: Bearer <token>` 헤더에서 유효한 형식의 토큰을 꺼낸다.
 * 헤더가 없거나 `Bearer` 형식이 아니거나 토큰 모양이 틀리면 `null`을 돌려준다.
 */
export function bearerTokenFrom(source: Headers | HeaderBag | string | null | undefined): string | null {
  if (source === null || source === undefined) return null;
  const raw = typeof source === 'string' ? source : source.get('authorization');
  if (!raw) return null;
  const match = BEARER_PREFIX.exec(raw.trim());
  const token = match?.[1];
  if (!token || !isValidToken(token)) return null;
  return token;
}

export const readBearerToken = bearerTokenFrom;
export const parseBearerToken = bearerTokenFrom;

/** `Authorization: Bearer`에서 토큰을 읽고, 없거나 형식이 틀리면 `AppError('E_AUTH')`를 던진다. */
export function requireBearerToken(source: Headers | HeaderBag | string | null | undefined): string {
  const token = bearerTokenFrom(source);
  if (!token) throw new AppError('E_AUTH', 'missing or invalid bearer token');
  return token;
}

/** `Authorization: Bearer`에서 토큰을 읽어 SHA-256 hex 해시로 돌려준다. 실패 시 `AppError('E_AUTH')`. */
export function requireBearerTokenHash(source: Headers | HeaderBag | string | null | undefined): string {
  return hashToken(requireBearerToken(source));
}
