import { createHash, randomBytes } from 'node:crypto';
import { bytesToBase64Url } from '@geulbang/core';
import { AppError } from '@geulbang/core/errors';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadServerConfig, paths } from '../src/config.ts';
import { pruneRateBuckets } from '../src/jobs/rateBuckets.ts';
import {
  deviceHmac,
  globalPinHmac,
  hmacHex,
  hmacKeyFor,
  ipHmac,
  personalKeyHmac,
  pinHmac,
  teacherHmac,
} from '../src/security/hmac.ts';
import { decryptPin, encryptPin, PIN_IV_BYTES, PIN_TAG_BYTES } from '../src/security/pinCrypto.ts';
import {
  assertPinNotLocked,
  checkCodeLookupRateLimit,
  checkPersonalRateLimit,
  checkRoomCreateRateLimit,
  checkTeacherAiRateLimit,
  consumeRateBucket,
  RATE_BUCKETS,
  recordPinFailure,
  WINDOW_ONE_DAY_MS,
  WINDOW_ONE_MIN_MS,
} from '../src/security/rateLimit.ts';
import {
  bearerTokenFrom,
  hashToken,
  isValidToken,
  isValidTokenHash,
  requireBearerToken,
  requireBearerTokenHash,
  TOKEN_PATTERN,
} from '../src/security/tokens.ts';
import { openDatabase, type Db } from '../src/store/db.ts';
import { migrate } from '../src/store/migrate.ts';

function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.fail(`${code} 오류가 발생해야 합니다`);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

