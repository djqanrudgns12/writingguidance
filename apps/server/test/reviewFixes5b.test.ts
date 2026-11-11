import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeAi } from '../src/ai/fake.ts';
import type { AiPort } from '../src/ai/port.ts';
import { startTestServer, type TestServer } from './helpers.ts';
import {
  api,
  bearer,
  connectRoom,
  createRoom,
  joinRoom,
  waitFor,
  type JoinedStudent,
  type RoomClient,
} from './roomClient.ts';

/**
 * P5-5b 검토 B01·B03(서버)·B09·B10 회귀 시험. 재현 절차는 `docs/reviews/P5-5b_v1_review.md`.
 * 입장 코드 충돌을 재현하려고 `crypto.randomInt`만 바꿔 끼운다(줄이 비면 진짜 값).
 */
const forced = vi.hoisted(() => ({ digits: [] as number[] }));
vi.mock('node:crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const real = actual.randomInt as (min: number, max: number) => number;
  const randomInt = (min: number, max: number): number => forced.digits.shift() ?? real(min, max);
  return { ...actual, default: { ...actual, randomInt }, randomInt };
});

const START_CODE = '12345678';
/** 맞춤법 조각 하나가 시도 제한(AI_TIMEOUT_SEC=1 → 1초) 바로 아래로 걸리게 */
const SLOW_CHUNK_MS = 800;

/** 입장 코드(첫 자리 1~9, 나머지 0~9)를 `generateEntryCode`가 그대로 뽑게 한다. */
const forceEntryCode = (code: string) => {
  const [first, ...rest] = [...code].map(Number);
  forced.digits.push((first ?? 1) - 1, ...rest);
};

let fake = createFakeAi();
const ai = new Proxy({} as AiPort, { get: (_target, key) => Reflect.get(fake, key) as unknown });

