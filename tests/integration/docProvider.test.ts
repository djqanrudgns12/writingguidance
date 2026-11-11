import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '@geulbang/core/config';
import type { Credential } from '@geulbang/core/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createMemoryStore } from '../../apps/web/src/adapters/local/localDocStore.ts';
import { createRealtimeAdapter } from '../../apps/web/src/adapters/realtime/session.ts';
import type { LocalStorePort } from '../../apps/web/src/ports/localStore.ts';
import type { Observable } from '../../apps/web/src/ports/observable.ts';
import type { RealtimeSession } from '../../apps/web/src/ports/realtime.ts';
import { loadServerConfig } from '../../apps/server/src/config.ts';
import { createMemoryLogger } from '../../apps/server/src/log.ts';
import { setDocumentLock } from '../../apps/server/src/realtime/locks.ts';
import { startServer, type RunningServer } from '../../apps/server/src/server.ts';

const SECRET = 's'.repeat(43);

async function until<T>(source: Observable<T>, wanted: T, label: string, timeoutMs = 8000): Promise<void> {
  if (source.get() === wanted) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`시간 안에 ${label}=${String(wanted)}이 되지 않음 (지금 ${String(source.get())})`));
    }, timeoutMs);
    const off = source.subscribe(v => {
      if (v === wanted) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`시간 안에 되지 않음: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe('P2-2 기기 연결: 기기 어댑터 + 실제 서버', () => {
  let dir: string;
  let server: RunningServer;
  let port = 0;
  const sessions: RealtimeSession[] = [];
  const config = { ...defaultConfig, RECONNECT_BACKOFF_MS: [100, 200, 400], CLIENT_STALE_SEC: 12 };

  const boot = async () =>
    startServer({
      config: loadServerConfig({
        NODE_ENV: 'test',
        PORT: String(port),
        DB_PATH: join(dir, 'int.sqlite'),
        DEV_DOCS_ENABLED: 'true',
        SERVER_PERSIST_DEBOUNCE_MS: '50',
        SERVER_PERSIST_MAX_WAIT_MS: '200',
      }),
      log: createMemoryLogger(),
      devSecret: SECRET,
      webDistDir: join(dir, 'none'),
    });

  const session = (
    options: { store?: LocalStorePort; secret?: string; role?: 'student' | 'teacher' } = {},
  ) => {
    const adapter = createRealtimeAdapter({
      url: `ws://127.0.0.1:${port}/ws`,
      config,
      localStore: options.store ?? createMemoryStore(),
    });
    const credential = (): Credential => ({
      v: 1,
      kind: 'dev',
      token: options.secret ?? SECRET,
      deviceId: 'device-int-0001',
      role: options.role ?? 'student',
    });
    const s = adapter.connect(credential);
    sessions.push(s);
    return s;
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'geulbang-int-'));
    server = await boot();
    port = server.port;
  });
  afterEach(() => {
    for (const s of sessions.splice(0)) s.close();
  });
  afterAll(async () => {
    await server.stop('test');
    rmSync(dir, { recursive: true, force: true });
  });

  it('쓰면 보내는 중을 거쳐, 서버 DB에 들어간 뒤에만 저장됨이 된다', async () => {
    const s = session();
    const doc = await s.openDoc('dev-save');
    await until(s.state, 'online', '연결');
    // 이 글이 서버와 동기화되기 전에는 `여기에만 저장`이 맞다. 빈 글이 동기화되면 바로 저장됨.
    await until(doc.saveState, 'saved', '빈 글 동기화');
    doc.netDoc.getText('body').insert(0, '글방');
    expect(doc.saveState.get()).toBe('sending');
    await until(doc.saveState, 'saved', '저장 상태');
    const row = server.db.prepare('SELECT plain_text FROM documents WHERE id = ?').get('dev-save') as {
      plain_text: string;
    };
    expect(row.plain_text).toBe('글방');
  });

  it('기기 저장소에 먼저 쌓여, 다른 세션이 같은 저장소로 열면 연결 전에도 글이 있다', async () => {
    const store = createMemoryStore();
    const first = session({ store });
    const a = await first.openDoc('dev-local');
    a.netDoc.getText('body').insert(0, '오프라인에서도');
    await a.flushLocal();
    first.close();

    const second = session({ store, secret: 'x'.repeat(43) }); // 서버에는 못 붙는 자격
    const b = await second.openDoc('dev-local');
    expect(b.netDoc.getText('body').toString()).toBe('오프라인에서도');
    await until(b.failure, 'E_AUTH', '거부');
    expect(b.saveState.get()).toBe('local');
  });

  it('잠기면 locked, 잠긴 동안 쓴 것은 기기에 남고, 풀리면 스스로 다시 보낸다', async () => {
    const student = session();
    const teacher = session({ role: 'teacher' });
    const a = await student.openDoc('dev-lockflow');
    const b = await teacher.openDoc('dev-lockflow');
    await until(a.saveState, 'saved', '학생 첫 저장');

    const lock = (locked: boolean) =>
      setDocumentLock(server.hocuspocus, {
        documentName: 'doc:dev-lockflow',
        docId: 'dev-lockflow',
        locked,
        status: locked ? 'SUBMITTED' : 'REOPENED',
        at: Date.now(),
        appliesTo: c => c.context.actor?.role === 'student',
      });

    lock(true);
    await until(a.locked, true, '잠김');
    expect(a.saveState.get()).toBe('locked');
    a.netDoc.getText('body').insert(0, '제출 뒤에 쓴 글');
    await until(a.unsentWhileLocked, true, '보내지 못한 글 표시');
    expect(b.netDoc.getText('body').toString()).toBe('');

    lock(false);
    await until(a.locked, false, '풀림');
    await waitFor(() => b.netDoc.getText('body').toString() === '제출 뒤에 쓴 글', '풀린 뒤 교사에게 도착');
    await until(a.unsentWhileLocked, false, '보내지 못한 글 없음');
    await until(a.saveState, 'saved', '다시 저장됨');
  });

  it('서버가 이 글 연결만 닫아도(소켓은 유지) 다시 붙는다', async () => {
    const s = session();
    const doc = await s.openDoc('dev-reattach');
    await until(doc.saveState, 'saved', '첫 동기화');
    server.hocuspocus.closeConnections('doc:dev-reattach');
    await new Promise(resolve => setTimeout(resolve, 100));
    doc.netDoc.getText('body').insert(0, '다시 붙은 뒤');
    await waitFor(
      () =>
        server.hocuspocus.documents.get('doc:dev-reattach')?.getText('body').toString() === '다시 붙은 뒤',
      '다시 붙어 서버 도착',
    );
    await until(doc.saveState, 'saved', '다시 저장됨');
  });

  it('저장 뒤 글자만 지워도 서버 DB에 지우기가 들어간 뒤에야 저장됨이 된다(검토 5번)', async () => {
    const s = session();
    const doc = await s.openDoc('dev-delete-only');
    await until(doc.saveState, 'saved', '빈 글 동기화');
    doc.netDoc.getText('body').insert(0, '가나다');
    await until(doc.saveState, 'saved', '첫 저장');
    const dbText = () =>
      (
        server.db.prepare('SELECT plain_text FROM documents WHERE id = ?').get('dev-delete-only') as {
          plain_text: string;
        }
      ).plain_text;
    // 저장됨이 되는 바로 그 순간의 DB 내용을 본다(받기만 하고 쓰기 전이면 옛 글이 보인다).
    const seenAtSaved: string[] = [];
    const off = doc.saveState.subscribe(v => {
      if (v === 'saved') seenAtSaved.push(dbText());
    });
    doc.netDoc.getText('body').delete(1, 1);
    await waitFor(() => seenAtSaved.length > 0, '지운 뒤 저장됨');
    off();
    expect(seenAtSaved).toEqual(['가다']);
  });

  it('기기 저장소 쓰기가 실패하면 알리고 남겨 두었다가, 회복되면 빠짐없이 쓴다(검토 4번)', async () => {
    const inner = createMemoryStore();
    let failing = true;
    const store: LocalStorePort = {
      ...inner,
      appendUpdate: async (docId, update) => {
        if (failing) throw new DOMException('가득 참', 'QuotaExceededError');
        return inner.appendUpdate(docId, update);
      },
    };
    const s = session({ store });
    const doc = await s.openDoc('dev-quota');
    doc.netDoc.getText('body').insert(0, '첫 문장.');
    doc.netDoc.getText('body').insert(5, ' 둘째 문장.');
    await until(doc.storageFailed, true, '저장 실패 알림');
    await expect(doc.flushLocal()).rejects.toMatchObject({ code: 'E_STORAGE_BLOCKED' });

    failing = false;
    await doc.flushLocal(); // 남은 것을 다시 써서 성공
    expect(doc.storageFailed.get()).toBe(false);
    doc.netDoc.getText('body').insert(0, '앞. ');
    await doc.flushLocal();
    const restored = new Y.Doc();
    Y.applyUpdate(restored, (await inner.loadDoc('dev-quota'))!);
    expect(restored.getText('body').toString()).toBe(doc.netDoc.getText('body').toString());
  });

  it('글을 닫으면 기다리던 waitSynced가 거부된다(검토 7번)', async () => {
    const s = session({ secret: 'x'.repeat(43) }); // 서버가 받아 주지 않아 동기화되지 않는다
    const doc = await s.openDoc('dev-close-wait');
    doc.netDoc.getText('body').insert(0, '못 보낸 글');
    const waiting = expect(doc.waitSynced()).rejects.toMatchObject({ code: 'E_AUTH', retryable: false });
    await until(doc.failure, 'E_AUTH', '거부');
    await waiting;
    const another = await s.openDoc('dev-close-wait-2');
    const pending = another.waitSynced();
    another.close();
    await expect(pending).rejects.toMatchObject({ code: 'E_OFFLINE', retryable: true });
  });

  it('서버가 꺼져도 계속 쓰고(여기에만 저장), 다시 켜지면 합쳐진다', async () => {
    const s = session();
    const doc = await s.openDoc('dev-outage');
    await until(doc.saveState, 'saved', '첫 동기화');

    await server.stop('outage');
    await until(s.state, 'server-down', '서버 끊김');
    doc.netDoc.getText('body').insert(0, '서버가 없을 때');
    expect(doc.saveState.get()).toBe('local');

    server = await boot();
    await until(s.state, 'online', '다시 연결');
    await until(doc.saveState, 'saved', '합쳐져 저장됨');
    const row = server.db.prepare('SELECT plain_text FROM documents WHERE id = ?').get('dev-outage') as {
      plain_text: string;
    };
    expect(row.plain_text).toBe('서버가 없을 때');
  });
});
