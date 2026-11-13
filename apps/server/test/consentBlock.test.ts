import { randomUUID } from 'node:crypto';
import { bytesToBase64Url } from '@geulbang/core';
import { AppError } from '@geulbang/core/errors';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { assertConsentCurrent } from '../src/application/consent.ts';
import { startTestServer, type TestServer } from './helpers.ts';
import {
  connectRoom,
  createRoom,
  joinRoom,
  waitFor,
  type JoinedStudent,
  type RoomClient,
} from './roomClient.ts';

/**
 * P6-consent-block: 동의 판이 지금 `POLICY_VERSION`과 다른 학생은 다시 동의하기 전에 새 글을 만들거나 제출하지 못한다.
 * 수업방 채널의 거절에는 `fields`가 실리지 않으므로(ack는 code·retryable만) 모양은 검사 함수 시험에서 본다.
 */
const START_CODE = '12345678';
const OLD_POLICY = '2000-01-old';

describe('assertConsentCurrent', () => {
  it('판이 다르거나 없으면 E_INPUT {consentVersion: outdated}, 같으면 통과', () => {
    expect(() => assertConsentCurrent('2026-11', '2026-11')).not.toThrow();
    for (const version of [OLD_POLICY, null, undefined]) {
      let caught: unknown;
      try {
        assertConsentCurrent(version, '2026-11');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect(caught).toMatchObject({ code: 'E_INPUT', fields: { consentVersion: 'outdated' } });
    }
  });
});

describe('동의 판이 지난 학생의 새 글·제출 막기(P6-consent-block)', () => {
  let t: TestServer;
  const clients: RoomClient[] = [];
  const connect = (roomId: string, credential: Parameters<typeof connectRoom>[2]) => {
    const c = connectRoom(t, roomId, credential);
    clients.push(c);
    return c;
  };
  const student = (roomId: string, s: JoinedStudent) =>
    connect(roomId, { kind: 'student', token: s.token, deviceId: s.deviceId });
  const row = <T>(sql: string, ...args: unknown[]) => t.server.db.prepare(sql).get(...args) as T;
  const docCount = (participantId: string) =>
    row<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE participant_id = ?', participantId).n;
  const outdate = (participantId: string) =>
    t.server.db
      .prepare('UPDATE participants SET consent_version = ? WHERE id = ?')
      .run(OLD_POLICY, participantId);

  /** 방 + 학생 하나 + 그 학생 글 하나(지금 판에 동의한 채로 만든다) */
  const classroom = async () => {
    const created = await createRoom(t, START_CODE);
    const s = await joinRoom(t, created.roomId, '하늘고래');
    const sc = student(created.roomId, s);
    await waitFor(() => sc.event('hello') !== undefined, 'hello');
    const ack = await sc.command('doc.create', { genre: 'story' });
    if (!ack.ok) throw new Error(`doc.create ${ack.error.code}`);
    return { created, s, sc, docId: (ack.data as { docId: string }).docId };
  };

  /** 정책 판이 바뀐 상황을 만들고 다시 연결한다(새로고침과 같음). */
  const reconnectOutdated = async (roomId: string, s: JoinedStudent, sc: RoomClient) => {
    outdate(s.participantId);
    sc.close();
    const again = student(roomId, s);
    await waitFor(() => again.event('hello') !== undefined, 'hello');
    expect(again.event('hello')?.data.me?.consentVersion).toBe(OLD_POLICY);
    return again;
  };

  const consentUpdate = (c: RoomClient) =>
    c.command('consent.update', { consentVersion: t.config.product.POLICY_VERSION });

  beforeAll(async () => {
    t = await startTestServer({
      TEACHER_START_CODE: START_CODE,
      SERVER_PERSIST_DEBOUNCE_MS: '50',
      SERVER_PERSIST_MAX_WAIT_MS: '200',
      SUMMARY_INTERVAL_MS: '50',
      ROOM_CREATE_PER_IP_PER_DAY: '1000',
    });
  });
  afterEach(() => {
    for (const c of clients.splice(0)) c.close();
  });
  afterAll(async () => {
    await t.close();
  });

  it('새 글 만들기: 재동의 전에는 E_INPUT으로 거절하고 글을 만들지 않으며, 같은 명령 ID도 재동의 뒤 받는다', async () => {
    const { created, s, sc } = await classroom();
    const again = await reconnectOutdated(created.roomId, s, sc);
    const before = docCount(s.participantId);

    const commandId = randomUUID();
    const blocked = await again.command('doc.create', { genre: 'story' }, commandId);
    expect(blocked).toMatchObject({ ok: false, error: { code: 'E_INPUT', retryable: false } });
    expect(docCount(s.participantId)).toBe(before);

    expect(await consentUpdate(again)).toMatchObject({ ok: true });
    // 거절은 멱등 기록에 남지 않으므로 같은 명령 ID로 다시 보내도 처리된다.
    const allowed = await again.command('doc.create', { genre: 'story' }, commandId);
    expect(allowed).toMatchObject({ ok: true, data: { docId: expect.any(String) } });
    expect(docCount(s.participantId)).toBe(before + 1);
  });

  it('제출: 재동의 전에는 E_INPUT으로 거절하고 제출 상태가 되지 않으며, 재동의 뒤 같은 명령으로 제출된다', async () => {
    const { created, s, sc, docId } = await classroom();
    const again = await reconnectOutdated(created.roomId, s, sc);
    const vector = bytesToBase64Url(Y.encodeStateVector(new Y.Doc()));
    const args = { docId, stateVector: vector, generation: 0 };

    const commandId = randomUUID();
    const blocked = await again.command('doc.submit', args, commandId);
    expect(blocked).toMatchObject({ ok: false, error: { code: 'E_INPUT', retryable: false } });
    expect(row<{ status: string }>('SELECT status FROM documents WHERE id = ?', docId).status).toBe('DRAFT');
    expect(
      row<{ n: number }>(
        "SELECT COUNT(*) AS n FROM snapshots WHERE document_id = ? AND reason = 'SUBMIT'",
        docId,
      ).n,
    ).toBe(0);

    expect(await consentUpdate(again)).toMatchObject({ ok: true });
    const allowed = await again.command('doc.submit', args, commandId);
    expect(allowed).toMatchObject({ ok: true, data: { status: 'SUBMITTED' } });
    expect(row<{ status: string }>('SELECT status FROM documents WHERE id = ?', docId).status).toBe(
      'SUBMITTED',
    );
  });

  it('교사는 동의 대상이 아니다: 학생 동의 판이 지나도 다시 쓰게 하기를 그대로 한다', async () => {
    const { created, s, sc, docId } = await classroom();
    const vector = bytesToBase64Url(Y.encodeStateVector(new Y.Doc()));
    expect(await sc.command('doc.submit', { docId, stateVector: vector, generation: 0 })).toMatchObject({
      ok: true,
    });
    outdate(s.participantId);
    const tc = connect(created.roomId, { kind: 'teacher', token: created.linkToken, deviceId: randomUUID() });
    await waitFor(() => tc.event('hello') !== undefined, '교사 hello');
    expect(await tc.command('doc.reopen', { docId })).toMatchObject({
      ok: true,
      data: { status: 'REOPENED', generation: 1 },
    });
  });
});
