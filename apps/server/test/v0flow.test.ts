import { randomUUID } from 'node:crypto';
import { base64UrlToBytes } from '@geulbang/core';
import { snapshotCovers } from '@geulbang/core/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSnapshots } from '../src/realtime/snapshots.ts';
import type { RealtimeContext } from '../src/realtime/context.ts';
import { ensureDevDocument } from '../src/store/devSeed.ts';
import { createRepos } from '../src/store/repos/index.ts';
import { startTestServer, type TestServer } from './helpers.ts';
import {
  api,
  connectRoom,
  createRoom,
  joinRoom,
  waitFor,
  type DocClient,
  type JoinedStudent,
  type RoomClient,
} from './roomClient.ts';

/**
 * 그 기기의 지금 상태까지 DB에 들어갔다는 `doc.persisted`가 왔는가. 서버는 글 연결이 붙자마자 DB의 마지막 표시도
 * 한 번 보내므로(검토 5번 뒤), "아무 doc.persisted"가 아니라 기기 상태를 덮는 것을 기다린다.
 */
const persistedCovers = (c: DocClient): boolean =>
  c.events.some(e => {
    if (e.name !== 'doc.persisted' || e.data.snapshot === undefined) return false;
    const bytes = base64UrlToBytes(e.data.snapshot);
    return bytes !== null && snapshotCovers(Y.decodeSnapshot(bytes), Y.snapshot(c.doc));
  });

/**
 * P3-3 서버 v0 흐름 통합 시험(PLAN §10.4 중 v0 범위).
 * 만들기 → 코드 조회 → 입장 → 실시간 연결 → hello → doc.create → 입력 → 저장·스냅샷, 권한 표(§4.3),
 * 멱등 명령, 잘못된 자격. 시험 서버는 같은 프로세스·임시 SQLite·포트 0.
 */
const START_CODE = '12345678';