describe('P2-11 서버 보안 모듈', () => {
  describe('tokens.ts: 토큰 형식 확인·SHA-256 해시·Bearer 헤더', () => {
    it('32바이트 무작위 base64url(43자) 토큰만 허용하고 SHA-256 hex로 해시한다', () => {
      const tokenA = bytesToBase64Url(randomBytes(32));
      const tokenB = bytesToBase64Url(randomBytes(32));

      expect(tokenA).toHaveLength(43);
      expect(TOKEN_PATTERN.test(tokenA)).toBe(true);
      expect(isValidToken(tokenA)).toBe(true);

      const hashA1 = hashToken(tokenA);
      const hashA2 = hashToken(tokenA);
      const hashB = hashToken(tokenB);

      expect(hashA1).toBe(hashA2);
      expect(hashA1).not.toBe(hashB);
      expect(isValidTokenHash(hashA1)).toBe(true);
      expect(hashA1).toBe(createHash('sha256').update(tokenA, 'utf8').digest('hex'));
    });

    it('길이나 문자가 틀린 토큰은 거부하고 E_AUTH를 던진다', () => {
      const badTokens: unknown[] = [
        '',
        'a'.repeat(42),
        'a'.repeat(44),
        `${'a'.repeat(42)}=`,
        `${'a'.repeat(42)}+`,
        `${'a'.repeat(42)}/`,
        `${'a'.repeat(42)} `,
        null,
        undefined,
        12345,
      ];

      for (const bad of badTokens) {
        expect(isValidToken(bad)).toBe(false);
        if (typeof bad === 'string') {
          expectAppError(() => hashToken(bad), 'E_AUTH');
        }
      }

      expect(isValidTokenHash('a'.repeat(63))).toBe(false);
      expect(isValidTokenHash('A'.repeat(64))).toBe(false);
      expect(isValidTokenHash('g'.repeat(64))).toBe(false);
    });

    it('Authorization: Bearer 헤더에서 토큰을 읽고 잘못된 헤더는 거부한다', () => {
      const validToken = bytesToBase64Url(randomBytes(32));
      const headers = new Headers({ Authorization: `Bearer ${validToken}` });

      expect(bearerTokenFrom(headers)).toBe(validToken);
      expect(bearerTokenFrom(`  bearer   ${validToken}  `)).toBe(validToken);
      expect(requireBearerToken(headers)).toBe(validToken);
      expect(requireBearerTokenHash(headers)).toBe(hashToken(validToken));

      expect(bearerTokenFrom(new Headers())).toBeNull();
      expect(bearerTokenFrom(null)).toBeNull();
      expect(bearerTokenFrom(undefined)).toBeNull();
      expect(bearerTokenFrom(`Basic ${validToken}`)).toBeNull();
      expect(bearerTokenFrom('Bearer short-token')).toBeNull();
      expect(bearerTokenFrom(`Bearer ${validToken} extra`)).toBeNull();

      expectAppError(() => requireBearerToken(new Headers()), 'E_AUTH');
      expectAppError(() => requireBearerTokenHash('Bearer invalid'), 'E_AUTH');
    });
  });

  describe('hmac.ts: 용도별 HMAC 키 분리', () => {
    it('같은 입력값이라도 PIN·IP·기기 ID·개인 모드·교사 세션·전역 PIN 키별 HMAC 결과가 모두 다르다', () => {
      const config = loadServerConfig({ NODE_ENV: 'test' });
      const { secrets } = config;
      const sample = '123456';

      const results = [
        pinHmac(secrets, sample),
        ipHmac(secrets, sample),
        deviceHmac(secrets, sample),
        personalKeyHmac(secrets, sample),
        teacherHmac(secrets, sample),
        globalPinHmac(secrets),
      ];

      for (const hex of results) {
        expect(hex).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(new Set(results).size).toBe(results.length);

      // 같은 바이트로 채운 키 묶음에서도 용도별 파생키가 모두 달라야 한다.
      const sameKey = Buffer.alloc(32, 7);
      const unifiedSecrets = {
        pinHmacKey: sameKey,
        idHmacKey: sameKey,
        personalHmacKey: sameKey,
      };
      const domains = ['pin', 'ip', 'device', 'personal', 'teacher', 'room'] as const;
      const derivedHexes = domains.map(d => hmacHex(hmacKeyFor(unifiedSecrets, d), sample));
      expect(new Set(derivedHexes).size).toBe(domains.length);

      expect(() => hmacHex(Buffer.alloc(0), sample)).toThrow();
    });
  });

  describe('pinCrypto.ts: AES-256-GCM 암호화·복호화·위변조 거부', () => {
    const key = randomBytes(32);
    const otherKey = randomBytes(32);

    it('왕복 복호화가 일치하고, 같은 PIN도 매번 무작위 IV로 다른 암호문이 된다', () => {
      const pin = '042819';
      const enc1 = encryptPin(key, pin);
      const enc2 = encryptPin(key, pin);

      expect(enc1).not.toBe(enc2);
      expect(decryptPin(key, enc1)).toBe(pin);
      expect(decryptPin(key, enc2)).toBe(pin);

      // base64(iv 12B ‖ 암호문 6B ‖ 태그 16B) = 34바이트
      const raw = Buffer.from(enc1, 'base64');
      expect(raw.length).toBe(PIN_IV_BYTES + Buffer.byteLength(pin, 'utf8') + PIN_TAG_BYTES);
    });

    it('IV·암호문·태그 중 한 비트라도 위변조되거나 다른 키면 실패한다', () => {
      const pin = '12345678';
      const encoded = encryptPin(key, pin);
      const original = Buffer.from(encoded, 'base64');

      // 1) IV 첫 바이트 변조
      const tamperedIv = Buffer.from(original);
      tamperedIv[0] = (tamperedIv[0] ?? 0) ^ 0x01;
      expect(() => decryptPin(key, tamperedIv.toString('base64'))).toThrow();

      // 2) 암호문(가운데) 바이트 변조
      const tamperedCipher = Buffer.from(original);
      tamperedCipher[PIN_IV_BYTES] = (tamperedCipher[PIN_IV_BYTES] ?? 0) ^ 0x01;
      expect(() => decryptPin(key, tamperedCipher.toString('base64'))).toThrow();

      // 3) 인증 태그(마지막 바이트) 변조
      const tamperedTag = Buffer.from(original);
      const lastIdx = tamperedTag.length - 1;
      tamperedTag[lastIdx] = (tamperedTag[lastIdx] ?? 0) ^ 0x01;
      expect(() => decryptPin(key, tamperedTag.toString('base64'))).toThrow();

      // 4) 다른 키로 복호화
      expect(() => decryptPin(otherKey, encoded)).toThrow();

      // 5) 잘린 데이터·잘못된 형식·잘못된 키 길이
      expect(() =>
        decryptPin(key, original.subarray(0, PIN_IV_BYTES + PIN_TAG_BYTES).toString('base64')),
      ).toThrow();
      expect(() => decryptPin(key, 'not-valid-base64!!!')).toThrow();
      expect(() => encryptPin(Buffer.alloc(16), pin)).toThrow();
      expect(() => encryptPin(key, '')).toThrow();
    });
  });

  describe('rateLimit.ts & jobs/rateBuckets.ts: 속도 제한 칸과 정리', () => {
    let db: Db;
    const config = loadServerConfig({ NODE_ENV: 'test' });
    const { product, secrets } = config;

    beforeEach(() => {
      db = openDatabase(':memory:', { create: true });
      migrate(db, paths.migrationsDir, 1_700_000_000_000);
    });

    afterEach(() => {
      db.close();
    });

    it('PLAN §5.2의 10개 칸 이름이 모두 정의되어 있고 원문 키 저장을 거부한다', () => {
      expect(RATE_BUCKETS).toEqual([
        'pin_device',
        'pin_ip',
        'pin_global',
        'room_create_device',
        'room_create_ip',
        'code_lookup_device',
        'code_lookup_ip',
        'personal_device',
        'personal_ip',
        'check_ai_teacher',
      ]);

      expect(() =>
        consumeRateBucket({
          db,
          product,
          bucket: 'code_lookup_ip',
          keyHmac: '127.0.0.1',
          now: 1_700_000_000_000,
        }),
      ).toThrow();
    });

    it('고정 창 경계(창 끝 1ms 전·후): 1분·10분·하루 창에서 경계 전에는 막히고 경계 직후에는 풀린다', () => {
      // 1) 1분 창 (code_lookup_device, 상한 CODE_LOOKUP_PER_DEVICE_PER_MIN = 30)
      const oneMinStart = 1_700_000_040_000; // 60_000의 배수
      const oneMinBeforeEnd = oneMinStart + WINDOW_ONE_MIN_MS - 1;
      const oneMinAtEnd = oneMinStart + WINDOW_ONE_MIN_MS;

      for (let i = 0; i < product.CODE_LOOKUP_PER_DEVICE_PER_MIN; i++) {
        checkCodeLookupRateLimit({
          db,
          product,
          secrets,
          deviceId: 'device-window-1m',
          ip: '198.51.100.1',
          now: oneMinStart + i,
        });
      }
      // 창 끝 1ms 전에는 상한 초과로 E_RATE_LIMITED
      expectAppError(
        () =>
          checkCodeLookupRateLimit({
            db,
            product,
            secrets,
            deviceId: 'device-window-1m',
            ip: '198.51.100.1',
            now: oneMinBeforeEnd,
          }),
        'E_RATE_LIMITED',
      );
      // 창 끝(정각, 1ms 뒤)에는 새 창이 열려 통과
      expect(() =>
        checkCodeLookupRateLimit({
          db,
          product,
          secrets,
          deviceId: 'device-window-1m',
          ip: '198.51.100.1',
          now: oneMinAtEnd,
        }),
      ).not.toThrow();

      // 2) 10분 창 (pin_device, PIN_LOCK_MIN * 60_000 = 600_000)
      const tenMinWindow = product.PIN_LOCK_MIN * WINDOW_ONE_MIN_MS;
      const tenMinStart = 1_700_000_400_000; // 600_000의 배수
      for (let i = 0; i < product.PIN_MAX_FAILS; i++) {
        recordPinFailure({
          db,
          product,
          secrets,
          deviceId: 'device-window-10m',
          ip: '198.51.100.2',
          now: tenMinStart + i,
        });
      }
      expectAppError(
        () =>
          recordPinFailure({
            db,
            product,
            secrets,
            deviceId: 'device-window-10m',
            ip: '198.51.100.2',
            now: tenMinStart + tenMinWindow - 1,
          }),
        'E_PIN_LOCKED',
      );
      expect(() =>
        recordPinFailure({
          db,
          product,
          secrets,
          deviceId: 'device-window-10m',
          ip: '198.51.100.2',
          now: tenMinStart + tenMinWindow,
        }),
      ).not.toThrow();

      // 3) 하루 창 (room_create_device 및 check_ai_teacher, 86_400_000)
      const dayStart = Math.floor(1_700_000_000_000 / WINDOW_ONE_DAY_MS) * WINDOW_ONE_DAY_MS;
      for (let i = 0; i < product.ROOM_CREATE_PER_DEVICE_PER_DAY; i++) {
        checkRoomCreateRateLimit({
          db,
          product,
          secrets,
          deviceId: 'device-window-1d',
          ip: `198.51.100.${10 + i}`,
          now: dayStart + i,
        });
      }
      expectAppError(
        () =>
          checkRoomCreateRateLimit({
            db,
            product,
            secrets,
            deviceId: 'device-window-1d',
            ip: '198.51.100.99',
            now: dayStart + WINDOW_ONE_DAY_MS - 1,
          }),
        'E_RATE_LIMITED',
      );
      expect(() =>
        checkRoomCreateRateLimit({
          db,
          product,
          secrets,
          deviceId: 'device-window-1d',
          ip: '198.51.100.99',
          now: dayStart + WINDOW_ONE_DAY_MS,
        }),
      ).not.toThrow();

      for (let i = 0; i < product.CHECK_AI_PER_DAY; i++) {
        checkTeacherAiRateLimit({
          db,
          product,
          secrets,
          teacherSessionKey: 'teacher-session-1',
          now: dayStart + i,
        });
      }
      expectAppError(
        () =>
          checkTeacherAiRateLimit({
            db,
            product,
            secrets,
            teacherSessionKey: 'teacher-session-1',
            now: dayStart + WINDOW_ONE_DAY_MS - 1,
          }),
        'E_RATE_LIMITED',
      );
      expect(() =>
        checkTeacherAiRateLimit({
          db,
          product,
          secrets,
          teacherSessionKey: 'teacher-session-1',
          now: dayStart + WINDOW_ONE_DAY_MS,
        }),
      ).not.toThrow();

      // 개인 모드 칸(personal_device)도 1분 창 상한을 따른다
      for (let i = 0; i < product.CODE_LOOKUP_PER_DEVICE_PER_MIN; i++) {
        checkPersonalRateLimit({
          db,
          product,
          secrets,
          deviceId: 'device-personal',
          ip: '198.51.100.50',
          now: oneMinStart + i,
        });
      }
      expectAppError(
        () =>
          checkPersonalRateLimit({
            db,
            product,
            secrets,
            deviceId: 'device-personal',
            ip: '198.51.100.50',
            now: oneMinBeforeEnd,
          }),
        'E_RATE_LIMITED',
      );
    });

    it('기기 기준 PIN 잠금(5회): 한 기기가 5회 틀려 잠겨도 같은 학교 IP의 다른 기기는 막히지 않는다(PRD 16.4)', () => {
      const now = 1_700_000_400_000;
      const schoolIp = '203.0.113.10';
      const deviceA = 'device-student-a';
      const deviceB = 'device-teacher-b';

      for (let i = 1; i <= product.PIN_MAX_FAILS; i++) {
        const res = recordPinFailure({ db, product, secrets, deviceId: deviceA, ip: schoolIp, now });
        expect(res.deviceCount).toBe(i);
        expect(res.ipCount).toBe(i);
        expect(res.delayMs).toBe(0);
      }

      // 5회 실패 누적 뒤 기기 A는 잠금 상태다
      expectAppError(
        () => assertPinNotLocked({ db, product, secrets, deviceId: deviceA, ip: schoolIp, now }),
        'E_PIN_LOCKED',
      );

      // 기기 A가 잠긴 상태에서 10번 더 눌러도 E_PIN_LOCKED이고 학교 IP 카운트는 오르지 않는다
      for (let i = 0; i < 10; i++) {
        expectAppError(
          () => recordPinFailure({ db, product, secrets, deviceId: deviceA, ip: schoolIp, now }),
          'E_PIN_LOCKED',
        );
      }

      // 같은 학교 IP의 다른 기기 B는 잠기지 않고 정상 시도할 수 있다
      expect(assertPinNotLocked({ db, product, secrets, deviceId: deviceB, ip: schoolIp, now })).toEqual({
        delayMs: 0,
      });
      const bRes = recordPinFailure({ db, product, secrets, deviceId: deviceB, ip: schoolIp, now });
      expect(bRes.deviceCount).toBe(1);
      expect(bRes.ipCount).toBe(product.PIN_MAX_FAILS + 1);

      // DB에는 원문 기기 ID나 IP가 저장되지 않고 64자 hex HMAC만 들어 있다
      const storedKeys = db.prepare('SELECT key_hmac FROM rate_buckets').all() as Array<{ key_hmac: string }>;
      expect(storedKeys.length).toBeGreaterThan(0);
      for (const row of storedKeys) {
        expect(row.key_hmac).toMatch(/^[0-9a-f]{64}$/);
        expect(row.key_hmac).not.toContain(schoolIp);
        expect(row.key_hmac).not.toContain(deviceA);
      }
    });

    it('같은 IP에서 PIN_IP_MAX_FAILS를 넘으면 IP 기준으로도 잠긴다', () => {
      const now = 1_700_000_400_000;
      const sharedIp = '203.0.113.77';

      // 기기당 5회 제한에 걸리지 않게 기기를 바꿔 가며 같은 IP에서 PIN_IP_MAX_FAILS(30)회 실패
      for (let i = 0; i < product.PIN_IP_MAX_FAILS; i++) {
        recordPinFailure({
          db,
          product,
          secrets,
          deviceId: `dev-${Math.floor(i / product.PIN_MAX_FAILS)}`,
          ip: sharedIp,
          now,
        });
      }

      // 31번째 시도는 새 기기여도 IP 한도 초과로 E_PIN_LOCKED
      expectAppError(
        () =>
          recordPinFailure({
            db,
            product,
            secrets,
            deviceId: 'dev-fresh',
            ip: sharedIp,
            now,
          }),
        'E_PIN_LOCKED',
      );
    });

    it('전역 PIN 실패가 PIN_GLOBAL_SLOW_FAILS를 넘으면 PIN_GLOBAL_DELAY_MS 지연 값을 돌려준다', () => {
      const now = 1_700_000_400_000;

      for (let i = 1; i <= product.PIN_GLOBAL_SLOW_FAILS; i++) {
        const res = recordPinFailure({
          db,
          product,
          secrets,
          deviceId: `global-dev-${i}`,
          ip: `10.0.${Math.floor(i / 10)}.${(i % 10) + 1}`,
          now,
        });
        expect(res.globalCount).toBe(i);
        expect(res.delayMs).toBe(0);
      }

      // 문턱(100)을 넘는 101번째 실패부터 delayMs = PIN_GLOBAL_DELAY_MS(2000) 반환
      const slow = recordPinFailure({
        db,
        product,
        secrets,
        deviceId: 'global-dev-over',
        ip: '10.99.0.1',
        now,
      });
      expect(slow.globalCount).toBe(product.PIN_GLOBAL_SLOW_FAILS + 1);
      expect(slow.delayMs).toBe(product.PIN_GLOBAL_DELAY_MS);
      expect(
        assertPinNotLocked({
          db,
          product,
          secrets,
          deviceId: 'global-dev-over',
          ip: '10.99.0.1',
          now,
        }),
      ).toEqual({ delayMs: product.PIN_GLOBAL_DELAY_MS });
    });

    it('pruneRateBuckets: window_start가 하루(86,400,000ms)보다 오래된 칸만 지운다', () => {
      const now = 1_700_100_000_000;
      const key = deviceHmac(secrets, 'cleanup-device');

      const insert = db.prepare(
        'INSERT INTO rate_buckets (bucket, key_hmac, window_start, count) VALUES (?, ?, ?, ?)',
      );
      insert.run('code_lookup_device', key, now - WINDOW_ONE_DAY_MS - 60_000, 5);
      insert.run('code_lookup_device', key, now - WINDOW_ONE_DAY_MS - 1, 3);
      insert.run('code_lookup_device', key, now - WINDOW_ONE_DAY_MS, 2);
      insert.run('code_lookup_device', key, now, 1);

      const deleted = pruneRateBuckets(db, now);
      expect(deleted).toBe(2);

      const remaining = db
        .prepare('SELECT window_start FROM rate_buckets ORDER BY window_start ASC')
        .all() as Array<{ window_start: number }>;
      expect(remaining.map(r => r.window_start)).toEqual([now - WINDOW_ONE_DAY_MS, now]);
    });
  });
});
