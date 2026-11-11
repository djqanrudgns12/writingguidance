import { describe, expect, it } from 'vitest';
import { MS_PER_SECOND } from './clock.ts';
import {
  aiDayBoundsMs,
  aiDayKey,
  checkAiQuota,
  cooldownLeftMs,
  cooldownLeftSec,
  countsTowardAiQuota,
  isSameAiDay,
  type AiQuotaConfig,
} from './aiQuota.ts';

describe('aiQuota 한국 시각(KST) 하루 경계·쿨다운·한도 판단 순서', () => {
  const cfg: AiQuotaConfig = {
    TIMEZONE: 'Asia/Seoul',
    AI_COOLDOWN_SEC: 10,
    AI_DAILY_PER_PARTICIPANT: 60,
    AI_DAILY_PER_ROOM: 1500,
    AI_DAILY_GLOBAL: 3000,
    AI_DAILY_PERSONAL_GLOBAL: 500,
  };

  it('KST 자정 경계(23:59:59.999 → 00:00:00.000)에서 하루 키와 시작·끝 구간이 정확히 바뀐다', () => {
    // 2026-11-11 23:59:59.000 KST = 2026-11-11 14:59:59.000 UTC
    const kstBeforeMidnightSec = Date.UTC(2026, 10, 11, 14, 59, 59, 0);
    // 2026-11-11 23:59:59.999 KST = 2026-11-11 14:59:59.999 UTC
    const kstBeforeMidnightMs = Date.UTC(2026, 10, 11, 14, 59, 59, 999);
    // 2026-11-12 00:00:00.000 KST = 2026-11-11 15:00:00.000 UTC
    const kstAtMidnight = Date.UTC(2026, 10, 11, 15, 0, 0, 0);

    expect(aiDayKey(kstBeforeMidnightSec, cfg)).toBe('2026-11-11');
    expect(aiDayKey(kstBeforeMidnightMs, cfg)).toBe('2026-11-11');
    expect(aiDayKey(kstAtMidnight, cfg)).toBe('2026-11-12');

    expect(isSameAiDay(kstBeforeMidnightSec, kstBeforeMidnightMs, cfg)).toBe(true);
    expect(isSameAiDay(kstBeforeMidnightMs, kstAtMidnight, cfg)).toBe(false);

    const boundsNov11 = aiDayBoundsMs(kstBeforeMidnightMs, cfg);
    expect(boundsNov11).toEqual({
      day: '2026-11-11',
      startMs: Date.UTC(2026, 10, 10, 15, 0, 0, 0),
      endMs: kstAtMidnight,
    });

    const boundsNov12 = aiDayBoundsMs(kstAtMidnight, cfg);
    expect(boundsNov12).toEqual({
      day: '2026-11-12',
      startMs: kstAtMidnight,
      endMs: Date.UTC(2026, 10, 12, 15, 0, 0, 0),
    });
  });

  it('버튼별 쿨다운 경계(0ms·1ms·9999ms·10000ms)에서 남은 초(cooldownLeftSec)를 올림 정수로 계산한다', () => {
    const lastAt = Date.UTC(2026, 10, 11, 1, 0, 0, 0);

    expect(cooldownLeftSec(null, lastAt, cfg)).toBe(0);
    expect(cooldownLeftSec(undefined, lastAt, cfg)).toBe(0);

    // 직전 요청 직후(0ms 경과) → 10초 남음
    expect(cooldownLeftMs(lastAt, lastAt, cfg)).toBe(10 * MS_PER_SECOND);
    expect(cooldownLeftSec(lastAt, lastAt, cfg)).toBe(10);

    // 1ms 경과 → 9999ms 남음 → 올림 10초
    expect(cooldownLeftMs(lastAt, lastAt + 1, cfg)).toBe(9999);
    expect(cooldownLeftSec(lastAt, lastAt + 1, cfg)).toBe(10);

    // 정확히 1초 경과 → 9000ms 남음 → 9초
    expect(cooldownLeftSec(lastAt, lastAt + 1000, cfg)).toBe(9);

    // 9999ms 경과(해제 1ms 전) → 1ms 남음 → 올림 1초
    expect(cooldownLeftMs(lastAt, lastAt + 9999, cfg)).toBe(1);
    expect(cooldownLeftSec(lastAt, lastAt + 9999, cfg)).toBe(1);

    // 정확히 10000ms(10초) 경과 → 쿨다운 해제(0초)
    expect(cooldownLeftMs(lastAt, lastAt + 10 * MS_PER_SECOND, cfg)).toBe(0);
    expect(cooldownLeftSec(lastAt, lastAt + 10 * MS_PER_SECOND, cfg)).toBe(0);

    // 시계 오차로 lastAt이 now보다 약간 미래여도 AI_COOLDOWN_SEC를 넘지 않는다
    expect(cooldownLeftSec(lastAt + 500, lastAt, cfg)).toBe(10);

    // 설정이 0초이면 쿨다운 없음
    expect(cooldownLeftSec(lastAt, lastAt, { AI_COOLDOWN_SEC: 0 })).toBe(0);
  });

  it('참가자·수업방·전체·개인모드 한도에서 정확히 N번째(used = N - 1)는 허용하고 N + 1번째(used = N)부터 거절한다', () => {
    const now = Date.UTC(2026, 10, 11, 2, 0, 0, 0);

    // 참가자 하루 60회: 59회 쓴 뒤(60번째 요청)는 허용, 60회 쓴 뒤(61번째 요청)는 거절
    const p60th = checkAiQuota({ participantUsed: 59, roomUsed: 100, globalUsed: 200 }, now, cfg);
    expect(p60th.allowed).toBe(true);
    expect(p60th.code).toBeNull();

    const p61st = checkAiQuota({ participantUsed: 60, roomUsed: 100, globalUsed: 200 }, now, cfg);
    expect(p61st).toEqual({
      ok: false,
      allowed: false,
      duplicate: false,
      code: 'E_AI_LIMIT',
      reason: 'PARTICIPANT_LIMIT',
      cooldownLeftSec: 0,
      cooldownLeftMs: 0,
      day: '2026-11-11',
      scope: 'GLOBAL',
    });

    // 수업방 하루 1500회: 1499회 쓴 뒤(1500번째 요청)는 허용, 1500회 쓴 뒤는 거절
    expect(checkAiQuota({ participantUsed: 10, roomUsed: 1499, globalUsed: 2000 }, now, cfg).allowed).toBe(
      true,
    );
    const roomOver = checkAiQuota({ participantUsed: 10, roomUsed: 1500, globalUsed: 2000 }, now, cfg);
    expect(roomOver.allowed).toBe(false);
    expect(roomOver.code).toBe('E_AI_LIMIT');
    expect(roomOver.reason).toBe('ROOM_LIMIT');

    // 전체 하루 3000회: 2999회 쓴 뒤(3000번째 요청)는 허용, 3000회 쓴 뒤는 거절
    expect(checkAiQuota({ participantUsed: 10, roomUsed: 500, globalUsed: 2999 }, now, cfg).allowed).toBe(
      true,
    );
    const globalOver = checkAiQuota({ participantUsed: 10, roomUsed: 500, globalUsed: 3000 }, now, cfg);
    expect(globalOver.allowed).toBe(false);
    expect(globalOver.code).toBe('E_AI_LIMIT');
    expect(globalOver.reason).toBe('GLOBAL_LIMIT');

    // 개인 모드 전체 하루 500회: 방 한도는 보지 않고 499회(500번째) 허용, 500회(501번째) 거절
    expect(
      checkAiQuota({ participantUsed: 10, roomUsed: 9999, globalUsed: 499, isPersonal: true }, now, cfg)
        .allowed,
    ).toBe(true);
    const personalOver = checkAiQuota(
      { participantUsed: 10, roomUsed: 0, globalUsed: 500, isPersonal: true },
      now,
      cfg,
    );
    expect(personalOver.allowed).toBe(false);
    expect(personalOver.code).toBe('E_AI_LIMIT');
    expect(personalOver.reason).toBe('PERSONAL_GLOBAL_LIMIT');
    expect(personalOver.scope).toBe('PERSONAL');
  });

  it('PLAN §8.2 판단 순서(같은 commandId → 쿨다운 → 참가자 → 방 → 전체)를 엄격히 지킨다', () => {
    const now = Date.UTC(2026, 10, 11, 3, 0, 0, 0);

    // 1순위: 같은 commandId이면 쿨다운 중이고 모든 한도가 다 찼어도 허용(duplicate: true)
    const dup = checkAiQuota(
      {
        sameCommandId: true,
        lastButtonAt: now - 1000,
        participantUsed: 60,
        roomUsed: 1500,
        globalUsed: 3000,
      },
      now,
      cfg,
    );
    expect(dup).toEqual({
      ok: true,
      allowed: true,
      duplicate: true,
      code: null,
      reason: null,
      cooldownLeftSec: 0,
      cooldownLeftMs: 0,
      day: '2026-11-11',
      scope: 'GLOBAL',
    });

    // 2순위: 쿨다운과 하루 한도가 동시에 걸리면 E_AI_COOLDOWN이 먼저 나온다
    const cooldownAndLimit = checkAiQuota(
      {
        lastButtonAt: now - 2500,
        participantUsed: 60,
        roomUsed: 1500,
        globalUsed: 3000,
      },
      now,
      cfg,
    );
    expect(cooldownAndLimit.allowed).toBe(false);
    expect(cooldownAndLimit.code).toBe('E_AI_COOLDOWN');
    expect(cooldownAndLimit.reason).toBe('COOLDOWN');
    expect(cooldownAndLimit.cooldownLeftSec).toBe(8);
    expect(cooldownAndLimit.cooldownLeftMs).toBe(7500);

    // 3순위 vs 4순위: 참가자 한도와 방 한도가 동시에 걸리면 PARTICIPANT_LIMIT이 먼저
    const partAndRoom = checkAiQuota(
      {
        lastButtonAt: now - 10_000,
        participantUsed: 60,
        roomUsed: 1500,
        globalUsed: 3000,
      },
      now,
      cfg,
    );
    expect(partAndRoom.reason).toBe('PARTICIPANT_LIMIT');

    // 4순위 vs 5순위: 방 한도와 전체 한도가 동시에 걸리면 ROOM_LIMIT이 먼저
    const roomAndGlobal = checkAiQuota(
      {
        participantUsed: 59,
        roomUsed: 1500,
        globalUsed: 3000,
      },
      now,
      cfg,
    );
    expect(roomAndGlobal.reason).toBe('ROOM_LIMIT');
  });

  it('ai_usage 상태 중 REFUNDED만 한도 집계에서 제외한다', () => {
    expect(countsTowardAiQuota('RESERVED')).toBe(true);
    expect(countsTowardAiQuota('OK')).toBe(true);
    expect(countsTowardAiQuota('FAILED')).toBe(true);
    expect(countsTowardAiQuota('REFUNDED')).toBe(false);
  });
});