describe('P3-3 서버 v0 흐름', () => {
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
  const serverConnection = (name: string, participantId?: string) =>
    t.server.hocuspocus.documents
      .get(name)
      ?.getConnections()
      .find(c => {
        const actor = (c.context as RealtimeContext).actor;
        return participantId === undefined
          ? actor?.kind === 'teacher'
          : actor?.kind === 'student' && actor.participantId === participantId;
      });
  /** 방 하나 + 학생 하나 + 그 학생 글 하나 */
  const setup = async (nickname = '하늘고래') => {
    const created = await createRoom(t, START_CODE);
    const s = await joinRoom(t, created.roomId, nickname);
    const sc = student(created.roomId, s);
    await waitFor(() => sc.event('hello') !== undefined, 'hello');
    const ack = await sc.command('doc.create', { genre: 'story', subtype: 'short' });
    if (!ack.ok) throw new Error(`doc.create 실패 ${ack.error.code}`);
    const docId = (ack.data as { docId: string }).docId;
    return { created, s, sc, docId };
  };

  beforeAll(async () => {
    t = await startTestServer({
      TEACHER_START_CODE: START_CODE,
      SERVER_PERSIST_DEBOUNCE_MS: '50',
      SERVER_PERSIST_MAX_WAIT_MS: '200',
      SNAPSHOT_INTERVAL_SEC: '1',
      SUMMARY_INTERVAL_MS: '50',
      HEARTBEAT_SEC: '1',
      CLIENT_STALE_SEC: '2',
      OFFLINE_AFTER_SEC: '1',
      ROOM_MAX_PARTICIPANTS: '3',
      ROOM_CREATE_PER_IP_PER_DAY: '1000',
    });
  });
  afterEach(() => {
    for (const c of clients.splice(0)) c.close();
  });
  afterAll(async () => {
    await t.close();
  });

  it('만들기 → 코드 조회 → 입장 → hello → doc.create → 입력 → 저장·AUTO 스냅샷·요약', async () => {
    const created = await createRoom(t, START_CODE, { schoolName: '가상초', showSchool: false });
    expect(created.res.status).toBe(200);
    expect(created.res.headers.get('x-server-now')).toMatch(/^\d+$/);
    expect(created.res.json.commandId).toBe(created.body['commandId']);
    expect(created.entryCode).toMatch(new RegExp(`^\\d{${t.config.product.ENTRY_CODE_LENGTH}}$`));
    const roomRow = t.server.db
      .prepare('SELECT pin_hmac, pin_enc FROM rooms WHERE id = ?')
      .get(created.roomId) as {
      pin_hmac: string;
      pin_enc: string;
    };
    expect(roomRow.pin_hmac).not.toContain(String(created.body['pin']));
    expect(roomRow.pin_enc).not.toContain(String(created.body['pin']));

    const found = await api(t, 'GET', `/api/rooms/by-code/${created.entryCode}`);
    expect(found.status).toBe(200);
    expect(found.json.data).toEqual({
      roomId: created.roomId,
      className: '5학년 3반',
      title: '시험 수업',
      schoolName: null, // '보이기'를 끄면 학생에게 학교명이 없다
      status: 'ACTIVE',
      expiresAt: created.res.json.data?.['expiresAt'],
      policyVersion: t.config.product.POLICY_VERSION,
      genres: ['story', 'poem'],
    });

    const s = await joinRoom(t, created.roomId, '  하늘고래 ');
    expect(s.res.status).toBe(200);
    expect(s.res.json.data).toEqual({ participantId: s.participantId, nickname: '하늘고래' });

    const sc = student(created.roomId, s);
    const tc = teacher(created.roomId, created.linkToken);
    await waitFor(() => sc.event('hello') !== undefined && tc.event('hello') !== undefined, 'hello 둘');
    expect(sc.rejected).toEqual([]);
    const sh = sc.event('hello')?.data;
    expect(sh?.role).toBe('student');
    expect(sh?.me).toEqual({
      participantId: s.participantId,
      nickname: '하늘고래',
      consentVersion: t.config.product.POLICY_VERSION,
    });
    expect(sh?.room.schoolName).toBeNull();
    expect(sh?.docs).toEqual([]);
    expect(sh?.summaries).toBeNull();
    expect(sh?.timer.status).toBe('IDLE');
    expect(sh?.config['HEARTBEAT_SEC']).toBe(1);
    expect(sh?.config).not.toHaveProperty('MODEL_SPELL');
    const th = tc.event('hello')?.data;
    expect(th?.role).toBe('teacher');
    expect(th?.me).toBeNull();
    expect(th?.room.schoolName).toBe('가상초');
    expect(th?.summaries).toEqual([]);
    expect(th?.pendingResumes).toEqual([]);
    // 학생의 room:* 연결은 읽기 전용(§4.7 대응 6)
    expect(sc.provider.authorizedScope).toBe('readonly');

    const ack = await sc.command('doc.create', { genre: 'story', subtype: 'short' });
    expect(ack.ok).toBe(true);
    const docId = ack.ok ? (ack.data as { docId: string }).docId : '';
    const d = sc.openDoc(docId);
    await waitFor(() => d.provider.isSynced, '글 동기화');
    expect(d.provider.authorizedScope).toBe('read-write');
    expect(d.doc.getMap('meta').get('subtype')).toBe('short');

    d.doc.getText('body').insert(0, '옛날 옛적에');
    await waitFor(() => persistedCovers(d), 'doc.persisted');
    const row = t.server.db
      .prepare('SELECT plain_text, char_count, last_input_by, last_input_at FROM documents WHERE id = ?')
      .get(docId) as { plain_text: string; char_count: number; last_input_by: string; last_input_at: number };
    expect(row).toMatchObject({ plain_text: '옛날 옛적에', char_count: 6, last_input_by: 'STUDENT' });
    expect(row.last_input_at).toBeGreaterThan(0);
    const snaps = t.server.db
      .prepare('SELECT reason, author, body_text FROM snapshots WHERE document_id = ?')
      .all(docId);
    expect(snaps).toEqual([{ reason: 'AUTO', author: 'STUDENT', body_text: '옛날 옛적에' }]);

    // 교사에게는 바뀐 글만 묶어서(summary.batch)
    await waitFor(
      () =>
        tc.events.some(
          e => e.name === 'summary.batch' && e.data.some(x => x.docId === docId && x.chars === 6),
        ),
      'summary.batch',
    );
    const batch = tc.events.findLast(e => e.name === 'summary.batch');
    const summary = batch?.name === 'summary.batch' ? batch.data.find(x => x.docId === docId) : undefined;
    expect(summary).toMatchObject({
      participantId: s.participantId,
      nickname: '하늘고래',
      genre: 'story',
      subtype: 'short',
      status: 'DRAFT',
      lastInputBy: 'STUDENT',
      presence: 'WRITING',
    });
    expect(sc.events.some(e => e.name === 'summary.batch')).toBe(false); // 학생은 받지 않는다

    // 다시 들어온 학생의 hello에는 자기 글이 있다
    const again = student(created.roomId, s);
    await waitFor(() => again.event('hello') !== undefined, '두 번째 hello');
    expect(again.event('hello')?.data.docs).toEqual([
      expect.objectContaining({
        docId,
        genre: 'story',
        subtype: 'short',
        purposeCustom: null,
        chars: 6,
      }),
    ]);
  });

  it('tick이 하트비트마다 오고, 끊긴 학생은 OFFLINE_AFTER_SEC 뒤 오프라인으로 보인다', async () => {
    const { created, sc, docId } = await setup();
    const tc = teacher(created.roomId, created.linkToken);
    await waitFor(() => tc.event('hello') !== undefined, 'hello');
    expect(tc.event('hello')?.data.summaries?.find(x => x.docId === docId)?.presence).toBe('WRITING');
    await waitFor(() => sc.events.some(e => e.name === 'tick'), 'tick', 3000);

    sc.close();
    await waitFor(
      () =>
        tc.events.some(
          e => e.name === 'summary.batch' && e.data.some(x => x.docId === docId && x.presence === 'OFFLINE'),
        ),
      '오프라인',
      4000,
    );
  });

  it('권한 표: 남의 글 거부, 교사 쓰기·첫 입력 스냅샷·teacher.editing, 제출된 글은 학생 읽기 전용', async () => {
    const { created, s, sc, docId } = await setup();
    const own = sc.openDoc(docId);
    await waitFor(() => own.provider.isSynced, '학생 글');
    own.doc.getText('body').insert(0, '내 글');
    await waitFor(() => persistedCovers(own), '저장');

    // 같은 방 다른 학생은 남의 글을 열 수 없다
    const other = await joinRoom(t, created.roomId, '별빛');
    const oc = student(created.roomId, other);
    const stolen = oc.openDoc(docId);
    await waitFor(() => stolen.failures.length > 0, '거부');
    expect(stolen.failures).toEqual(['E_FORBIDDEN']);
    // 다른 방 채널도 열 수 없다
    const otherRoom = await createRoom(t, START_CODE);
    const wrongRoom = student(otherRoom.roomId, other);
    await waitFor(() => wrongRoom.failures.length > 0, '다른 방 거부');
    expect(wrongRoom.failures).toEqual(['E_FORBIDDEN']);
    // 다른 방 교사도 이 방 글을 열 수 없다
    const otherTeacher = teacher(otherRoom.roomId, otherRoom.linkToken);
    const foreign = otherTeacher.openDoc(docId);
    await waitFor(() => foreign.failures.length > 0, '다른 방 교사 거부');
    expect(foreign.failures).toEqual(['E_FORBIDDEN']);

    // 교사 서랍: 쓰기, 처음 입력 때 TEACHER 스냅샷(입력 바로 전 글) + 학생에게 teacher.editing
    const tc = teacher(created.roomId, created.linkToken);
    const drawer = tc.openDoc(docId);
    await waitFor(
      () => drawer.provider.isSynced && drawer.doc.getText('body').toString() === '내 글',
      '서랍',
    );
    expect(drawer.provider.authorizedScope).toBe('read-write');
    drawer.doc.getText('body').insert(3, ' 고침');
    await waitFor(() => own.doc.getText('body').toString() === '내 글 고침', '학생에게 전달');
    await waitFor(() => sc.events.some(e => e.name === 'teacher.editing'), 'teacher.editing');
    expect(sc.event('teacher.editing')?.data).toEqual({ docId });
    expect(oc.events.some(e => e.name === 'teacher.editing')).toBe(false);
    drawer.doc.getText('body').insert(0, '!');
    await waitFor(() => own.doc.getText('body').toString() === '!내 글 고침', '두 번째 입력');
    const teacherSnaps = t.server.db
      .prepare("SELECT body_text, author FROM snapshots WHERE document_id = ? AND reason = 'TEACHER'")
      .all(docId);
    expect(teacherSnaps).toEqual([{ body_text: '내 글', author: 'TEACHER' }]); // 서랍 한 번에 한 번
    expect(sc.events.filter(e => e.name === 'teacher.editing')).toHaveLength(1);
    await waitFor(() => {
      const r = t.server.db.prepare('SELECT last_input_by FROM documents WHERE id = ?').get(docId) as {
        last_input_by: string;
      };
      return r.last_input_by === 'TEACHER';
    }, 'last_input_by TEACHER');

    // 제출된 글: 학생은 다시 연결하면 읽기 전용, 교사는 계속 쓴다(ADR-048)
    t.server.db.prepare("UPDATE documents SET status = 'SUBMITTED' WHERE id = ?").run(docId);
    own.close();
    await waitFor(() => serverConnection(`doc:${docId}`, s.participantId) === undefined, '학생 글 연결 닫힘');
    const reopened = sc.openDoc(docId);
    await waitFor(() => reopened.provider.isSynced, '다시 열기');
    expect(reopened.provider.authorizedScope).toBe('readonly');
    expect(serverConnection(`doc:${docId}`, s.participantId)?.readOnly).toBe(true);
    expect(serverConnection(`doc:${docId}`)?.readOnly).toBe(false);
    reopened.doc.getText('body').insert(0, '잠긴 뒤');
    drawer.doc.getText('body').insert(0, '교사');
    // 두 편집이 같은 자리(0)에 들어가 순서는 clientID에 달렸다. 교사 것이 들어왔는지만 본다.
    await waitFor(() => reopened.doc.getText('body').toString().includes('교사'), '교사 편집은 학생에게');
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(t.server.hocuspocus.documents.get(`doc:${docId}`)?.getText('body').toString()).not.toContain(
      '잠긴 뒤',
    );
  });

  it('닫힌 방: 학생 글은 읽기 전용, 새 글·새 입장은 E_ROOM_CLOSED', async () => {
    const { created, sc, docId } = await setup();
    t.server.db.prepare("UPDATE rooms SET status = 'CLOSED' WHERE id = ?").run(created.roomId);
    const d = sc.openDoc(docId);
    await waitFor(() => d.provider.isSynced, '열기');
    expect(d.provider.authorizedScope).toBe('readonly');
    const ack = await sc.command('doc.create', { genre: 'poem' });
    expect(ack).toMatchObject({ ok: false, error: { code: 'E_ROOM_CLOSED' } });
    const late = await joinRoom(t, created.roomId, '늦은별');
    expect(late.res.status).toBe(409);
    expect(late.res.json.error?.code).toBe('E_ROOM_CLOSED');
    const found = await api(t, 'GET', `/api/rooms/by-code/${created.entryCode}`);
    expect(found.json.data?.['status']).toBe('CLOSED');
  });

  it('명령: 같은 commandId는 같은 결과, 인자가 다르면 E_INPUT, 역할·판·인자 검사', async () => {
    const { created, s, sc } = await setup();
    const id = randomUUID();
    const first = await sc.command('doc.create', { genre: 'poem' }, id);
    const second = await sc.command('doc.create', { genre: 'poem' }, id);
    expect(first.ok && second.ok).toBe(true);
    expect(second).toEqual(first);
    const rows = t.server.db
      .prepare("SELECT COUNT(*) AS n FROM documents WHERE participant_id = ? AND genre = 'poem'")
      .get(s.participantId) as { n: number };
    expect(rows.n).toBe(1);
    expect(await sc.command('doc.create', { genre: 'story' }, id)).toMatchObject({
      ok: false,
      error: { code: 'E_INPUT', retryable: false },
    });

    expect(await sc.command('doc.create', { genre: 'news' })).toMatchObject({ error: { code: 'E_INPUT' } }); // 꺼진 타일
    expect(await sc.command('doc.create', { genre: 'Story!' })).toMatchObject({ error: { code: 'E_INPUT' } });
    expect(await sc.command('doc.create', { genre: 'poem', extra: 1 })).toMatchObject({
      error: { code: 'E_INPUT' },
    });
    expect(await sc.command('ping', { sentAt: 1 })).toMatchObject({ error: { code: 'E_FORBIDDEN' } });
    expect(
      await sc.command('doc.submit', { docId: randomUUID(), stateVector: '', generation: 0 }),
    ).toMatchObject({ error: { code: 'E_FORBIDDEN' } }); // 없는 글
    expect(await sc.command('doc.create', { genre: 'story', subtype: 'diary' })).toMatchObject({
      error: { code: 'E_INPUT' }, // 다른 글 종류의 하위 종류(genres.ts 카탈로그)
    });
    expect(await sc.command('room.fly', {})).toMatchObject({ error: { code: 'E_VERSION' } }); // 모르는 이름

    const consent = await sc.command('consent.update', { consentVersion: t.config.product.POLICY_VERSION });
    expect(consent.ok && (consent.data as { consentAt: number }).consentAt).toBeGreaterThan(0);
    expect(await sc.command('consent.update', { consentVersion: 'old' })).toMatchObject({
      error: { code: 'E_INPUT' },
    });

    const tc = teacher(created.roomId, created.linkToken);
    await waitFor(() => tc.event('hello') !== undefined, 'hello');
    const pong = await tc.command('ping', { sentAt: 42 });
    expect(pong.ok && pong.data).toMatchObject({ sentAt: 42, serverNow: expect.any(Number) });
    expect(await tc.command('doc.create', { genre: 'poem' })).toMatchObject({
      error: { code: 'E_FORBIDDEN' },
    });
    // 다른 실행 주체가 같은 commandId를 쓰면 E_INPUT
    expect(await tc.command('ping', { sentAt: 1 }, id)).toMatchObject({ error: { code: 'E_INPUT' } });
  });

  it('잘못된 자격: 모르는 토큰·다른 기기 ID·끊긴 기기는 E_AUTH, 만료된 방은 E_ROOM_EXPIRED', async () => {
    const created = await createRoom(t, START_CODE);
    const s = await joinRoom(t, created.roomId, '초코');

    const unknown = room(created.roomId, { kind: 'student', token: 'a'.repeat(43), deviceId: s.deviceId });
    const wrongDevice = room(created.roomId, { kind: 'student', token: s.token, deviceId: randomUUID() });
    const fakeTeacher = room(created.roomId, { kind: 'teacher', token: s.token, deviceId: randomUUID() });
    await waitFor(
      () => unknown.failures.length + wrongDevice.failures.length + fakeTeacher.failures.length === 3,
      '거부 셋',
    );
    expect([unknown.failures, wrongDevice.failures, fakeTeacher.failures]).toEqual([
      ['E_AUTH'],
      ['E_AUTH'],
      ['E_AUTH'],
    ]);

    t.server.db
      .prepare('UPDATE devices SET revoked_at = ? WHERE participant_id = ?')
      .run(Date.now(), s.participantId);
    const revoked = student(created.roomId, s);
    await waitFor(() => revoked.failures.length > 0, '끊긴 기기');
    expect(revoked.failures).toEqual(['E_AUTH']);

    t.server.db.prepare('UPDATE rooms SET expires_at = ? WHERE id = ?').run(Date.now() - 1, created.roomId);
    const expired = teacher(created.roomId, created.linkToken);
    await waitFor(() => expired.failures.length > 0, '만료');
    expect(expired.failures).toEqual(['E_ROOM_EXPIRED']);
    const found = await api(t, 'GET', `/api/rooms/by-code/${created.entryCode}`);
    expect(found.status).toBe(410);
    expect(found.json.error?.code).toBe('E_ROOM_EXPIRED');
  });

  it('만들기: 시작 코드·PIN 칸·PIN 중복·멱등·모양 검사', async () => {
    const deviceId = randomUUID();
    const missing = await createRoom(t, undefined, { deviceId });
    expect(missing.res.status).toBe(401);
    expect(missing.res.json.error?.code).toBe('E_START_CODE_INVALID');

    // 틀린 시작 코드는 PIN 실패 칸(기기 PIN_MAX_FAILS번 → 잠금)으로 센다. 잠긴 동안은 맞는 코드도 막는다.
    for (let i = 0; i < t.config.product.PIN_MAX_FAILS; i++) {
      const wrong = await createRoom(t, '00000000', { deviceId });
      expect(wrong.res.json.error?.code).toBe('E_START_CODE_INVALID');
    }
    const locked = await createRoom(t, START_CODE, { deviceId });
    expect(locked.res.status).toBe(429);
    expect(locked.res.json.error).toMatchObject({ code: 'E_PIN_LOCKED', retryable: true });

    // 같은 commandId·같은 본문은 같은 결과(응답이 사라져도 안전), 다른 본문이면 E_INPUT
    const first = await createRoom(t, START_CODE);
    const replay = await api(t, 'POST', '/api/rooms', first.body, { 'x-start-code': START_CODE });
    expect(replay.status).toBe(200);
    expect(replay.json.data).toEqual(first.res.json.data);
    const reused = await api(
      t,
      'POST',
      '/api/rooms',
      { ...first.body, title: '다른 수업' },
      { 'x-start-code': START_CODE },
    );
    expect(reused.json.error?.code).toBe('E_INPUT');

    // 살아 있는 방의 PIN은 쓸 수 없다. 만료된 방의 PIN은 다시 쓸 수 있다(PRD F-20).
    const taken = await createRoom(t, START_CODE, { pin: first.body['pin'] });
    expect(taken.res.status).toBe(409);
    expect(taken.res.json.error?.code).toBe('E_PIN_TAKEN');
    t.server.db.prepare('UPDATE rooms SET expires_at = ? WHERE id = ?').run(Date.now() - 1, first.roomId);
    const reusedPin = await createRoom(t, START_CODE, { pin: first.body['pin'] });
    expect(reusedPin.res.status).toBe(200);
    expect(t.server.db.prepare('SELECT id FROM rooms WHERE id = ?').get(first.roomId)).toBeUndefined();

    const extra = await createRoom(t, START_CODE, { secret: 1 });
    expect(extra.res.json.error?.code).toBe('E_INPUT');
    const shortPin = await createRoom(t, START_CODE, { pin: '12' });
    expect(shortPin.res.json.error).toMatchObject({ code: 'E_INPUT', fields: { pin: expect.any(String) } });
  });

  it('조회·입장: 없는 코드, 별명 중복(정규화), 인원 초과, 동의 판, 멱등', async () => {
    expect((await api(t, 'GET', '/api/rooms/by-code/000000')).json.error?.code).toBe('E_ROOM_NOT_FOUND');
    expect((await api(t, 'GET', '/api/rooms/by-code/12ab')).json.error?.code).toBe('E_INPUT');
    expect((await joinRoom(t, randomUUID(), '바다')).res.json.error?.code).toBe('E_ROOM_NOT_FOUND');

    const created = await createRoom(t, START_CODE);
    const a = await joinRoom(t, created.roomId, 'Sky  Whale');
    expect(a.res.status).toBe(200);
    expect(a.res.json.data?.['nickname']).toBe('Sky Whale');
    const dup = await joinRoom(t, created.roomId, ' sky whale ');
    expect(dup.res.status).toBe(409);
    expect(dup.res.json.error?.code).toBe('E_NICK_TAKEN');
    expect((await joinRoom(t, created.roomId, '가'.repeat(13))).res.json.error?.code).toBe('E_NICK_INVALID');
    expect(
      (await joinRoom(t, created.roomId, '구름', { consentVersion: 'old' })).res.json.error?.fields,
    ).toEqual({ consentVersion: 'outdated' });

    const replay = await api(t, 'POST', `/api/rooms/${created.roomId}/join`, a.body);
    expect(replay.json.data).toEqual(a.res.json.data);
    expect(
      (await api(t, 'POST', `/api/rooms/${created.roomId}/join`, { ...a.body, nickname: '다른' })).json.error
        ?.code,
    ).toBe('E_INPUT');

    await joinRoom(t, created.roomId, '둘째');
    await joinRoom(t, created.roomId, '셋째');
    const full = await joinRoom(t, created.roomId, '넷째');
    expect(full.res.status).toBe(409);
    expect(full.res.json.error?.code).toBe('E_ROOM_FULL');
  });
});

