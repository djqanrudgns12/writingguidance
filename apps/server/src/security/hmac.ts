import { createHmac } from 'node:crypto';
import type { Secrets } from '../config.ts';

/**
 * HMAC-SHA256 hex(PLAN §7.4).
 * PIN·IP·기기 ID·개인 모드 키는 서로 다른 키를 써서 같은 원문이라도 다른 해시가 나오게 한다.
 */
export function hmacHex(key: Buffer, value: string): string {
  if (key.length === 0) {
    throw new Error('HMAC 키가 비어 있습니다');
  }
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

export type HmacDomain = 'pin' | 'ip' | 'device' | 'personal' | 'teacher' | 'room';

export type HmacSecrets = Pick<Secrets, 'pinHmacKey' | 'idHmacKey' | 'personalHmacKey'>;

function deriveSubkey(masterKey: Buffer, label: string): Buffer {
  return createHmac('sha256', masterKey).update(`geulbang-hmac-key:${label}`, 'utf8').digest();
}

/**
 * 용도별로 분리된 32바이트 HMAC 키를 돌려준다.
 * - `pin`: `secrets.pinHmacKey`에서 파생(PIN 전용 키)
 * - `personal`: `secrets.personalHmacKey`에서 파생(개인 모드 전용 키)
 * - `ip` · `device` · `teacher` · `room`: `secrets.idHmacKey`에서 용도별 라벨로 각각 다른 서브키를 파생
 */
export function hmacKeyFor(secrets: HmacSecrets, domain: HmacDomain): Buffer {
  switch (domain) {
    case 'pin':
      return deriveSubkey(secrets.pinHmacKey, 'pin');
    case 'personal':
      return deriveSubkey(secrets.personalHmacKey, 'personal');
    case 'ip':
      return deriveSubkey(secrets.idHmacKey, 'ip');
    case 'device':
      return deriveSubkey(secrets.idHmacKey, 'device');
    case 'teacher':
      return deriveSubkey(secrets.idHmacKey, 'teacher');
    case 'room':
      return deriveSubkey(secrets.idHmacKey, 'room');
  }
}

/** PIN 중복 검사·입장 조회용 HMAC(`PIN_HMAC_KEY`). */
export function pinHmac(secrets: Pick<Secrets, 'pinHmacKey'>, pin: string): string {
  return hmacHex(deriveSubkey(secrets.pinHmacKey, 'pin'), pin);
}

/** 클라이언트 IP 속도 제한 칸용 HMAC(`ID_HMAC_KEY`의 IP 전용 파생키). */
export function ipHmac(secrets: Pick<Secrets, 'idHmacKey'>, ip: string): string {
  return hmacHex(deriveSubkey(secrets.idHmacKey, 'ip'), ip);
}

/** 기기 ID 속도 제한·익명 행위자 식별용 HMAC(`ID_HMAC_KEY`의 기기 전용 파생키). */
export function deviceHmac(secrets: Pick<Secrets, 'idHmacKey'>, deviceId: string): string {
  return hmacHex(deriveSubkey(secrets.idHmacKey, 'device'), deviceId);
}

export const deviceIdHmac = deviceHmac;

/** 개인 모드(학교+별명 정규화 키) 조회용 HMAC(`PERSONAL_HMAC_KEY`). */
export function personalKeyHmac(secrets: Pick<Secrets, 'personalHmacKey'>, normalizedKey: string): string {
  return hmacHex(deriveSubkey(secrets.personalHmacKey, 'personal'), normalizedKey);
}

export const personalHmac = personalKeyHmac;

/** 교사 세션 속도 제한(`check_ai_teacher`)용 HMAC(`ID_HMAC_KEY`의 교사 전용 파생키). */
export function teacherHmac(secrets: Pick<Secrets, 'idHmacKey'>, sessionKey: string): string {
  return hmacHex(deriveSubkey(secrets.idHmacKey, 'teacher'), sessionKey);
}

/** 전역 PIN 실패 칸(`pin_global`)용 고정 키 HMAC. */
export function globalPinHmac(secrets: Pick<Secrets, 'idHmacKey'>): string {
  return hmacHex(deriveSubkey(secrets.idHmacKey, 'pin_global'), 'global');
}
