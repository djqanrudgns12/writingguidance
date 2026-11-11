import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOC_KEYS } from '@geulbang/core';
import { defaultConfig } from '@geulbang/core/config';
import type { Credential } from '@geulbang/core/protocol';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../apps/web/src/adapters/local/localDocStore.ts';
import { openDevPrimaryConnection, type DevPrimaryConnection } from '../../apps/web/src/dev/devRealtime.ts';
import { createTeacherBot, type TeacherBot } from '../../apps/web/src/dev/teacherBot.ts';
import type { Observable } from '../../apps/web/src/ports/observable.ts';
import { loadServerConfig } from '../../apps/server/src/config.ts';
import { createMemoryLogger } from '../../apps/server/src/log.ts';
import { startServer, type RunningServer } from '../../apps/server/src/server.ts';

const SECRET = 'd'.repeat(43);

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

describe('P2-4 /dev/editor 연결·교사 봇 통합 확인', () => {
  let dir: string;
  let server: RunningServer;
  let wsUrl = '';
  const primaries: DevPrimaryConnection[] = [];
  const bots: TeacherBot[] = [];
  const config = {
    ...defaultConfig,
    RECONNECT_BACKOFF_MS: [100, 200, 400],
    CLIENT_STALE_SEC: 12,
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'geulbang-dev-editor-'));
    server = await startServer({
      config: loadServerConfig({
        NODE_ENV: 'test',
        PORT: '0',
        DB_PATH: join(dir, 'dev-editor.sqlite'),
        DEV_DOCS_ENABLED: 'true',
        SERVER_PERSIST_DEBOUNCE_MS: '50',
        SERVER_PERSIST_MAX_WAIT_MS: '200',
      }),
      log: createMemoryLogger(),
      devSecret: SECRET,
      webDistDir: join(dir, 'none'),
    });
    wsUrl = `ws://127.0.0.1:${server.port}/ws`;
  });

  afterEach(() => {
    for (const b of bots.splice(0)) b.close();
    for (const p of primaries.splice(0)) p.close();
  });

  afterAll(async () => {
    await server.stop('test');
    rmSync(dir, { recursive: true, force: true });
  });

  const makeCred = (role: 'student' | 'teacher', deviceId: string, token = SECRET): (() => Credential) => {
    return () => ({ v: 1, kind: 'dev', token, deviceId, role });
  };

  it('잘못된 개발 비밀값이면 E_AUTH로 거부된다', async () => {
    const primary = await openDevPrimaryConnection({
      url: wsUrl,
      config,
      localStore: createMemoryStore(),
      credential: makeCred('student', 'dev-main-bad001', 'x'.repeat(43)),
      docId: 'dev-auth-fail',
    });
    primaries.push(primary);

    await until(primary.doc.failure, 'E_AUTH', '인증 거부');
  });

  it('학생 상대 커서를 읽어 교사 봇 시나리오 1~5와 awareness 원격 커서가 서버를 거쳐 동작한다', async () => {
    const docId = 'dev-bot-scenarios';
    const primary = await openDevPrimaryConnection({
      url: wsUrl,
      config,
      localStore: createMemoryStore(),
      credential: makeCred('student', 'dev-main-good01'),
      docId,
    });
    primaries.push(primary);

    const bot = await createTeacherBot({
      url: wsUrl,
      config,
      docId,
      credential: makeCred('teacher', 'dev-bot-good01'),
      getStudentClientId: () => primary.doc.awareness?.clientID ?? null,
    });
    bots.push(bot);

    await until(primary.doc.saveState, 'saved', '학생 초기 동기화');
    await until(bot.doc.saveState, 'saved', '봇 초기 동기화');

    // 봇의 교사 awareness 원격 커서가 학생 세션에 전달되는지 확인
    await waitFor(() => {
      const states = primary.doc.awareness?.getStates();
      if (!states) return false;
      for (const [cid, st] of states) {
        if (cid === primary.doc.awareness?.clientID) continue;
        const role = (st['user'] as Record<string, unknown> | undefined)?.['role'];
        if (role === 'teacher' && st['cursor']) return true;
      }
      return false;
    }, '교사 봇 원격 커서 수신');

    const studentBody = primary.doc.netDoc.getText(DOC_KEYS.body);
    studentBody.insert(0, '첫째 줄입니다.\n우리 학교운동장 달리기');

    const publishStudentCaret = (index: number) => {
      const rel = Y.createRelativePositionFromTypeIndex(studentBody, index, -1);
      const json = Y.relativePositionToJSON(rel);
      primary.doc.awareness?.setLocalStateField('user', { role: 'student' });
      primary.doc.awareness?.setLocalStateField('cursor', { anchor: json, head: json });
    };

    await waitFor(
      () => bot.doc.netDoc.getText(DOC_KEYS.body).toString() === studentBody.toString(),
      '학생 초안이 봇에 도착',
    );

    // 학생 커서를 '학교운동장' 끝('장' 바로 뒤)에 둠
    const wordEnd = studentBody.toString().indexOf('학교운동장') + '학교운동장'.length;
    publishStudentCaret(wordEnd);
    await new Promise(resolve => setTimeout(resolve, 80));

    // 1. 커서 바로 앞 끼우기 ('장' 왼쪽에 [앞] 삽입)
    bot.trigger('before-caret');
    await waitFor(() => studentBody.toString().includes('학교운동[앞]장'), '시나리오 1 도착');

    // 2. 커서 바로 뒤 끼우기 ('장' 오른쪽에 [뒤] 삽입)
    const afterWordEnd = studentBody.toString().indexOf('장') + 1;
    publishStudentCaret(afterWordEnd);
    await new Promise(resolve => setTimeout(resolve, 60));
    bot.trigger('after-caret');
    await waitFor(() => studentBody.toString().includes('장[뒤]'), '시나리오 2 도착');

    // 3. 같은 낱말 안 끼우기 ('달리기' 끝에서 부르면 '달리'와 '기' 사이에 들어감)
    const runEnd = studentBody.toString().indexOf('달리기') + '달리기'.length;
    publishStudentCaret(runEnd);
    await new Promise(resolve => setTimeout(resolve, 60));
    bot.trigger('inside-word');
    await waitFor(() => studentBody.toString().includes('달리빛기'), '시나리오 3 도착');

    // 4. 같은 문단 다른 곳 (둘째 문단 끝에 커서가 있으므로 둘째 문단 맨 앞에 [문단앞] 삽입)
    const p2End = studentBody.toString().length;
    publishStudentCaret(p2End);
    await new Promise(resolve => setTimeout(resolve, 60));
    bot.trigger('same-paragraph');
    await waitFor(() => studentBody.toString().includes('\n[문단앞] 우리'), '시나리오 4 도착');

    // 5. 커서를 포함한 범위 지우기
    const beforeLen = studentBody.length;
    const mid = Math.floor(beforeLen / 2);
    publishStudentCaret(mid);
    await new Promise(resolve => setTimeout(resolve, 60));
    bot.trigger('delete-across-caret');
    await waitFor(() => studentBody.length < beforeLen, '시나리오 5 범위 삭제 도착');
  });

  it('연결 끊기 중 학생 편집과 교사 봇 편집을 하고 다시 이으면 둘 다 합쳐져 SQLite에 저장된다', async () => {
    const docId = 'dev-offline-merge';
    const primary = await openDevPrimaryConnection({
      url: wsUrl,
      config,
      localStore: createMemoryStore(),
      credential: makeCred('student', 'dev-main-off001'),
      docId,
    });
    primaries.push(primary);

    const bot = await createTeacherBot({
      url: wsUrl,
      config,
      docId,
      credential: makeCred('teacher', 'dev-bot-off001'),
    });
    bots.push(bot);

    await until(primary.doc.saveState, 'saved', '초기 연결');
    await until(bot.doc.saveState, 'saved', '봇 초기 연결');

    primary.disconnect();
    await until(primary.state, 'offline', '수동 연결 끊기');

    // 오프라인 동안 학생이 글을 씀
    const studentBody = primary.doc.netDoc.getText(DOC_KEYS.body);
    studentBody.insert(0, '학생오프라인글');
    expect(primary.doc.saveState.get()).toBe('local');

    // 같은 시각 교사 봇은 지연 300ms로 서버 글을 고침
    bot.setDelayMs(300);
    bot.trigger('after-caret');
    await waitFor(
      () => bot.doc.netDoc.getText(DOC_KEYS.body).toString().length > 0,
      '지연 300ms 봇 편집 완료',
    );
    expect(studentBody.toString()).toBe('학생오프라인글');

    // 다시 잇기 → 두 글 병합 후 SQLite 저장까지 확인
    primary.reconnect();
    await until(primary.state, 'online', '재연결');
    await waitFor(
      () => studentBody.toString().includes('학생오프라인글') && studentBody.toString().includes('[뒤]'),
      '오프라인 편집과 봇 편집 병합',
    );
    await until(primary.doc.saveState, 'saved', '서버 DB 저장 완료');

    const row = server.db.prepare('SELECT plain_text FROM documents WHERE id = ?').get(docId) as {
      plain_text: string;
    };
    expect(row.plain_text).toContain('학생오프라인글');
    expect(row.plain_text).toContain('[뒤]');
  });
});
