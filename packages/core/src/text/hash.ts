import { bytesToBase64Url } from '../encoding.ts';

/**
 * 해시와 토큰(PLAN §7.4). 브라우저와 Node 24 모두 있는 `globalThis.crypto`만 쓴다.
 * 토큰은 기기가 만든다(32바이트 → base64url 43자). 서버는 SHA-256 hex만 저장한다.
 */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  let out = '';
  for (const b of new Uint8Array(digest)) out += b.toString(16).padStart(2, '0');
  return out;
}

export function randomTokenBase64Url(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}
