import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { base64UrlToBytes } from '@geulbang/core';
import { decodeDocEvent, encodeCredential, type DocEvent } from '@geulbang/core/protocol';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { loadServerConfig } from '../src/config.ts';
import { createMemoryLogger } from '../src/log.ts';
import { setDocumentLock } from '../src/realtime/locks.ts';
import { startServer, type RunningServer } from '../src/server.ts';

const DEV_SECRET = 'd'.repeat(43);

interface Client {
  readonly provider: HocuspocusProvider;
  readonly doc: Y.Doc;
  readonly events: DocEvent[];
  readonly failures: string[];
  close(): void;
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`시간 안에 되지 않음: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function connect(
  server: RunningServer,
  docName: string,
  options: { secret?: string; role?: 'student' | 'teacher'; doc?: Y.Doc } = {},
): Client {
  const doc = options.doc ?? new Y.Doc();
  const events: DocEvent[] = [];
  const failures: string[] = [];
  const socket = new HocuspocusProviderWebsocket({ url: `${server.url.replace('http', 'ws')}/ws` });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: docName,
    document: doc,
    token: encodeCredential({
      v: 1,
      kind: 'dev',
      token: options.secret ?? DEV_SECRET,
      deviceId: `device-${Math.random().toString(36).slice(2, 10)}`,
      role: options.role ?? 'student',
    }),
  });
  provider.on('stateless', ({ payload }: { payload: string }) => {
    const event = decodeDocEvent(payload);
    if (event) events.push(event);
  });
  provider.on('authenticationFailed', ({ reason }: { reason: string }) => failures.push(reason));
  provider.attach();
  return {
    provider,
    doc,
    events,
    failures,
    close() {
      provider.destroy();
      socket.destroy();
    },
  };
}

/** `doc.persisted`의 상태 벡터가 기기 상태를 다 포함하는가(PLAN §6.5 "저장됨" 판정) */
function persistedCovers(client: Client): boolean {
  const local = Y.decodeStateVector(Y.encodeStateVector(client.doc));
  return client.events.some(e => {
    if (e.name !== 'doc.persisted') return false;
    const bytes = base64UrlToBytes(e.data.stateVector);
    if (!bytes) return false;
    const saved = Y.decodeStateVector(bytes);
    return [...local].every(([id, clock]) => (saved.get(id) ?? 0) >= clock);
  });
}

describe('P2-1 글 동기화', () => {
  let dir: string;
  let server: RunningServer;
  const log = createMemoryLogger();
  const clients: Client[] = [];
  const env = () => ({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    DB_PATH: join(dir, 'rt.sqlite'),
    DEV_DOCS_ENABLED: 'true',
    SERVER_PERSIST_DEBOUNCE_MS: '50',
    SERVER_PERSIST_MAX_WAIT_MS: '200',
    DOC_MAX_CHARS: '200',
    LOG_LEVEL: 'debug',
  });
  const start = async () =>
    startServer({
      config: loadServerConfig(env()),
      log,
      devSecret: DEV_SECRET,
      webDistDir: join(dir, 'none'),
      sleep: async () => {},
    });
  const open = (name: string, options?: Parameters<typeof connect>[2]) => {
    const c = connect(server, name, options);
    clients.push(c);
    return c;
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'geulbang-rt-'));
    server = await start();
  });
  afterEach(() => {
    for (const c of clients.splice(0)) c.close();
  });
  afterAll(async () => {
    await server.stop('test');
    rmSync(dir, { recursive: true, force: true });
  });

  it('개발 자격은 비밀값·dev 글에서만 열린다', async () => {
    const wrong = open('doc:dev-a', { secret: 'x'.repeat(43) });
    const room = open('room:3f0c6a52-1f7e-4c2a-9d8e-2b7f1c0a9e11');
    const realDoc = open('doc:3f0c6a52-1f7e-4c2a-9d8e-2b7f1c0a9e11');
    await waitFor(
      () => wrong.failures.length + room.failures.length + realDoc.failures.length === 3,
      '거부 셋',
    );
    expect(wrong.failures).toEqual(['E_AUTH']);
    expect(room.failures).toEqual(['E_FORBIDDEN']);
    expect(realDoc.failures).toEqual(['E_FORBIDDEN']);

    const ok = open('doc:dev-a');
    await waitFor(() => ok.provider.isSynced, '동기화');
    expect(ok.failures).toEqual([]);
  });

  it('두 기기의 동시 편집이 합쳐지고, 저장 뒤 doc.persisted가 그 상태를 덮는다', async () => {
    const a = open('doc:dev-merge');
    const b = open('doc:dev-merge', { role: 'teacher' });
    await waitFor(() => a.provider.isSynced && b.provider.isSynced, '둘 다 동기화');
    a.doc.getText('body').insert(0, '가나다');
    b.doc.getText('body').insert(0, '라마');
    await waitFor(
      () => a.doc.getText('body').toString().length === 5 && b.doc.getText('body').toString().length === 5,
      '합쳐짐',
    );
    expect(a.doc.getText('body').toString()).toBe(b.doc.getText('body').toString());
    await waitFor(() => persistedCovers(a) && persistedCovers(b), 'doc.persisted가 기기 상태를 덮음');

    const row = server.db
      .prepare('SELECT plain_text, char_count FROM documents WHERE id = ?')
      .get('dev-merge') as { plain_text: string; char_count: number };
    expect(row.char_count).toBe(5);
    expect(row.plain_text).toBe(a.doc.getText('body').toString());
  });

  it('[실험 ①] 길이를 넘는 편집은 그 메시지부터 거부되고 연결은 읽기 전용이 된다', async () => {
    const a = open('doc:dev-big');
    const b = open('doc:dev-big', { role: 'teacher' });
    await waitFor(() => a.provider.isSynced && b.provider.isSynced, '동기화');
    a.doc.getText('body').insert(0, '짧은 글');
    await waitFor(() => b.doc.getText('body').toString() === '짧은 글', '작은 편집 전달');

    a.doc.getText('body').insert(0, '가'.repeat(250)); // DOC_MAX_CHARS 200 초과
    await waitFor(() => a.events.some(e => e.name === 'doc.error'), 'doc.error');
    expect(a.events.find(e => e.name === 'doc.error')?.data).toEqual({ code: 'E_DOC_TOO_LARGE' });

    // 서버 문서와 다른 기기에는 들어가지 않았다
    await new Promise(resolve => setTimeout(resolve, 300));
    const serverDoc = server.hocuspocus.documents.get('doc:dev-big');
    expect(serverDoc?.getText('body').toString()).toBe('짧은 글');
    expect(b.doc.getText('body').toString()).toBe('짧은 글');
    // 그 연결은 읽기 전용, 기기 사본에는 남아 있다
    const conn = serverDoc?.getConnections().find(c => c.readOnly);
    expect(conn).toBeDefined();
    expect(a.doc.getText('body').length).toBeGreaterThan(200);
    expect(a.provider.unsyncedChanges).toBeGreaterThan(0);
  });

  it('정해진 키가 아닌 것을 만들면 거부한다', async () => {
    const a = open('doc:dev-shape');
    await waitFor(() => a.provider.isSynced, '동기화');
    a.doc.getMap('evil').set('x', 1);
    await waitFor(() => a.events.some(e => e.name === 'doc.error'), 'doc.error');
    expect(server.hocuspocus.documents.get('doc:dev-shape')?.share.has('evil')).toBe(false);
  });

  it('meta는 정해진 키와 카탈로그 값만 받는다(검토 2번)', async () => {
    const ok = open('doc:dev-meta-ok');
    const badSubtype = open('doc:dev-meta-subtype');
    const badKey = open('doc:dev-meta-key');
    const badCut = open('doc:dev-meta-cut');
    await waitFor(() => [ok, badSubtype, badKey, badCut].every(c => c.provider.isSynced), '넷 다 동기화');
    ok.doc.transact(() => {
      const meta = ok.doc.getMap('meta');
      meta.set('subtype', 'short');
      meta.set('mood', 'calm-ballad');
      meta.set('tempo', 'slow');
      meta.set('moodCustom', '잔잔하게');
      meta.set('cutCount', 4);
    });
    badSubtype.doc.getMap('meta').set('subtype', '!');
    badKey.doc.getMap('meta').set('color', 'red');
    badCut.doc.getMap('meta').set('cutCount', -1);
    await waitFor(
      () => [badSubtype, badKey, badCut].every(c => c.events.some(e => e.name === 'doc.error')),
      '틀린 셋 doc.error',
    );
    await waitFor(
      () => server.hocuspocus.documents.get('doc:dev-meta-ok')?.getMap('meta').get('cutCount') === 4,
      '맞는 meta 도착',
    );
    expect(ok.events.some(e => e.name === 'doc.error')).toBe(false);
    for (const name of ['dev-meta-subtype', 'dev-meta-key', 'dev-meta-cut']) {
      expect(server.hocuspocus.documents.get(`doc:${name}`)?.getMap('meta').size).toBe(0);
    }
  });

  it('이미 있는 메모 칸을 다른 Y.Text로 바꾸는 편집은 받지 않는다(검토 3번)', async () => {
    const a = open('doc:dev-memo-swap');
    const b = open('doc:dev-memo-swap', { role: 'teacher' });
    await waitFor(() => a.provider.isSynced && b.provider.isSynced, '동기화');
    const first = new Y.Text();
    a.doc.getMap('memo').set('story_who', first);
    first.insert(0, '나와 친구');
    await waitFor(
      () => b.doc.getMap<Y.Text>('memo').get('story_who')?.toString() === '나와 친구',
      '첫 메모 전달',
    );
    const swap = new Y.Text();
    b.doc.getMap('memo').set('story_who', swap);
    swap.insert(0, '덮어쓰기');
    await waitFor(() => b.events.some(e => e.name === 'doc.error'), 'doc.error');
    const memo = server.hocuspocus.documents.get('doc:dev-memo-swap')?.getMap<Y.Text>('memo');
    expect(memo?.get('story_who')?.toString()).toBe('나와 친구');
    // 같은 칸 안의 글자 편집은 그대로 받는다
    a.doc.getMap<Y.Text>('memo').get('story_who')?.insert(0, '내 ');
    await waitFor(() => memo?.get('story_who')?.toString() === '내 나와 친구', '같은 칸 편집');
  });

  it('제목의 줄바꿈이나 캐리지 리턴(\\r)이 섞인 편집은 거부한다', async () => {
    const badTitle = open('doc:dev-newline');
    const badCr = open('doc:dev-cr');
    await waitFor(() => badTitle.provider.isSynced && badCr.provider.isSynced, '동기화');

    badTitle.doc.getText('title').insert(0, '안녕\n하세요');
    badCr.doc.getText('body').insert(0, '가\r\n나');
    await waitFor(
      () =>
        badTitle.events.some(e => e.name === 'doc.error') && badCr.events.some(e => e.name === 'doc.error'),
      '두 연결 모두 doc.error',
    );
    expect(badTitle.events.find(e => e.name === 'doc.error')?.data).toEqual({ code: 'E_DOC_TOO_LARGE' });
    expect(badCr.events.find(e => e.name === 'doc.error')?.data).toEqual({ code: 'E_DOC_TOO_LARGE' });
    expect(server.hocuspocus.documents.get('doc:dev-newline')?.getText('title').toString()).toBe('');
    expect(server.hocuspocus.documents.get('doc:dev-cr')?.getText('body').toString()).toBe('');
  });

  it('[실험 ②] 잠긴 동안의 편집은 기기에 남고, 풀린 뒤 forceSync로 합쳐진다', async () => {
    const a = open('doc:dev-lock');
    const b = open('doc:dev-lock', { role: 'teacher' });
    await waitFor(() => a.provider.isSynced && b.provider.isSynced, '동기화');

    const lockStudent = (locked: boolean) =>
      setDocumentLock(server.hocuspocus, {
        documentName: 'doc:dev-lock',
        docId: 'dev-lock',
        locked,
        status: locked ? 'SUBMITTED' : 'REOPENED',
        at: Date.now(),
        appliesTo: c => c.context.actor?.role === 'student',
      });

    expect(lockStudent(true)).toBe(1);
    await waitFor(() => a.events.some(e => e.name === 'doc.status' && e.data.locked), 'doc.status 잠김');

    a.doc.getText('body').insert(0, '잠긴 동안');
    b.doc.getText('body').insert(0, '교사');
    await waitFor(() => a.doc.getText('body').toString().includes('교사'), '교사 편집은 학생에게 감');
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(b.doc.getText('body').toString()).toBe('교사');
    expect(a.provider.unsyncedChanges).toBeGreaterThan(0);

    lockStudent(false);
    await waitFor(() => a.events.some(e => e.name === 'doc.status' && !e.data.locked), 'doc.status 풀림');
    a.provider.forceSync();
    await waitFor(() => b.doc.getText('body').toString().includes('잠긴 동안'), '풀린 뒤 합쳐짐');
    expect(a.doc.getText('body').toString()).toBe(b.doc.getText('body').toString());
    await waitFor(() => a.provider.unsyncedChanges === 0, '보낼 것 없음');
  });

  it('저장이 실패하면 알리고, 내리지 않고, 복구되면 다시 저장한다', async () => {
    server.db.exec(
      "CREATE TRIGGER fail_save BEFORE UPDATE ON documents WHEN NEW.id = 'dev-fail' BEGIN SELECT RAISE(ABORT, 'disk'); END",
    );
    const a = open('doc:dev-fail');
    await waitFor(() => a.provider.isSynced, '동기화');
    a.doc.getText('body').insert(0, '실패해도 지킨다');
    await waitFor(() => a.events.some(e => e.name === 'doc.persistFailed'), 'doc.persistFailed');

    const unhealthy = await fetch(`${server.url}/internal/health`);
    expect(unhealthy.status).toBe(503);
    expect(await unhealthy.json()).toMatchObject({ ok: false, persistFailures: 1 });

    a.close();
    clients.splice(clients.indexOf(a), 1);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(server.hocuspocus.documents.has('doc:dev-fail')).toBe(true); // 내리지 않음

    server.db.exec('DROP TRIGGER fail_save');
    await server.realtime.persistence.retryFailed(server.hocuspocus);
    expect((await fetch(`${server.url}/internal/health`)).status).toBe(200);
    expect(server.hocuspocus.documents.has('doc:dev-fail')).toBe(false); // 저장 뒤 내림
    const row = server.db.prepare('SELECT plain_text FROM documents WHERE id = ?').get('dev-fail') as {
      plain_text: string;
    };
    expect(row.plain_text).toBe('실패해도 지킨다');
  });

  it('서버를 껐다 켜도 같은 글이다(끝내기 순서가 저장을 마친다)', async () => {
    const a = open('doc:dev-restart');
    await waitFor(() => a.provider.isSynced, '동기화');
    a.doc.getText('body').insert(0, '다시 켜도 그대로');
    a.doc.getText('title').insert(0, '제목');
    await waitFor(
      () => server.hocuspocus.documents.get('doc:dev-restart')?.getText('title').length === 2,
      '서버 도착',
    );
    a.close();
    clients.splice(clients.indexOf(a), 1);

    await server.stop('restart-test');
    server = await start();

    const b = open('doc:dev-restart');
    await waitFor(() => b.provider.isSynced, '다시 동기화');
    expect(b.doc.getText('body').toString()).toBe('다시 켜도 그대로');
    expect(b.doc.getText('title').toString()).toBe('제목');
    expect(log.lines.some(l => l['event'] === 'shutdown_done')).toBe(true);
  });
});

describe('개발 자격이 꺼져 있으면', () => {
  it('dev 자격을 받지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'geulbang-rt-off-'));
    const server = await startServer({
      config: loadServerConfig({ NODE_ENV: 'test', PORT: '0', DB_PATH: join(dir, 'x.sqlite') }),
      log: createMemoryLogger(),
      webDistDir: join(dir, 'none'),
    });
    expect(server.devSecret).toBeUndefined();
    const c = connect(server, 'doc:dev-a');
    await waitFor(() => c.failures.length === 1, '거부');
    expect(c.failures).toEqual(['E_AUTH']);
    c.close();
    await server.stop('test');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('조용한 연결도 끊기지 않는다(응용 Ping, PLAN §4.7 대응 5)', () => {
  it('하트비트 두 간격이 지나도 제공자가 다시 연결하지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'geulbang-rt-ping-'));
    const server = await startServer({
      config: loadServerConfig({
        NODE_ENV: 'test',
        PORT: '0',
        DB_PATH: join(dir, 'x.sqlite'),
        DEV_DOCS_ENABLED: 'true',
        HEARTBEAT_SEC: '1',
        CLIENT_STALE_SEC: '2',
      }),
      log: createMemoryLogger(),
      devSecret: DEV_SECRET,
      webDistDir: join(dir, 'none'),
    });
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({
      url: `${server.url.replace('http', 'ws')}/ws`,
      messageReconnectTimeout: 2000,
    });
    let disconnects = 0;
    socket.on('disconnect', () => disconnects++);
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: 'doc:dev-quiet',
      document: doc,
      token: encodeCredential({
        v: 1,
        kind: 'dev',
        token: DEV_SECRET,
        deviceId: 'device-quiet',
        role: 'student',
      }),
    });
    provider.attach();
    await waitFor(() => provider.isSynced, '동기화');
    await new Promise(resolve => setTimeout(resolve, 4500));
    expect(disconnects).toBe(0);
    doc.getText('body').insert(0, '아직 연결됨');
    await waitFor(
      () => server.hocuspocus.documents.get('doc:dev-quiet')?.getText('body').toString() === '아직 연결됨',
      '연결 유지',
    );
    provider.destroy();
    socket.destroy();
    await server.stop('test');
    rmSync(dir, { recursive: true, force: true });
  }, 15_000);
});
