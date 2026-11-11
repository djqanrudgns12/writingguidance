import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from './helpers.ts';
import { api, bearer, createRoom, newToken } from './roomClient.ts';

const START_CODE = '24681357';

describe('선생님 링크 토큰 → 방(PRD F-20, 다른 기기에서 링크 열기)', () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startTestServer({ TEACHER_START_CODE: START_CODE }, { ai: null });
  });
  afterAll(async () => {
    await t.close();
  });

  it('링크 토큰만으로 방 ID를 받고, 그 방 정보도 열린다', async () => {
    const room = await createRoom(t, START_CODE);
    expect(room.res.status).toBe(200);
    const res = await api(t, 'GET', '/api/teacher/session', undefined, bearer(room.linkToken));
    expect(res.status).toBe(200);
    expect(res.json.data?.['roomId']).toBe(room.roomId);
    const info = await api(t, 'GET', `/api/teacher/rooms/${room.roomId}`, undefined, bearer(room.linkToken));
    expect(info.status).toBe(200);
  });

  it('모르는 토큰은 E_AUTH, 토큰이 없으면 거부', async () => {
    const res = await api(t, 'GET', '/api/teacher/session', undefined, bearer(newToken().token));
    expect(res.status).toBe(401);
    expect(res.json.error?.code).toBe('E_AUTH');
    const none = await api(t, 'GET', '/api/teacher/session');
    expect(none.status).toBeGreaterThanOrEqual(400);
  });
});
