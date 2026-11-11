import { randomUUID } from 'node:crypto';
import { AppError } from '@geulbang/core/errors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enterWithPin } from '../src/application/enterWithPin.ts';
import { createRoomGate } from '../src/realtime/roomGate.ts';
import { recordPinFailure } from '../src/security/rateLimit.ts';
import { createRepos } from '../src/store/repos/index.ts';
import { startTestServer, type TestServer } from './helpers.ts';
import { createRoom, newToken } from './roomClient.ts';

/**
 * 검토 1번(P5-5a): 전역 감속 대기 중인 병렬 PIN 요청들이 먼저 깨어난 요청들의 실패로 잠금 한도가 찬 뒤에도
 * 맞는 PIN으로 세션을 받으면 안 된다(PRD F-20 "잠긴 동안은 맞는 PIN도 막는다").
 */
const START_CODE = '12345678';

describe('PIN 전역 감속 중 병렬 요청', () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startTestServer({ TEACHER_START_CODE: START_CODE, ROOM_CREATE_PER_IP_PER_DAY: '1000' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('감속 대기 뒤 다시 잠금을 확인해, 앞 요청들이 한도를 채우면 뒤의 맞는 PIN도 E_PIN_LOCKED', async () => {
    const created = await createRoom(t, START_CODE);
    expect(created.res.status).toBe(200);
    const p = t.config.product;
    const repos = createRepos(t.server.db);
    const now = Date.now();
    // 다른 기기·IP의 실패로 전역 칸만 감속 문턱을 넘긴다.
    for (let i = 0; i <= p.PIN_GLOBAL_SLOW_FAILS; i++) {
      recordPinFailure({
        db: repos.db,
        product: p,
        secrets: t.config.secrets,
        deviceId: randomUUID(),
        ip: `198.51.${Math.floor(i / 250)}.${i % 250}`,
        now,
      });
    }

    const wakers: Array<() => void> = [];
    const deps = {
      config: t.config,
      repos,
      gate: createRoomGate(),
      now: () => now,
      sleep: () =>
        new Promise<void>(resolve => {
          wakers.push(resolve);
        }),
    };
    const deviceId = randomUUID();
    const ip = '203.0.113.7';
    const send = (pin: string) =>
      enterWithPin(deps, {
        body: { pin, deviceId, sessionTokenHash: newToken().hash, commandId: randomUUID() },
        ip,
      }).then(
        () => 'OK',
        (error: unknown) => (error instanceof AppError ? error.code : 'THROWN'),
      );

    // 모두 아직 안 잠긴 상태에서 검사를 통과해 감속 대기에 들어간다.
    const wrong = Array.from({ length: p.PIN_MAX_FAILS }, (_, i) => send(`9999999${i}`));
    const right = send(String(created.body['pin']));
    expect(wakers).toHaveLength(p.PIN_MAX_FAILS + 1);

    // 틀린 요청부터 깨운다. 실패 기록 뒤 또 감속 대기에 들어가면 그것도 깨운다.
    for (let i = 0; i < p.PIN_MAX_FAILS; i++) {
      wakers[i]?.();
      await Promise.resolve();
    }
    for (let round = 0; round < 10; round++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      const pending = wakers.splice(p.PIN_MAX_FAILS + 1);
      for (const wake of pending) wake();
    }
    const wrongResults = await Promise.all(wrong);
    expect(wrongResults).toEqual(Array.from({ length: p.PIN_MAX_FAILS }, () => 'E_PIN_INVALID'));

    wakers[p.PIN_MAX_FAILS]?.();
    expect(await right).toBe('E_PIN_LOCKED');
    const sessions = t.server.db
      .prepare('SELECT COUNT(*) AS n FROM teacher_sessions WHERE room_id = ? AND kind = ?')
      .get(created.roomId, 'PIN') as { n: number };
    expect(sessions.n).toBe(0);
  });
});