describe('스냅샷 판단(PRD F-10, domain/snapshotPolicy.ts)', () => {
  it('간격·변경 판단과 상한', async () => {
    const t = await startTestServer();
    try {
      const repos = createRepos(t.server.db);
      let now = 1_000_000;
      const snapshots = createSnapshots({
        repos,
        config: { ...t.config.product, SNAPSHOT_MAX: 3, SNAPSHOT_INTERVAL_SEC: 30 },
        now: () => now,
      });
      // 외래키를 지키려고 개발용 행을 빌린다
      const docId = 'dev-snap';
      ensureDevDocument(t.server.db, docId, now);
      const text = (body: string) => ({ titleText: '', bodyText: body, charCount: body.length });

      expect(snapshots.afterSave(docId, text(''), 'STUDENT')).toBe(false); // 빈 글은 바뀐 것이 아니다
      expect(snapshots.afterSave(docId, text('가'), 'STUDENT')).toBe(true);
      now += 10_000;
      expect(snapshots.afterSave(docId, text('가나'), 'STUDENT')).toBe(false); // 30초 안
      now += 30_000;
      expect(snapshots.afterSave(docId, text('가나'), 'STUDENT')).toBe(true);
      now += 30_000;
      expect(snapshots.afterSave(docId, text('가나'), 'STUDENT')).toBe(false); // 바뀌지 않음
      snapshots.record(docId, 'TEACHER', 'TEACHER', text('가나'));
      now += 30_000;
      expect(snapshots.afterSave(docId, text('가나다'), 'STUDENT')).toBe(true);
      now += 30_000;
      expect(snapshots.afterSave(docId, text('가나다라'), 'STUDENT')).toBe(true);
      const left = t.server.db
        .prepare('SELECT reason FROM snapshots WHERE document_id = ? ORDER BY created_at')
        .all(docId) as Array<{ reason: string }>;
      expect(left).toHaveLength(3);
      expect(left.map(r => r.reason)).toContain('TEACHER');
    } finally {
      await t.close();
    }
  });
});
