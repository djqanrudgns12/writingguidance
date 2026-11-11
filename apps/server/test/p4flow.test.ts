import { createHash, randomUUID } from 'node:crypto';
import { bytesToBase64Url } from '@geulbang/core';
import { defaultConfig } from '@geulbang/core/config';
import type { RoomEventData, RoomEventName } from '@geulbang/core/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createFakeAi, type FakeAiOptions } from '../src/ai/fake.ts';
import type { AiPort } from '../src/ai/port.ts';
import { paths } from '../src/config.ts';
import { createTimerScheduler } from '../src/jobs/timers.ts';
import { createMemoryLogger } from '../src/log.ts';
import type { RealtimeContext } from '../src/realtime/context.ts';
import type { RoomEvents } from '../src/realtime/roomEvents.ts';
import { openDatabase } from '../src/store/db.ts';
import { migrate } from '../src/store/migrate.ts';
import { createRepos } from '../src/store/repos/index.ts';
import { startTestServer, type TestServer } from './helpers.ts';
import {
  api,
  bearer,
  connectRoom,
  createRoom,
  joinRoom,
  newToken,
  waitFor,
  type JoinedStudent,
  type RoomClient,
} from './roomClient.ts';

/**
 * P4 서버 기능 통합 시험(PLAN §10.4 중 P4 범위): 제출·다시 쓰게 하기·잠금, AI(가짜), 교사 PIN, 이어 쓰기, 알림·타이머·
 * 스냅샷, 수업방 설정·닫기·삭제, 내려받기·만료. 신뢰성 시험(제출 ack 유실 뒤 옛 제출, 동기화 전 제출, 허용 응답 유실,
 * AI 동시 요청과 한도, 만료 삭제와 저장 재시도 겹침, 잠금 중 편집 거부 → 해제 뒤 재동기화)을 함께 둔다.
 */
const START_CODE = '12345678';
const ALL_BUTTONS = ['SPELL', 'FEEDBACK', 'DIRECTION', 'POLISH'];
const LONG_TEXT = '오늘은 비가 와서 우산을 쓰고 학교에 갔다. 친구와 함께 걸었다.';

/** 시험마다 다른 대답을 하게 바꿔 끼우는 가짜 AI */
let fake = createFakeAi();
const ai = new Proxy({} as AiPort, { get: (_target, key) => Reflect.get(fake, key) as unknown });
const useFake = (options: FakeAiOptions = {}) => {
  fake = createFakeAi(options);
  return fake;
};

