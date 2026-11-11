import { randomUUID } from 'node:crypto';
import { bytesToBase64Url } from '@geulbang/core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initialDocState, memoQuestionIds } from '../src/realtime/commands/docCommands.ts';
import { startTestServer, type TestServer } from './helpers.ts';
import {
  connectRoom,
  createRoom,
  joinRoom,
  waitFor,
  type JoinedStudent,
  type RoomClient,
} from './roomClient.ts';

/** P5-5a 검토 2·3·5번 회귀 시험(서버 쪽). 재현 절차는 `docs/reviews/P5-5a_v0_review.md`. */
const START_CODE = '12345678';

describe('P5-5a 검토 고치기(서버)', () => {
  let t: TestServer;
  const clients: RoomClient[] = [];
  const room = (roomId: string, credential: Parameters<typeof connectRoom>[2]) => {
    const c = connectRoom(t, roomId, credential);
    clients.push(c);
    return c;
  };
  const student = (roomId: string, s: JoinedStudent) =>
    room(roomId, { kind: 'student', token: s.token, deviceId: s.deviceId });
  const serverDoc = (docId: string) => t.server.hocuspocus.documents.get(`doc:${docId}`);

  const classroom = async (genre = 'story') => {
    const created = await createRoom(t, START_CODE, { genres: ['story', 'poem', 'lyrics', 'other'] });
    const s = await joinRoom(t, created.roomId, '하늘고래');
    const sc = student(created.roomId, s);
    await waitFor(() => sc.event('hello') !== undefined, 'hello');
    const ack = await sc.command('doc.create', { genre });
    if (!ack.ok) throw new Error(`doc.create ${ack.error.code}`);
    return { created, s, sc, docId: (ack.data as { docId: string }).docId };
  };

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

  describe('3번 메모 칸', () => {
    it('새 글은 그 종류의 모든 하위 종류·용도 질문마다 빈 메모 칸을 미리 가진다', () => {
      expect(memoQuestionIds('story')).toEqual([
        'story_who',
        'story_when_where',
        'story_event',
        'story_ending',
        'story_chapter',
      ]);
      expect(memoQuestionIds('other')).toEqual(
        expect.arrayContaining(['poster_slogan', 'webtoon_scene', 'other_reader']),
      );
      expect(memoQuestionIds('not-a-genre')).toEqual([]);
      const doc = new Y.Doc();
      Y.applyUpdate(doc, initialDocState('poem', 'free-verse', undefined));
      const memo = doc.getMap('memo');
      expect([...memo.keys()].sort()).toEqual(
        ['poem_feeling', 'poem_metaphor', 'poem_subject', 'poem_wish'].sort(),
      );
      for (const v of memo.values()) expect(v).toBeInstanceOf(Y.Text);
      expect(doc.getMap('meta').get('subtype')).toBe('free-verse');
    });

    it('같은 학생의 두 기기가 빈 메모에 동시에 처음 써도 둘 다 남는다', async () => {
      const { created, s, docId } = await classroom('story');
      const deviceA = student(created.roomId, s).openDoc(docId);
      const deviceB = student(created.roomId, s).openDoc(docId);
      await waitFor(() => deviceA.provider.isSynced && deviceB.provider.isSynced, '두 기기 동기화');
      const memoA = deviceA.doc.getMap<Y.Text>('memo').get('story_who');
      const memoB = deviceB.doc.getMap<Y.Text>('memo').get('story_who');
      expect(memoA).toBeInstanceOf(Y.Text);
      expect(memoB).toBeInstanceOf(Y.Text);
      // 서로의 업데이트가 닿기 전에(같은 틱) 각자 첫 글자를 쓴다.
      memoA?.insert(0, '가');
      memoB?.insert(0, '나');
      const both = (text: string | undefined) =>
        text?.length === 2 && text.includes('가') && text.includes('나');
      await waitFor(
        () =>
          both(serverDoc(docId)?.getMap<Y.Text>('memo').get('story_who')?.toString()) &&
          both(memoA?.toString()) &&
          both(memoB?.toString()),
        '두 글자가 다 남음',
      );
      expect(deviceA.events.some(e => e.name === 'doc.error')).toBe(false);
      expect(deviceB.events.some(e => e.name === 'doc.error')).toBe(false);
    });
  });

  describe('2번 meta 검사', () => {
    it('학생이 그 종류에 없는 하위 종류를 쓰면 거부하고, 저장된 틀린 값은 hello·요약에서 null로 보낸다', async () => {
      const { created, s, sc, docId } = await classroom('story');
      const d = sc.openDoc(docId);
      await waitFor(() => d.provider.isSynced, '동기화');
      d.doc.getMap('meta').set('subtype', 'children-poem'); // 시의 하위 종류
      await waitFor(() => d.events.some(e => e.name === 'doc.error'), 'doc.error');
      expect(serverDoc(docId)?.getMap('meta').get('subtype')).toBeUndefined();
      d.close();

      // 검사 전에 저장된 틀린 값(옛 판)을 흉내 낸다: 메모리에서 내린 뒤 DB 원본을 바꾼다.
      await waitFor(() => serverDoc(docId) === undefined, '메모리에서 내림');
      const bad = new Y.Doc();
      bad.getMap('meta').set('subtype', '!');
      t.server.db
        .prepare('UPDATE documents SET ydoc_state = ?, subtype = ? WHERE id = ?')
        .run(Buffer.from(Y.encodeStateAsUpdate(bad)), '!', docId);

      const tc = room(created.roomId, { kind: 'teacher', token: created.linkToken, deviceId: randomUUID() });
      const again = student(created.roomId, s);
      await waitFor(() => tc.event('hello') !== undefined && again.event('hello') !== undefined, 'hello 둘');
      expect(tc.rejected).toEqual([]);
      expect(again.rejected).toEqual([]);
      expect(tc.event('hello')?.data.summaries?.find(x => x.docId === docId)?.subtype).toBeNull();
      expect(again.event('hello')?.data.docs.find(x => x.docId === docId)?.subtype).toBeNull();

      // 저장된 틀린 값이 있어도 다른 편집은 막히지 않는다(바뀐 meta 키만 검사).
      const reopened = again.openDoc(docId);
      await waitFor(() => reopened.provider.isSynced, '다시 연 글 동기화');
      reopened.doc.getText('body').insert(0, '이어서 쓴다');
      await waitFor(() => serverDoc(docId)?.getText('body').toString() === '이어서 쓴다', '편집 도착');
      expect(reopened.events.some(e => e.name === 'doc.error')).toBe(false);
    });
  });

  describe('5번 지우기까지 확인', () => {
    it('새로 붙은 글 연결은 바로 DB의 마지막 저장 표시(스냅숏 포함)를 받는다', async () => {
      const { sc, docId } = await classroom('lyrics');
      const d = sc.openDoc(docId);
      await waitFor(() => d.provider.isSynced && d.events.some(e => e.name === 'doc.persisted'), 'persisted');
      const persisted = d.events.find(e => e.name === 'doc.persisted');
      expect(persisted?.name === 'doc.persisted' && persisted.data.snapshot).toBeTruthy();
    });

    it('지우기만 남은 제출은 E_SYNC_PENDING, 서버가 지우기를 받은 뒤에는 제출된다', async () => {
      const { sc, docId } = await classroom('story');
      const d = sc.openDoc(docId);
      await waitFor(() => d.provider.isSynced, '동기화');
      d.doc.getText('body').insert(0, '가나다');
      await waitFor(() => serverDoc(docId)?.getText('body').toString() === '가나다', '서버 도착');

      // 기기에만 있는 지우기(아직 서버에 안 보냄): 같은 상태를 복사해 '나'를 지운다.
      const offline = new Y.Doc();
      Y.applyUpdate(offline, Y.encodeStateAsUpdate(d.doc));
      const pending: Uint8Array[] = [];
      offline.on('update', (u: Uint8Array) => pending.push(u));
      offline.getText('body').delete(1, 1);
      const args = {
        docId,
        stateVector: bytesToBase64Url(Y.encodeStateVector(offline)),
        snapshot: bytesToBase64Url(Y.encodeSnapshot(Y.snapshot(offline))),
        generation: 0,
      };
      // 상태 벡터는 그대로라 예전 검사로는 통과했다.
      expect(args.stateVector).toBe(bytesToBase64Url(Y.encodeStateVector(d.doc)));
      expect(await sc.command('doc.submit', args)).toMatchObject({
        ok: false,
        error: { code: 'E_SYNC_PENDING', retryable: true },
      });
      expect(
        (t.server.db.prepare('SELECT status FROM documents WHERE id = ?').get(docId) as { status: string })
          .status,
      ).toBe('DRAFT');

      for (const u of pending) Y.applyUpdate(d.doc, u);
      await waitFor(() => serverDoc(docId)?.getText('body').toString() === '가다', '지우기 도착');
      expect(await sc.command('doc.submit', args)).toMatchObject({ ok: true, data: { status: 'SUBMITTED' } });
      expect(t.server.db.prepare('SELECT status, plain_text FROM documents WHERE id = ?').get(docId)).toEqual(
        { status: 'SUBMITTED', plain_text: '가다' },
      );
    });

    it('깨진 스냅숏은 E_INPUT', async () => {
      const { sc, docId } = await classroom('story');
      const stateVector = bytesToBase64Url(Y.encodeStateVector(new Y.Doc()));
      const ack = await sc.command('doc.submit', { docId, stateVector, snapshot: '_-_', generation: 0 });
      expect(ack).toMatchObject({ ok: false, error: { code: 'E_INPUT' } });
    });
  });
});