describe('P5-5b 검토 고치기(서버)', () => {
  let t: TestServer;
  const clients: RoomClient[] = [];
  const student = (roomId: string, s: JoinedStudent) => {
    const c = connectRoom(t, roomId, { kind: 'student', token: s.token, deviceId: s.deviceId });
    clients.push(c);
    return c;
  };
  const serverDoc = (docId: string) => t.server.hocuspocus.documents.get(`doc:${docId}`);
  const row = <T>(sql: string, ...args: unknown[]) => t.server.db.prepare(sql).get(...args) as T;
  const expire = (roomId: string) =>
    t.server.db.prepare('UPDATE rooms SET expires_at = ? WHERE id = ?').run(Date.now() - 1, roomId);
  const aiCall = (roomId: string, token: string, body: Record<string, unknown>) =>
    api(
      t,
      'POST',
      `/api/rooms/${roomId}/ai`,
      { range: 'ALL', commandId: randomUUID(), ...body },
      bearer(token),
    );

  /** 방 + 학생 하나(연결) + 그 학생 글 하나(글 연결까지 동기화) */
  const classroom = async (genre = 'story', overrides: Record<string, unknown> = {}) => {
    const created = await createRoom(t, START_CODE, {
      genres: ['story', 'lyrics'],
      aiButtons: ['SPELL', 'FEEDBACK'],
      ...overrides,
    });
    const s = await joinRoom(t, created.roomId, '하늘고래');
    const sc = student(created.roomId, s);
    await waitFor(() => sc.event('hello') !== undefined, 'hello');
    const ack = await sc.command('doc.create', { genre });
    if (!ack.ok) throw new Error(`doc.create ${ack.error.code}`);
    const docId = (ack.data as { docId: string }).docId;
    const d = sc.openDoc(docId);
    await waitFor(() => d.provider.isSynced, '글 동기화');
    return { created, s, sc, d, docId };
  };

  beforeAll(async () => {
    t = await startTestServer(
      {
        TEACHER_START_CODE: START_CODE,
        SERVER_PERSIST_DEBOUNCE_MS: '50',
        SERVER_PERSIST_MAX_WAIT_MS: '200',
        SUMMARY_INTERVAL_MS: '50',
        ROOM_CREATE_PER_IP_PER_DAY: '1000',
        AI_TIMEOUT_SEC: '1',
        AI_SPELL_CHUNK_CHARS: '40',
        AI_SPELL_MAX_PARALLEL: '1',
      },
      { ai },
    );
  });
  afterEach(() => {
    for (const c of clients.splice(0)) c.close();
    forced.digits.length = 0;
    fake = createFakeAi();
  });
  afterAll(async () => {
    await t.close();
  });

  describe('B01 만료 방과 겹치는 새 방 만들기', () => {
    it('만료 방이 PIN을 붙잡고 있으면 공통 삭제(방송·연결 닫기·메모리 정리)로 비운 뒤 만든다', async () => {
      const { created, sc, d, docId } = await classroom();
      d.doc.getText('body').insert(0, '만료 전 글');
      await waitFor(() => serverDoc(docId)?.getText('body').toString() === '만료 전 글', '서버 도착');
      expire(created.roomId);

      const again = await createRoom(t, START_CODE, { pin: created.body['pin'] });
      expect(again.res.status).toBe(200);
      await waitFor(() => sc.event('room.status')?.data.status === 'EXPIRED', '옛 방 room.status EXPIRED');
      await waitFor(() => serverDoc(docId) === undefined, '옛 글이 메모리에서 내려감');
      expect(row<unknown>('SELECT id FROM rooms WHERE id = ?', created.roomId)).toBeUndefined();
      expect(row<unknown>('SELECT id FROM documents WHERE id = ?', docId)).toBeUndefined();
      expect(
        t.log.lines.some(l => l['event'] === 'room_deleted' && l['detail'] === 'EXPIRED' && l['count'] === 1),
      ).toBe(true);
    });

    it('뽑은 입장 코드를 만료 방이 쓰면 공통 삭제 뒤 그 코드를 쓰고, 살아 있는 방의 코드는 건너뛴다', async () => {
      const live = await createRoom(t, START_CODE);
      const { created: old, sc } = await classroom();
      expire(old.roomId);

      forceEntryCode(live.entryCode); // 살아 있는 방: 다시 뽑아야 한다
      forceEntryCode(old.entryCode); // 만료 방: 공통 삭제 뒤 쓴다
      const fresh = await createRoom(t, START_CODE);
      expect(fresh.res.status).toBe(200);
      expect(fresh.entryCode).toBe(old.entryCode);
      expect(forced.digits).toEqual([]);
      await waitFor(() => sc.event('room.status')?.data.status === 'EXPIRED', '옛 방 room.status EXPIRED');
      expect(row<unknown>('SELECT id FROM rooms WHERE id = ?', old.roomId)).toBeUndefined();
      expect(row<{ id: string }>('SELECT id FROM rooms WHERE entry_code = ?', live.entryCode).id).toBe(
        live.roomId,
      );
    });

    it('살아 있는 방의 PIN은 그대로 E_PIN_TAKEN', async () => {
      const first = await createRoom(t, START_CODE);
      const taken = await createRoom(t, START_CODE, { pin: first.body['pin'] });
      expect(taken.res.json.error?.code).toBe('E_PIN_TAKEN');
      expect(row<unknown>('SELECT id FROM rooms WHERE id = ?', first.roomId)).toBeDefined();
    });
  });

  describe('B09 맞춤법 조각 전체 시간 예산', () => {
    it('조각들이 하나의 마감을 나눠 쓰고, 마감이 오면 돌던 호출을 끊고 새 조각을 시작하지 않는다', async () => {
      const { created, s, docId } = await classroom();
      fake = createFakeAi({ delayMs: SLOW_CHUNK_MS });
      // 조각 5개(AI_SPELL_CHUNK_CHARS=40): 한 번에 하나씩, 각 0.8초 → 예산 2초 안에는 두 개 반만 된다.
      const text = Array.from(
        { length: 5 },
        (_, i) => `${i + 1}번째 문단입니다. 오늘은 되요 라고 썼다. 할수 있다.`,
      ).join('\n');
      const started = Date.now();
      const res = await aiCall(created.roomId, s.token, {
        docId,
        button: 'SPELL',
        text,
        meta: { helpNotes: [] },
      });
      const elapsed = Date.now() - started;
      expect(res.json.error).toMatchObject({ code: 'E_AI_TIMEOUT', retryable: true });
      // 예산(AI_TIMEOUT_SEC × 2 = 2초)에서 끝난다. 조각마다 새 예산이면 5 × 0.8초 = 4초 뒤 성공했다.
      expect(elapsed).toBeLessThan(2_700);
      expect(fake.calls.filter(c => c.button === 'SPELL')).toHaveLength(3);
      expect(
        row<{ status: string; error_code: string }>(
          'SELECT status, error_code FROM ai_usage WHERE document_id = ?',
          docId,
        ),
      ).toEqual({ status: 'REFUNDED', error_code: 'E_AI_TIMEOUT' });
    }, 10_000);

    it('예산 안에 끝나는 조각들은 그대로 합친다', async () => {
      const { created, s, docId } = await classroom();
      fake = createFakeAi({ delayMs: 100 });
      const text = [
        '첫째 문단에서 되요 라고 썼다. 길게 길게 써 본다.',
        '둘째에는 할수 있다고 썼다. 길게 써 본다.',
      ].join('\n');
      const res = await aiCall(created.roomId, s.token, {
        docId,
        button: 'SPELL',
        text,
        meta: { helpNotes: [] },
      });
      expect(res.status).toBe(200);
      const items = (res.json.data?.['result'] as { items: Array<{ original: string }> }).items;
      expect(items.map(i => i.original)).toEqual(['되요', '할수']);
      expect(fake.calls.filter(c => c.button === 'SPELL')).toHaveLength(2);
    });
  });

  describe('B10 노래 분위기 직접 입력 길이', () => {
    it('설정 상한(DOC_TITLE_MAX_CHARS)까지의 분위기로 AI를 부를 수 있다', async () => {
      const { created, s, docId } = await classroom('lyrics');
      const mood = '가'.repeat(t.config.product.DOC_TITLE_MAX_CHARS);
      const res = await aiCall(created.roomId, s.token, {
        docId,
        button: 'FEEDBACK',
        text: '반짝이는 별을 따라 걸어가요\n우리 함께 노래해요\n밤하늘 아래 손을 잡고\n끝까지 함께 걸어가요',
        meta: { helpNotes: [], mood, tempo: '보통' },
      });
      expect(res.json.error).toBeUndefined();
      expect(res.status).toBe(200);
    });
  });

  describe('B03 정책 판이 바뀐 참가자', () => {
    it('동의 판이 지금과 다르면 글 쓰기와 AI를 막고, consent.update 뒤 풀린다', async () => {
      const { created, s, sc, docId } = await classroom();
      // 서버 정책 판이 바뀐 상황: 참가자가 동의한 판이 지금 POLICY_VERSION과 다르다.
      t.server.db
        .prepare('UPDATE participants SET consent_version = ? WHERE id = ?')
        .run('2000-01-old', s.participantId);
      // 다시 연결(새로고침·쓰기 주소 직접 진입)
      sc.close();
      const again = student(created.roomId, s);
      await waitFor(() => again.event('hello') !== undefined, 'hello');
      expect(again.event('hello')?.data.me?.consentVersion).toBe('2000-01-old');
      const reopened = again.openDoc(docId);
      await waitFor(() => reopened.provider.isSynced, '다시 연 글 동기화');

      reopened.doc.getText('body').insert(0, '새 정책 확인 전');
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(serverDoc(docId)?.getText('body').toString()).toBe('');

      const body = {
        docId,
        button: 'FEEDBACK',
        text: '오늘은 비가 와서 우산을 쓰고 학교에 갔다. 친구와 함께 걸었다.',
      };
      const blocked = await aiCall(created.roomId, s.token, { ...body, meta: { helpNotes: [] } });
      expect(blocked.status).toBe(403);
      expect(blocked.json.error).toMatchObject({
        code: 'E_FORBIDDEN',
        retryable: false,
        fields: { consentVersion: 'outdated' },
      });
      expect(row<{ n: number }>('SELECT COUNT(*) AS n FROM ai_usage WHERE document_id = ?', docId).n).toBe(0);

      // 재동의는 막지 않는다. 그 뒤 열린 글 연결이 쓰기로 바뀌고 doc.status {locked:false}가 온다.
      const consent = await again.command('consent.update', {
        consentVersion: t.config.product.POLICY_VERSION,
      });
      expect(consent).toMatchObject({ ok: true });
      await waitFor(
        () => reopened.events.some(e => e.name === 'doc.status' && e.data.docId === docId && !e.data.locked),
        '쓰기 풀림',
      );
      reopened.provider.forceSync();
      await waitFor(
        () => serverDoc(docId)?.getText('body').toString() === '새 정책 확인 전',
        '풀린 뒤 합쳐짐',
      );
      const allowed = await aiCall(created.roomId, s.token, { ...body, meta: { helpNotes: [] } });
      expect(allowed.status).toBe(200);
    });
  });
});