describe('P4 서버 기능', () => {
  let t: TestServer;
  const clients: RoomClient[] = [];
  const room = (roomId: string, credential: Parameters<typeof connectRoom>[2]) => {
    const c = connectRoom(t, roomId, credential);
    clients.push(c);
    return c;
  };
  const student = (roomId: string, s: JoinedStudent) =>
    room(roomId, { kind: 'student', token: s.token, deviceId: s.deviceId });
  const teacher = (roomId: string, linkToken: string) =>
    room(roomId, { kind: 'teacher', token: linkToken, deviceId: randomUUID() });
  const serverText = (docId: string) =>
    t.server.hocuspocus.documents.get(`doc:${docId}`)?.getText('body').toString();
  const row = <T>(sql: string, ...args: unknown[]) => t.server.db.prepare(sql).get(...args) as T;

  /** 방 + 교사 연결 + 학생 하나(연결) + 그 학생 글 하나 */
  const classroom = async (nickname = '하늘고래', overrides: Record<string, unknown> = {}) => {
    const created = await createRoom(t, START_CODE, { aiButtons: ALL_BUTTONS, ...overrides });
    const s = await joinRoom(t, created.roomId, nickname);
    const sc = student(created.roomId, s);
    const tc = teacher(created.roomId, created.linkToken);
    await waitFor(() => sc.event('hello') !== undefined && tc.event('hello') !== undefined, 'hello');
    const ack = await sc.command('doc.create', { genre: 'story' });
    if (!ack.ok) throw new Error(`doc.create ${ack.error.code}`);
    return { created, s, sc, tc, docId: (ack.data as { docId: string }).docId };
  };

  beforeAll(async () => {
    t = await startTestServer(
      {
        TEACHER_START_CODE: START_CODE,
        SERVER_PERSIST_DEBOUNCE_MS: '50',
        SERVER_PERSIST_MAX_WAIT_MS: '200',
        SNAPSHOT_INTERVAL_SEC: '1',
        SUMMARY_INTERVAL_MS: '50',
        HEARTBEAT_SEC: '1',
        CLIENT_STALE_SEC: '2',
        OFFLINE_AFTER_SEC: '1',
        ROOM_CREATE_PER_IP_PER_DAY: '1000',
        AI_DAILY_PER_PARTICIPANT: '2',
        AI_SPELL_CHUNK_CHARS: '40',
      },
      { ai },
    );
  });
  afterEach(() => {
    for (const c of clients.splice(0)) c.close();
    useFake();
  });
  afterAll(async () => {
    await t.close();
  });

  describe('P4-3 제출·다시 쓰게 하기·잠금', () => {
    it('제출하면 학생 연결만 잠기고, 잠긴 동안의 편집은 기기에 남았다가 다시 쓰게 하기 뒤 합쳐진다', async () => {
      const { sc, tc, docId } = await classroom();
      const d = sc.openDoc(docId);
      const drawer = tc.openDoc(docId);
      await waitFor(() => d.provider.isSynced && drawer.provider.isSynced, '동기화');
      d.doc.getText('body').insert(0, '오늘은 비가 왔다');
      await waitFor(
        () => d.provider.unsyncedChanges === 0 && serverText(docId) === '오늘은 비가 왔다',
        '보냄',
      );
      const vector = bytesToBase64Url(Y.encodeStateVector(d.doc));

      const ack = await sc.command('doc.submit', { docId, stateVector: vector, generation: 0 });
      expect(ack).toMatchObject({ ok: true, data: { status: 'SUBMITTED', submittedAt: expect.any(Number) } });
      await waitFor(() => d.events.some(e => e.name === 'doc.status' && e.data.locked), '학생 잠김');
      expect(drawer.events.find(e => e.name === 'doc.status')?.data).toMatchObject({ locked: false });
      await waitFor(
        () =>
          tc.events.some(e => e.name === 'doc.status' && e.data.docId === docId && e.data.generation === 0),
        '교사에게 doc.status',
      );
      expect(sc.event('doc.status')?.data).toMatchObject({ docId, status: 'SUBMITTED', generation: 0 });
      expect(
        row<{ status: string; plain_text: string }>(
          'SELECT status, plain_text FROM documents WHERE id = ?',
          docId,
        ),
      ).toEqual({ status: 'SUBMITTED', plain_text: '오늘은 비가 왔다' });
      expect(
        row<{ n: number }>(
          "SELECT COUNT(*) AS n FROM snapshots WHERE document_id = ? AND reason = 'SUBMIT'",
          docId,
        ).n,
      ).toBe(1);

      // 잠긴 동안: 학생 편집은 서버에 들어가지 않고 기기에 남는다. 교사는 계속 고친다(ADR-048).
      d.doc.getText('body').insert(0, '추가 ');
      drawer.doc.getText('body').insert(drawer.doc.getText('body').length, '!');
      await waitFor(() => d.doc.getText('body').toString().endsWith('!'), '교사 편집은 학생에게');
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(serverText(docId)).toBe('오늘은 비가 왔다!');
      expect(d.provider.unsyncedChanges).toBeGreaterThan(0);

      const reopen = await tc.command('doc.reopen', { docId });
      expect(reopen).toMatchObject({ ok: true, data: { status: 'REOPENED', generation: 1 } });
      await waitFor(() => d.events.some(e => e.name === 'doc.status' && !e.data.locked), '풀림');
      d.provider.forceSync();
      await waitFor(() => serverText(docId) === '추가 오늘은 비가 왔다!', '풀린 뒤 합쳐짐');

      // 신뢰성: 제출 ack가 사라진 뒤 교사가 다시 열었으면, 늦게 온 옛 제출은 다시 잠그지 못한다.
      expect(await sc.command('doc.submit', { docId, stateVector: vector, generation: 0 })).toMatchObject({
        ok: false,
        error: { code: 'E_STALE', retryable: false },
      });
      // 신뢰성: 서버가 기기의 변경을 다 받기 전 제출은 E_SYNC_PENDING(기기가 잠시 뒤 다시 보냄)
      const ahead = new Y.Doc();
      ahead.getText('body').insert(0, '아직 안 보낸 글');
      expect(
        await sc.command('doc.submit', {
          docId,
          stateVector: bytesToBase64Url(Y.encodeStateVector(ahead)),
          generation: 1,
        }),
      ).toMatchObject({ ok: false, error: { code: 'E_SYNC_PENDING', retryable: true } });
      expect(row<{ status: string }>('SELECT status FROM documents WHERE id = ?', docId).status).toBe(
        'REOPENED',
      );
      // 교사는 제출 명령을 보낼 수 없다
      expect(await tc.command('doc.submit', { docId, stateVector: vector, generation: 1 })).toMatchObject({
        error: { code: 'E_FORBIDDEN' },
      });
    });
  });

  describe('P4-16 AI 요청(가짜 AI)', () => {
    const aiBody = (docId: string, button: string, text = LONG_TEXT) => ({
      docId,
      button,
      text,
      range: 'ALL',
      meta: { helpNotes: [{ questionId: 'story_who', note: '나와 친구' }] },
      commandId: randomUUID(),
    });
    const call = (roomId: string, token: string, body: unknown) =>
      api(t, 'POST', `/api/rooms/${roomId}/ai`, body, bearer(token));

    it('구조화 결과·같은 commandId 재전송·쿨다운·입력 검사·AI 스냅샷', async () => {
      const { created, s, docId } = await classroom();
      const body = aiBody(docId, 'FEEDBACK');
      const res = await call(created.roomId, s.token, body);
      expect(res.status).toBe(200);
      expect(res.json.commandId).toBe(body.commandId);
      expect(res.json.data).toMatchObject({
        button: 'FEEDBACK',
        result: { praise: expect.any(String) },
        receivedAt: expect.any(Number),
        textHash: createHash('sha256').update(LONG_TEXT).digest('hex'),
      });
      expect(
        row<{ status: string }>('SELECT status FROM ai_usage WHERE command_id = ?', body.commandId).status,
      ).toBe('OK');
      expect(
        row<{ n: number }>(
          "SELECT COUNT(*) AS n FROM snapshots WHERE document_id = ? AND reason = 'AI'",
          docId,
        ).n,
      ).toBe(1);

      const calls = fake.calls.length;
      const replay = await call(created.roomId, s.token, body);
      expect(replay.json.data).toEqual(res.json.data);
      expect(fake.calls.length).toBe(calls); // 다시 부르지 않음

      expect((await call(created.roomId, s.token, aiBody(docId, 'FEEDBACK'))).json.error?.code).toBe(
        'E_AI_COOLDOWN',
      );
      expect(
        (await call(created.roomId, s.token, aiBody(docId, 'DIRECTION', '짧음'))).json.error,
      ).toMatchObject({
        code: 'E_INPUT',
        fields: { text: 'too_short' },
      });
      expect((await call(created.roomId, 'z'.repeat(43), aiBody(docId, 'DIRECTION'))).status).toBe(401);
      const other = await joinRoom(t, created.roomId, '별빛');
      expect((await call(created.roomId, other.token, aiBody(docId, 'DIRECTION'))).json.error?.code).toBe(
        'E_FORBIDDEN',
      );
    });

    it('꺼진 버튼은 E_FORBIDDEN, 맞춤법은 문단 조각으로 나눠 합친다', async () => {
      const { created, s, docId } = await classroom('바다', { aiButtons: ['SPELL'] });
      expect((await call(created.roomId, s.token, aiBody(docId, 'FEEDBACK'))).json.error?.code).toBe(
        'E_FORBIDDEN',
      );
      const text = [
        '첫째 문단에서 되요 라고 썼다.',
        '둘째 문단에서도 되요 라고 썼고',
        '셋째에는 할수 있다.',
      ].join('\n');
      const res = await call(created.roomId, s.token, aiBody(docId, 'SPELL', text));
      expect(res.status).toBe(200);
      const items = (res.json.data?.['result'] as { items: Array<{ original: string }> }).items;
      expect(items.map(i => i.original)).toEqual(['되요', '되요', '할수']);
      expect(fake.calls.filter(c => c.button === 'SPELL').length).toBeGreaterThan(1); // AI_SPELL_CHUNK_CHARS=40
    });

    it('다듬은 글은 NDJSON 줄로 오고 끝나면 정산한다', async () => {
      const { created, s, docId } = await classroom('솜사탕');
      const body = aiBody(docId, 'POLISH', `${LONG_TEXT} 그래도 되요.`);
      const res = await fetch(`${t.server.url}/api/rooms/${created.roomId}/ai`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearer(s.token) },
        body: JSON.stringify(body),
      });
      expect(res.headers.get('content-type')).toContain('application/x-ndjson');
      const lines = (await res.text())
        .trim()
        .split('\n')
        .map(l => JSON.parse(l) as { t: string; d?: string });
      expect(lines.at(-1)).toEqual({ t: 'done', stop: 'end' });
      expect(
        lines
          .filter(l => l.t === 'text')
          .map(l => l.d)
          .join(''),
      ).toBe(`${LONG_TEXT} 그래도 돼요.`);
      await waitFor(
        () =>
          row<{ status: string }>('SELECT status FROM ai_usage WHERE command_id = ?', body.commandId)
            .status === 'OK',
        '정산',
      );
    });

    it('신뢰성: 다듬은 글 도중 기기가 끊으면 제공사 호출을 멈추고 REFUNDED로 정산한다', async () => {
      useFake({ delayMs: 3000 });
      const { created, s, docId } = await classroom('끊김');
      const body = aiBody(docId, 'POLISH');
      const controller = new AbortController();
      const pending = fetch(`${t.server.url}/api/rooms/${created.roomId}/ai`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearer(s.token) },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
        .then(res => res.text())
        .catch(() => null);
      const status = () =>
        (
          t.server.db.prepare('SELECT status FROM ai_usage WHERE command_id = ?').get(body.commandId) as
            { status: string } | undefined
        )?.status;
      await waitFor(() => status() === 'RESERVED', '예약');
      controller.abort();
      await pending;
      await waitFor(() => status() === 'REFUNDED', '중단 뒤 정산', 2500); // 가짜 AI의 3초 지연보다 먼저
    });

    it('신뢰성: 동시 요청이 하루 한도를 넘지 않는다(예약은 한 트랜잭션)', async () => {
      useFake({ delayMs: 100 });
      const { created, s, docId } = await classroom('초코');
      const results = await Promise.all(
        ['SPELL', 'FEEDBACK', 'DIRECTION'].map(b => call(created.roomId, s.token, aiBody(docId, b))),
      );
      const codes = results.map(r => (r.status === 200 ? 'OK' : r.json.error?.code)).sort();
      expect(codes).toEqual(['E_AI_LIMIT', 'OK', 'OK']); // AI_DAILY_PER_PARTICIPANT=2
      expect(fake.calls.length).toBe(2);
    });

    it('제공사 오류는 대체 모델까지 해 보고, 실패하면 REFUNDED로 한도에서 뺀다', async () => {
      useFake({ script: [{ fail: 'transient' }, { fail: 'transient' }] });
      const { created, s, docId } = await classroom('구름');
      const day = (
        t.server.db
          .prepare("SELECT COALESCE(SUM(count), 0) AS n FROM ai_daily WHERE scope = 'GLOBAL'")
          .get() as {
          n: number;
        }
      ).n;
      const body = aiBody(docId, 'DIRECTION');
      const res = await call(created.roomId, s.token, body);
      expect(res.json.error).toMatchObject({ code: 'E_AI_PROVIDER', retryable: true });
      expect(fake.calls.map(c => c.model)).toEqual([
        t.config.product.MODEL_DIRECTION,
        t.config.product.MODEL_FALLBACK,
      ]);
      expect(
        row<{ status: string }>('SELECT status FROM ai_usage WHERE command_id = ?', body.commandId).status,
      ).toBe('REFUNDED');
      const after = (
        t.server.db
          .prepare("SELECT COALESCE(SUM(count), 0) AS n FROM ai_daily WHERE scope = 'GLOBAL'")
          .get() as {
          n: number;
        }
      ).n;
      expect(after).toBe(day);
    });

    it('교사 연결 점검(check-ai)', async () => {
      const { created } = await classroom('별');
      const res = await api(
        t,
        'POST',
        `/api/teacher/rooms/${created.roomId}/check-ai`,
        {},
        bearer(created.linkToken),
      );
      expect(res.json.data).toEqual({ ok: true, latencyMs: expect.any(Number) });
    });
  });

  describe('P4-5 교사 들어오기', () => {
    it('PIN으로 들어가 세션 토큰을 받고, 방 정보·PIN 보기·실시간 연결을 쓴다', async () => {
      const created = await createRoom(t, START_CODE);
      const session = newToken();
      const deviceId = randomUUID();
      const res = await api(t, 'POST', '/api/teacher/pin', {
        pin: created.body['pin'],
        deviceId,
        sessionTokenHash: session.hash,
        commandId: randomUUID(),
      });
      expect(res.json.data).toEqual({ roomId: created.roomId });

      const info = await api(
        t,
        'GET',
        `/api/teacher/rooms/${created.roomId}`,
        undefined,
        bearer(session.token),
      );
      expect(info.json.data).toMatchObject({
        room: {
          id: created.roomId,
          className: '5학년 3반',
          status: 'ACTIVE',
          aiButtons: ['SPELL', 'FEEDBACK'],
        },
        entryCode: created.entryCode,
        shortUrl: `${new URL(t.config.product.PUBLIC_ORIGIN).host}/${created.entryCode}`,
      });
      const pin = await api(
        t,
        'GET',
        `/api/teacher/rooms/${created.roomId}/pin`,
        undefined,
        bearer(session.token),
      );
      expect(pin.json.data).toEqual({ pin: created.body['pin'] });
      expect(pin.headers.get('cache-control')).toBe('no-store');

      const tc = room(created.roomId, { kind: 'teacher', token: session.token, deviceId });
      const elsewhere = room(created.roomId, {
        kind: 'teacher',
        token: session.token,
        deviceId: randomUUID(),
      });
      await waitFor(() => tc.event('hello') !== undefined && elsewhere.failures.length > 0, 'PIN 세션 연결');
      expect(elsewhere.failures).toEqual(['E_AUTH']); // PIN 세션은 그 기기에만 묶인다

      const otherRoom = await createRoom(t, START_CODE);
      expect(
        (await api(t, 'GET', `/api/teacher/rooms/${otherRoom.roomId}`, undefined, bearer(session.token)))
          .status,
      ).toBe(403);
    });

    it('틀린 PIN은 E_PIN_INVALID, 기기에서 PIN_MAX_FAILS번이면 잠긴다', async () => {
      const deviceId = randomUUID();
      const attempt = () =>
        api(t, 'POST', '/api/teacher/pin', {
          pin: '99999991',
          deviceId,
          sessionTokenHash: newToken().hash,
          commandId: randomUUID(),
        });
      for (let i = 0; i < t.config.product.PIN_MAX_FAILS; i++) {
        expect((await attempt()).json.error?.code).toBe('E_PIN_INVALID');
      }
      const locked = await attempt();
      expect(locked.status).toBe(429);
      expect(locked.json.error?.code).toBe('E_PIN_LOCKED');
    });
  });

  describe('P4-4 이어 쓰기', () => {
    const request = (roomId: string, nickname: string) => {
      const token = newToken();
      const deviceId = randomUUID();
      const body = { nickname, deviceId, deviceTokenHash: token.hash, commandId: randomUUID() };
      return {
        token,
        deviceId,
        body,
        send: () => api(t, 'POST', `/api/rooms/${roomId}/resume-requests`, body),
      };
    };
    const poll = (roomId: string, requestId: string, token: string, wait = 0) =>
      api(
        t,
        'GET',
        `/api/rooms/${roomId}/resume-requests/${requestId}?wait=${wait}`,
        undefined,
        bearer(token),
      );

    it('요청 → 교사 허용 → 기다리던 조회가 바로 답하고, 새 기기로 그 글이 이어진다', async () => {
      const { created, s, tc, docId } = await classroom('하늘');
      const r = request(created.roomId, ' 하늘 ');
      const sent = await r.send();
      const requestId = String(sent.json.data?.['requestId']);
      await waitFor(() => tc.event('resume.pending') !== undefined, 'resume.pending');
      expect(tc.event('resume.pending')?.data).toEqual([
        { requestId, participantId: s.participantId, nickname: '하늘', requestedAt: expect.any(Number) },
      ]);
      expect((await r.send()).json.data).toEqual({ requestId }); // 같은 commandId
      expect((await poll(created.roomId, requestId, r.token.token)).json.data).toEqual({ status: 'PENDING' });
      expect((await poll(created.roomId, requestId, newToken().token)).json.error?.code).toBe('E_AUTH');

      // 늦게 들어온 교사는 hello에서 본다
      const late = teacher(created.roomId, created.linkToken);
      await waitFor(() => late.event('hello') !== undefined, 'hello');
      expect(late.event('hello')?.data.pendingResumes?.map(x => x.requestId)).toEqual([requestId]);

      const started = Date.now();
      const waiting = poll(created.roomId, requestId, r.token.token, 15);
      await new Promise(resolve => setTimeout(resolve, 150)); // 앞 조회가 먼저 서버에 등록되게
      // 한 요청에 조회가 겹치면 앞의 것을 바로 끝낸다
      const overlapped = poll(created.roomId, requestId, r.token.token, 15);
      expect((await waiting).json.data).toEqual({ status: 'PENDING' });
      const decided = await tc.command('resume.decide', { requestId, approve: true });
      expect(decided).toMatchObject({ ok: true, data: { decided: 1 } });
      expect((await overlapped).json.data).toEqual({ status: 'APPROVED' });
      expect(Date.now() - started).toBeLessThan(5000);
      await waitFor(() => tc.events.some(e => e.name === 'resume.decided'), 'resume.decided');

      // 신뢰성: 허용 응답이 사라져도 다음 조회·실시간 연결로 바로 이어진다(서버가 토큰을 건네지 않음)
      expect((await poll(created.roomId, requestId, r.token.token)).json.data).toEqual({
        status: 'APPROVED',
      });
      const newDevice = room(created.roomId, { kind: 'student', token: r.token.token, deviceId: r.deviceId });
      await waitFor(() => newDevice.event('hello') !== undefined, '새 기기 hello');
      expect(newDevice.event('hello')?.data.me?.participantId).toBe(s.participantId);
      expect(newDevice.event('hello')?.data.docs.map(x => x.docId)).toEqual([docId]);

      // 기기 목록·끊기: 끊긴 기기의 연결은 닫히고 다시 붙으면 E_AUTH
      const list = await tc.command('device.list', { participantId: s.participantId });
      const devices = (list.ok ? list.data : []) as Array<{ deviceRowId: string; connected: boolean }>;
      expect(devices).toHaveLength(2);
      const newRow = t.server.db.prepare('SELECT id FROM devices WHERE device_id = ?').get(r.deviceId) as {
        id: string;
      };
      expect(await tc.command('device.revoke', { deviceRowId: newRow.id })).toMatchObject({
        data: { revoked: 1 },
      });
      await waitFor(
        () =>
          !t.server.hocuspocus.documents
            .get(`room:${created.roomId}`)
            ?.getConnections()
            .some(c => {
              const a = (c.context as RealtimeContext).actor;
              return a?.kind === 'student' && a.deviceRowId === newRow.id;
            }),
        '끊긴 기기 연결 닫힘',
      );
      const again = room(created.roomId, { kind: 'student', token: r.token.token, deviceId: r.deviceId });
      await waitFor(() => again.failures.length > 0, '끊긴 기기 거부');
      expect(again.failures).toEqual(['E_AUTH']);
    }, 15_000);

    it('거절·취소·모두 허용, 없는 별명은 E_INPUT', async () => {
      const { created, tc } = await classroom('가람');
      await joinRoom(t, created.roomId, '나래');
      expect((await request(created.roomId, '없는이름').send()).json.error).toMatchObject({
        code: 'E_INPUT',
        fields: { nickname: 'unknown' },
      });
      const a = request(created.roomId, '가람');
      const aId = String((await a.send()).json.data?.['requestId']);
      expect(await tc.command('resume.decide', { requestId: aId, approve: false })).toMatchObject({
        data: { decided: 1 },
      });
      expect((await poll(created.roomId, aId, a.token.token)).json.data).toEqual({ status: 'REJECTED' });
      // 이미 결정된 요청은 다시 결정되지 않는다(먼저 온 결정이 이김)
      expect(await tc.command('resume.decide', { requestId: aId, approve: true })).toMatchObject({
        data: { decided: 0 },
      });

      const b = request(created.roomId, '가람');
      const bId = String((await b.send()).json.data?.['requestId']);
      const cancel = await api(
        t,
        'DELETE',
        `/api/rooms/${created.roomId}/resume-requests/${bId}`,
        undefined,
        bearer(b.token.token),
      );
      expect(cancel.json.data).toEqual({ status: 'CANCELLED' });
      await waitFor(
        () =>
          tc.events.some(
            e => e.name === 'resume.decided' && e.data.requestId === bId && e.data.status === 'CANCELLED',
          ),
        '취소 알림',
      );

      const c1 = request(created.roomId, '가람');
      const c2 = request(created.roomId, '나래');
      await c1.send();
      await c2.send();
      expect(await tc.command('resume.decide', { all: true, approve: true })).toMatchObject({
        data: { decided: 2 },
      });
      expect(
        row<{ n: number }>(
          "SELECT COUNT(*) AS n FROM resume_requests WHERE room_id = ? AND status = 'PENDING'",
          created.roomId,
        ).n,
      ).toBe(0);
    });
  });

  describe('P4-6 알림·타이머·스냅샷', () => {
    it('알림은 학생에게만, 다시 연결하면 최근 알림을 hello에서 본다', async () => {
      const { created, s, sc, tc } = await classroom('알림이');
      const ack = await tc.command('notice.send', { text: '제출해 주세요' });
      expect(ack).toMatchObject({ ok: true, data: { noticeId: expect.any(String) } });
      await waitFor(() => sc.event('notice') !== undefined, 'notice');
      expect(sc.event('notice')?.data).toMatchObject({ text: '제출해 주세요', kind: 'MANUAL', sound: false });
      expect(tc.events.some(e => e.name === 'notice')).toBe(false);
      const again = student(created.roomId, s);
      await waitFor(() => again.event('hello') !== undefined, 'hello');
      expect(again.event('hello')?.data.recentNotices.map(n => n.text)).toEqual(['제출해 주세요']);
      expect(await sc.command('notice.send', { text: '안녕' })).toMatchObject({
        error: { code: 'E_FORBIDDEN' },
      });
    });

    it('타이머 시작·멈춤·계속·취소가 모두에게 같은 시각으로 간다', async () => {
      const { sc, tc } = await classroom('시계');
      const start = await tc.command('timer.start', {
        durationSec: 300,
        alerts: [5, 1],
        endText: '끝났어요',
      });
      expect(start.ok && (start.data as { timer: { alerts: number[] } }).timer.alerts).toEqual([1]); // 5분 전은 꺼짐
      await waitFor(() => sc.event('timer')?.data.status === 'RUNNING', 'RUNNING');
      expect(sc.event('timer')?.data.endsAt).toBeGreaterThan(Date.now());
      await tc.command('timer.pause', {});
      await waitFor(() => sc.event('timer')?.data.status === 'PAUSED', 'PAUSED');
      expect(sc.event('timer')?.data.remainingMs).toBeGreaterThan(0);
      await tc.command('timer.resume', {});
      await waitFor(() => sc.event('timer')?.data.status === 'RUNNING', '다시 RUNNING');
      await tc.command('timer.cancel', {});
      await waitFor(() => sc.event('timer')?.data.status === 'IDLE', 'IDLE');
    });

    it('시간 되감기: 목록·보기·복원(RESTORE를 먼저 남김), 남의 글·잠긴 글은 막는다', async () => {
      const { created, sc, tc, docId } = await classroom('되감기');
      const d = sc.openDoc(docId);
      await waitFor(() => d.provider.isSynced, '동기화');
      d.doc.getText('body').insert(0, '첫 글');
      await waitFor(
        () => row<{ n: number }>('SELECT COUNT(*) AS n FROM snapshots WHERE document_id = ?', docId).n === 1,
        'AUTO',
      );
      d.doc.getText('body').insert(2, '바뀐 ');
      await waitFor(() => serverText(docId) === '첫 바뀐 글', '바뀜');

      const list = await sc.command('snapshot.list', { docId });
      const items = (list.ok ? list.data : []) as Array<{ id: string; reason: string; chars: number }>;
      expect(items[0]).toMatchObject({ reason: 'AUTO', author: 'STUDENT', chars: 3 });
      const target = items[0]?.id ?? '';
      expect(await sc.command('snapshot.get', { docId, snapshotId: target })).toMatchObject({
        data: { title: '', body: '첫 글' },
      });
      expect(await tc.command('snapshot.restore', { docId, snapshotId: target })).toMatchObject({
        data: { body: '첫 글' },
      });
      const restore = row<{ body_text: string; author: string }>(
        "SELECT body_text, author FROM snapshots WHERE document_id = ? AND reason = 'RESTORE'",
        docId,
      );
      expect(restore).toEqual({ body_text: '첫 바뀐 글', author: 'TEACHER' });

      const other = await joinRoom(t, created.roomId, '남');
      const oc = student(created.roomId, other);
      await waitFor(() => oc.event('hello') !== undefined, 'hello');
      expect(await oc.command('snapshot.list', { docId })).toMatchObject({ error: { code: 'E_FORBIDDEN' } });
      t.server.db.prepare("UPDATE documents SET status = 'SUBMITTED' WHERE id = ?").run(docId);
      expect(await sc.command('snapshot.restore', { docId, snapshotId: target })).toMatchObject({
        error: { code: 'E_DOC_LOCKED' },
      });
    });
  });

  describe('P4-7 수업방 설정·닫기·삭제', () => {
    it('설정을 바꾸면 모두에게, 닫으면 학생 글이 읽기 전용, 다시 열면 풀린다', async () => {
      const { created, sc, tc, docId } = await classroom('설정');
      const d = sc.openDoc(docId);
      await waitFor(() => d.provider.isSynced, '동기화');
      const update = await tc.command('room.update', { aiButtons: ['SPELL'], sound: true });
      expect(update).toMatchObject({ data: { settings: { aiButtons: ['SPELL'], sound: true } } });
      await waitFor(() => sc.event('room.settings')?.data.settings.sound === true, 'room.settings');
      expect(await tc.command('room.update', { genres: ['dance'] })).toMatchObject({
        error: { code: 'E_INPUT' },
      });

      expect(await tc.command('room.close', {})).toMatchObject({ data: { status: 'CLOSED' } });
      await waitFor(() => sc.event('room.status')?.data.status === 'CLOSED', 'room.status');
      await waitFor(() => d.events.some(e => e.name === 'doc.status' && e.data.locked), '학생 글 잠김');
      expect(await sc.command('doc.create', { genre: 'poem' })).toMatchObject({
        error: { code: 'E_ROOM_CLOSED' },
      });
      expect((await joinRoom(t, created.roomId, '늦음')).res.json.error?.code).toBe('E_ROOM_CLOSED');

      expect(await tc.command('room.reopen', {})).toMatchObject({ data: { status: 'ACTIVE' } });
      await waitFor(() => d.events.some(e => e.name === 'doc.status' && !e.data.locked), '풀림');
      d.doc.getText('body').insert(0, '다시 씀');
      await waitFor(() => serverText(docId) === '다시 씀', '다시 열린 뒤 씀');
    });

    it('지금 삭제: ack 뒤 room.status DELETED, 모든 행이 사라지고 다시 연결할 수 없다', async () => {
      const { created, s, sc, tc, docId } = await classroom('삭제');
      const d = sc.openDoc(docId);
      await waitFor(() => d.provider.isSynced, '동기화');
      d.doc.getText('body').insert(0, '지워질 글');
      const ack = await tc.command('room.delete', {});
      expect(ack.ok).toBe(true);
      await waitFor(() => sc.event('room.status')?.data.status === 'DELETED', 'DELETED');
      await waitFor(
        () => row<unknown>('SELECT id FROM rooms WHERE id = ?', created.roomId) === undefined,
        '행 삭제',
      );
      for (const table of ['participants', 'documents', 'teacher_sessions', 'commands']) {
        expect(
          row<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE room_id = ?`, created.roomId).n,
        ).toBe(0);
      }
      expect(row<{ n: number }>('SELECT COUNT(*) AS n FROM snapshots WHERE document_id = ?', docId).n).toBe(
        0,
      );
      await waitFor(() => !t.server.hocuspocus.documents.has(`doc:${docId}`), '메모리에서 내림');
      const again = student(created.roomId, s);
      await waitFor(() => again.failures.length > 0, '거부');
      expect(again.failures).toEqual(['E_AUTH']);
    });
  });

  describe('P4-8 내려받기·만료', () => {
    it('내려받기는 열린 글의 지금 내용을, 제출한 글만 고를 수 있다', async () => {
      const { created, sc, docId } = await classroom('내려받기');
      const d = sc.openDoc(docId);
      await waitFor(() => d.provider.isSynced, '동기화');
      d.doc.getText('title').insert(0, '비 오는 날');
      d.doc.getText('body').insert(0, '빗소리가 좋았다');
      await waitFor(() => serverText(docId) === '빗소리가 좋았다', '서버 도착');
      const path = `/api/teacher/rooms/${created.roomId}/export`;
      const all = await api(t, 'GET', `${path}?scope=all`, undefined, bearer(created.linkToken));
      expect(all.json.data).toEqual({
        room: { className: '5학년 3반', title: '시험 수업', schoolName: null },
        docs: [
          {
            nickname: '내려받기',
            genre: 'story',
            subtype: null,
            purpose: null,
            title: '비 오는 날',
            body: '빗소리가 좋았다',
            status: 'DRAFT',
            submittedAt: null,
            charCount: 8,
          },
        ],
      });
      const submitted = await api(t, 'GET', `${path}?scope=submitted`, undefined, bearer(created.linkToken));
      expect(submitted.json.data?.['docs']).toEqual([]);
      expect((await api(t, 'GET', path, undefined, bearer(created.linkToken))).json.error?.code).toBe(
        'E_INPUT',
      );
    });

    it('만료된 방은 정리 작업이 지우고, 저장 재시도와 겹쳐도 글을 되살리지 않는다', async () => {
      const { created, sc, docId } = await classroom('만료');
      const d = sc.openDoc(docId);
      await waitFor(() => d.provider.isSynced, '동기화');
      t.server.db.exec(
        `CREATE TRIGGER fail_${docId.replaceAll('-', '')} BEFORE UPDATE ON documents WHEN NEW.id = '${docId}'
         BEGIN SELECT RAISE(ABORT, 'disk'); END`,
      );
      try {
        const retries = t.log.lines.filter(l => l['event'] === 'store_retry').length;
        d.doc.getText('body').insert(0, '저장이 실패하는 글');
        await waitFor(
          () => t.log.lines.filter(l => l['event'] === 'store_retry').length > retries,
          '저장 재시도 중',
        );

        t.server.db
          .prepare('UPDATE rooms SET expires_at = ? WHERE id = ?')
          .run(Date.now() - 1, created.roomId);
        await t.server.retention.runOnce();
        await waitFor(() => sc.event('room.status')?.data.status === 'EXPIRED', 'EXPIRED');
        expect(row<unknown>('SELECT id FROM rooms WHERE id = ?', created.roomId)).toBeUndefined();
        await waitFor(
          () => t.server.realtime.persistence.failedCount() === 0,
          '저장 실패 목록에서 빠짐',
          6000,
        );
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(row<unknown>('SELECT id FROM documents WHERE id = ?', docId)).toBeUndefined();
        expect((await fetch(`${t.server.url}/internal/health`)).status).toBe(200);
      } finally {
        t.server.db.exec(`DROP TRIGGER IF EXISTS fail_${docId.replaceAll('-', '')}`);
      }
    }, 15_000);
  });

  describe('교사 참가자 목록(hello.participants·participant.update)', () => {
    it('글이 없는 참가자도 보이고, 접속하면 상태가 바뀐다', async () => {
      const created = await createRoom(t, START_CODE);
      const s = await joinRoom(t, created.roomId, '새싹');
      const tc = teacher(created.roomId, created.linkToken);
      await waitFor(() => tc.event('hello') !== undefined, 'hello');
      expect(tc.event('hello')?.data.participants).toEqual([
        {
          participantId: s.participantId,
          nickname: '새싹',
          presence: 'OFFLINE',
          joinedAt: expect.any(Number),
        },
      ]);
      student(created.roomId, s);
      await waitFor(
        () =>
          tc.events.some(
            e =>
              e.name === 'participant.update' &&
              e.data.participantId === s.participantId &&
              e.data.presence === 'WRITING',
          ),
        'participant.update',
      );
      const late = await joinRoom(t, created.roomId, '늦둥이');
      await waitFor(
        () =>
          tc.events.some(e => e.name === 'participant.update' && e.data.participantId === late.participantId),
        '새 참가자',
      );
    });
  });
});

describe('AI 설정이 없으면', () => {
  it('서버는 뜨고 AI 요청만 E_AI_PROVIDER', async () => {
    const t = await startTestServer({ TEACHER_START_CODE: START_CODE }, { ai: null });
    try {
      const created = await createRoom(t, START_CODE, { aiButtons: ALL_BUTTONS });
      const s = await joinRoom(t, created.roomId, '하늘');
      const res = await api(
        t,
        'POST',
        `/api/rooms/${created.roomId}/ai`,
        {
          docId: randomUUID(),
          button: 'FEEDBACK',
          text: LONG_TEXT,
          range: 'ALL',
          meta: { helpNotes: [] },
          commandId: randomUUID(),
        },
        bearer(s.token),
      );
      expect(res.json.error?.code).toBe('E_AI_PROVIDER');
      expect((await fetch(`${t.server.url}/api/health`)).status).toBe(200);
    } finally {
      await t.close();
    }
  });
});

describe('타이머 알림 예약(jobs/timers.ts, 가짜 시계)', () => {
  it('N분 전 알림과 끝 알림, 다시 켜졌을 때 지난 타이머는 조용히 멈춘다', () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const db = openDatabase(':memory:', { create: true });
    try {
      migrate(db, paths.migrationsDir, Date.now());
      const repos = createRepos(db);
      const roomId = randomUUID();
      repos.rooms.insert({
        id: roomId,
        entryCode: '123456',
        pinHmac: 'h',
        pinEnc: 'e',
        className: '반',
        title: '수업',
        schoolName: null,
        showSchool: false,
        settings: { genres: ['story'], aiButtons: [], sound: false, undoLevel: 'normal', diagnostics: false },
        retentionDays: 30,
        createdAt: Date.now(),
        expiresAt: Date.now() + 86_400_000,
      });
      const sent: Array<{ to: string; name: string; data: unknown }> = [];
      const record =
        (to: string) =>
        <N extends RoomEventName>(_roomId: string, name: N, data: RoomEventData<N>) =>
          void sent.push({ to, name, data });
      const events: RoomEvents = {
        connections: () => [],
        toRoom: record('room'),
        toTeachers: record('teachers'),
        toStudents: record('students'),
        toParticipant: (_r, _p, name, data) => void sent.push({ to: 'participant', name, data }),
      };
      const scheduler = createTimerScheduler({
        config: defaultConfig,
        repos,
        events,
        log: createMemoryLogger(),
        now: () => Date.now(),
      });
      const minute = 60_000;
      repos.timers.save({
        roomId,
        status: 'RUNNING',
        durationMs: 10 * minute,
        endsAt: Date.now() + 10 * minute,
        pausedRemainingMs: null,
        alerts: [5, 1],
        endText: '시간이 다 됐어요',
        startedAt: Date.now(),
      });
      scheduler.reschedule(roomId);
      const notices = () => sent.filter(s => s.name === 'notice').map(s => (s.data as { text: string }).text);
      vi.advanceTimersByTime(5 * minute);
      expect(notices()).toEqual(['5분 남았어요']);
      vi.advanceTimersByTime(4 * minute);
      expect(notices()).toEqual(['5분 남았어요', '1분 남았어요']);
      vi.advanceTimersByTime(minute);
      expect(notices()).toEqual(['5분 남았어요', '1분 남았어요', '시간이 다 됐어요']);
      expect(sent.find(s => s.name === 'timer')).toMatchObject({ to: 'room', data: { status: 'IDLE' } });
      expect(repos.timers.find(roomId)?.status).toBe('IDLE');
      expect(sent.filter(s => s.name === 'notice').every(s => s.to === 'students')).toBe(true);

      // 꺼진 사이 끝난 타이머는 다시 켜질 때 조용히 멈춘다(지난 알림은 보내지 않음)
      repos.timers.save({
        roomId,
        status: 'RUNNING',
        durationMs: minute * 2,
        endsAt: Date.now() - 1,
        pausedRemainingMs: null,
        alerts: [1],
        endText: '끝',
        startedAt: Date.now() - minute * 2,
      });
      const before = sent.length;
      scheduler.restore();
      vi.advanceTimersByTime(10 * minute);
      expect(sent.length).toBe(before);
      expect(repos.timers.find(roomId)?.status).toBe('IDLE');
      scheduler.close();
    } finally {
      db.close();
      vi.useRealTimers();
    }
  });
});
