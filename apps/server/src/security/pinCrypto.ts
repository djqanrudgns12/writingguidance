import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * 교사 PIN `보기`(PRD F-16·F-20, PLAN §7.4)용 대칭 암호화.
 * AES-256-GCM, 무작위 IV 12바이트, 인증 태그 16바이트, 저장 형태는 `base64(iv ‖ 암호문 ‖ 태그)`.
 */
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
export const PIN_IV_BYTES = 12;
export const PIN_TAG_BYTES = 16;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new Error(`PIN 암호화 키는 ${KEY_BYTES}바이트 Buffer여야 합니다`);
  }
}

function resolveArgs(first: Buffer | string, second: Buffer | string): { key: Buffer; text: string } {
  if (Buffer.isBuffer(first) && typeof second === 'string') {
    return { key: first, text: second };
  }
  if (typeof first === 'string' && Buffer.isBuffer(second)) {
    return { key: second, text: first };
  }
  throw new Error('유효하지 않은 인자입니다(32바이트 키 Buffer와 문자열이 필요합니다)');
}

/** PIN을 AES-256-GCM으로 암호화해 `base64(iv ‖ 암호문 ‖ 태그)` 문자열로 돌려준다. */
export function encryptPin(key: Buffer, pin: string): string;
export function encryptPin(pin: string, key: Buffer): string;
export function encryptPin(first: Buffer | string, second: Buffer | string): string {
  const { key, text: pin } = resolveArgs(first, second);
  assertKey(key);
  if (pin.length === 0) {
    throw new Error('암호화할 PIN이 비어 있습니다');
  }

  const iv = randomBytes(PIN_IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: PIN_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

/**
 * `base64(iv ‖ 암호문 ‖ 태그)`를 복호화해 원래 PIN을 돌려준다.
 * 키가 다르거나 IV·암호문·태그 중 한 비트라도 바뀌었으면 예외를 던진다.
 */
export function decryptPin(key: Buffer, encoded: string): string;
export function decryptPin(encoded: string, key: Buffer): string;
export function decryptPin(first: Buffer | string, second: Buffer | string): string {
  const { key, text: encoded } = resolveArgs(first, second);
  assertKey(key);
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !BASE64_PATTERN.test(encoded)) {
    throw new Error('유효하지 않은 PIN 암호문 형식입니다');
  }

  const packed = Buffer.from(encoded, 'base64');
  // 빈 평문은 허용하지 않으므로 최소 1바이트의 암호문이 있어야 한다.
  if (packed.length <= PIN_IV_BYTES + PIN_TAG_BYTES) {
    throw new Error('PIN 암호문 길이가 너무 짧습니다');
  }

  const iv = packed.subarray(0, PIN_IV_BYTES);
  const tag = packed.subarray(packed.length - PIN_TAG_BYTES);
  const ciphertext = packed.subarray(PIN_IV_BYTES, packed.length - PIN_TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: PIN_TAG_BYTES });
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}
