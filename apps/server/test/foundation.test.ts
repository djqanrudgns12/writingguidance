import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { loadServerConfig, paths, StartupError } from '../src/config.ts';
import { openDatabase } from '../src/store/db.ts';
import { migrate, readMigrations } from '../src/store/migrate.ts';
import { startTestServer, type TestServer } from './helpers.ts';

describe('HTTP 기반', () => {
  let t: TestServer;
  let webDist: string;

  beforeAll(async () => {
    webDist = mkdtempSync(join(tmpdir(), 'geulbang-web-'));
    mkdirSync(join(webDist, 'assets'));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>글방</title>');
    writeFileSync(join(webDist, 'assets', 'app-abc123.js'), 'console.log(1)');
    mkdirSync(join(webDist, 'dev'));
    writeFileSync(join(webDist, 'dev', 'index.html'), '<!doctype html><title>개발 화면</title>');
    t = await startTestServer({}, { webDistDir: webDist });
  });
  afterAll(async () => {
    await t.close();
    rmSync(webDist, { recursive: true, force: true });
  });

  it('상태 확인은 봉투와 보안 머리를 붙여 답한다', async () => {
    const res = await fetch(`${t.server.url}/api/health`, { headers: { 'x-request-id': 'req-12345678' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown>; requestId: string };
    expect(body.requestId).toBe('req-12345678');
    expect(body.data).toMatchObject({ ok: true, db: 'ok', aiToday: 0, version: 'dev' });
    expect(res.headers.get('x-request-id')).toBe('req-12345678');
    expect(Number(res.headers.get('x-server-now'))).toBeGreaterThan(0);
    expect(res.headers.get('content-security-policy')).toContain(
      "connect-src 'self' wss://write.ssamuniverse.com",
    );
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('잘못된 요청 ID는 쓰지 않고 새로 만든다', async () => {
    const res = await fetch(`${t.server.url}/api/health`, { headers: { 'x-request-id': 'x' } });
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).not.toBe('x');
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('모르는 API는 404 봉투', async () => {
    const res = await fetch(`${t.server.url}/api/nope`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; retryable: boolean } };
    expect(body.error).toMatchObject({ code: 'E_INPUT', retryable: false });
  });

  it('기본 크기 상한(8KB)을 넘는 본문은 413', async () => {
    const res = await fetch(`${t.server.url}/api/nope`, { method: 'POST', body: 'x'.repeat(9000) });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('E_INPUT');
  });

  it('맥 안 상태 확인은 터널을 거친 요청에 404', async () => {
    const local = await fetch(`${t.server.url}/internal/health`);
    expect(local.status).toBe(200);
    expect(await local.json()).toMatchObject({ ok: true, schemaVersion: '0001', connections: 0 });
    const viaTunnel = await fetch(`${t.server.url}/internal/health`, {
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    });
    expect(viaTunnel.status).toBe(404);
  });

  it('정적 파일: 해시 자산은 1년 캐시, 앱 껍데기는 no-cache, 없는 자산은 404', async () => {
    const asset = await fetch(`${t.server.url}/assets/app-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const shell = await fetch(`${t.server.url}/482913`);
    expect(shell.status).toBe(200);
    expect(shell.headers.get('cache-control')).toBe('no-cache');
    expect(await shell.text()).toContain('<title>글방</title>');
    expect((await fetch(`${t.server.url}/assets/missing.js`)).status).toBe(404);
  });

  it('개발 화면을 켜지 않으면 /dev/* 도 앱 껍데기를 준다', async () => {
    const res = await fetch(`${t.server.url}/dev/editor`);
    expect(await res.text()).toContain('<title>글방</title>');
  });

  it('실기기 시험 빌드를 DEV_DOCS_ENABLED로 내주면 /dev/* 는 개발 화면 껍데기', async () => {
    const dev = await startTestServer(
      { DEV_DOCS_ENABLED: 'true', DEV_SECRET: 'a'.repeat(43) },
      { webDistDir: webDist },
    );
    try {
      expect(dev.server.devSecret).toBe('a'.repeat(43));
      const editor = await fetch(`${dev.server.url}/dev/editor`);
      expect(editor.headers.get('cache-control')).toBe('no-cache');
      expect(await editor.text()).toContain('<title>개발 화면</title>');
      expect(await (await fetch(`${dev.server.url}/482913`)).text()).toContain('<title>글방</title>');
    } finally {
      await dev.close();
    }
  });
});

describe('웹소켓 기반', () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(async () => {
    await t.close();
  });

  const wsUrl = () => t.server.url.replace('http://', 'ws://') + '/ws';

  it('/ws는 열리고 다른 경로는 닫힌다', async () => {
    const ok = new WebSocket(wsUrl());
    await new Promise<void>((resolve, reject) => {
      ok.onopen = () => resolve();
      ok.onerror = () => reject(new Error('open failed'));
    });
    ok.close();

    const bad = new WebSocket(t.server.url.replace('http://', 'ws://') + '/other');
    const outcome = await new Promise<string>(resolve => {
      bad.onopen = () => resolve('open');
      bad.onerror = () => resolve('error');
    });
    expect(outcome).toBe('error');
  });

  it('자격 종류가 붙기 전(P1)에는 어떤 문서도 열리지 않는다', async () => {
    const socket = new HocuspocusProviderWebsocket({ url: wsUrl() });
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: 'doc:3f0c6a52-1f7e-4c2a-9d8e-2b7f1c0a9e11',
      document: new Y.Doc(),
      token: '{"v":1,"kind":"student","token":"' + 'a'.repeat(43) + '","deviceId":"device-0001"}',
    });
    provider.attach();
    const reason = await new Promise<string>(resolve =>
      provider.on('authenticationFailed', (e: { reason: string }) => resolve(e.reason)),
    );
    expect(reason).toContain('E_AUTH');
    provider.destroy();
    socket.destroy();
  });

  it('잘못된 프레임을 받아도 서버는 계속 답한다(PLAN §4.7 대응 10)', async () => {
    const { port } = t.server;
    await new Promise<void>((resolve, reject) => {
      const sock = connect(port, '127.0.0.1');
      const key = randomBytes(16).toString('base64');
      sock.on('error', () => resolve());
      sock.on('close', () => resolve());
      sock.once('data', chunk => {
        if (!chunk.toString().startsWith('HTTP/1.1 101')) return reject(new Error('no upgrade'));
        // RSV1이 켜진 프레임(확장 없음) → ws가 "Invalid WebSocket frame"으로 소켓 오류를 낸다.
        sock.write(Buffer.from([0xc1, 0x80, 0x00, 0x00, 0x00, 0x00]));
      });
      sock.write(
        `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    const res = await fetch(`${t.server.url}/api/health`);
    expect(res.status).toBe(200);
    expect(t.log.lines.some(l => l['event'] === 'ws_error')).toBe(true);
  });

  it('크기 상한을 넘는 메시지는 그 연결만 닫는다', async () => {
    const ws = new WebSocket(wsUrl());
    await new Promise<void>(resolve => (ws.onopen = () => resolve()));
    const code = await new Promise<number>(resolve => {
      ws.onclose = e => resolve(e.code);
      ws.send(new Uint8Array(t.config.product.WS_MAX_PAYLOAD_BYTES + 1));
    });
    expect(code).toBe(1009);
    expect((await fetch(`${t.server.url}/api/health`)).status).toBe(200);
  });
});

describe('마이그레이션', () => {
  it('처음에 적용하고 두 번째는 아무것도 안 한다', () => {
    const db = openDatabase(':memory:', { create: true });
    const first = migrate(db, paths.migrationsDir, 1);
    expect(first.applied).toEqual(['0001']);
    const second = migrate(db, paths.migrationsDir, 2);
    expect(second.applied).toEqual([]);
    expect(second.current).toBe('0001');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map(r => r.name)).toEqual(
      expect.arrayContaining([
        'rooms',
        'participants',
        'documents',
        'snapshots',
        'ai_usage',
        'commands',
        'schema_migrations',
      ]),
    );
    db.close();
  });

  it('적용된 파일이 바뀌면 시작을 거부한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geulbang-mig-'));
    const sql = readFileSync(join(paths.migrationsDir, '0001_init.sql'), 'utf8');
    writeFileSync(join(dir, '0001_init.sql'), sql);
    const db = openDatabase(':memory:', { create: true });
    migrate(db, dir, 1);
    writeFileSync(join(dir, '0001_init.sql'), `${sql}\n-- changed`);
    expect(() => migrate(db, dir, 2)).toThrow(/내용이 바뀌었습니다/);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('더 새 릴리스가 적용한 판은 막지 않고 알려 준다(되돌리기 호환)', () => {
    const db = openDatabase(':memory:', { create: true });
    migrate(db, paths.migrationsDir, 1);
    db.prepare('INSERT INTO schema_migrations (version, sha256, applied_at) VALUES (?, ?, ?)').run(
      '0002',
      'x',
      2,
    );
    const report = migrate(db, paths.migrationsDir, 3);
    expect(report.ahead).toEqual(['0002']);
    db.close();
  });

  it('외래키와 secure_delete가 켜져 있다', () => {
    const db = openDatabase(':memory:', { create: true });
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('secure_delete', { simple: true })).toBe(1);
    db.close();
  });

  it('파일 이름 규칙', () => {
    const files = readMigrations(paths.migrationsDir);
    expect(files.map(f => f.file)).toEqual(['0001_init.sql']);
    expect(files[0]?.sha256).toBe(
      createHash('sha256')
        .update(files[0]?.sql ?? '')
        .digest('hex'),
    );
  });
});

describe('운영 설정', () => {
  const productionBase = {
    NODE_ENV: 'production',
    DB_PATH: '/tmp/x.sqlite',
    PIN_HMAC_KEY: randomBytes(32).toString('base64'),
    PIN_ENC_KEY: randomBytes(32).toString('base64'),
    ID_HMAC_KEY: randomBytes(32).toString('base64'),
    ANTHROPIC_API_KEY: 'sk-test',
    TEACHER_START_CODE: '12345678',
  };

  it('운영 필수값이 다 있으면 시작한다', () => {
    const c = loadServerConfig(productionBase);
    expect(c.ops.NODE_ENV).toBe('production');
    expect(c.generatedSecrets).toEqual(['PERSONAL_HMAC_KEY']);
  });

  it.each([
    ['DEV_DOCS_ENABLED', { DEV_DOCS_ENABLED: 'true' }],
    ['DEV_SECRET', { DEV_SECRET: 'a'.repeat(43) }],
    ['ROOM_TTL_MINUTES_OVERRIDE', { ROOM_TTL_MINUTES_OVERRIDE: '2' }],
    ['AI_PROVIDER=fake', { AI_PROVIDER: 'fake' }],
    ['SNAPSHOT_INTERVAL_SEC', { SNAPSHOT_INTERVAL_SEC: '1' }],
    ['DB_PATH', { DB_PATH: '' }],
    ['PIN_HMAC_KEY', { PIN_HMAC_KEY: '' }],
    ['ANTHROPIC_API_KEY', { ANTHROPIC_API_KEY: '' }],
    ['TEACHER_START_CODE', { TEACHER_START_CODE: '' }],
  ])('운영에서 %s 문제가 있으면 거부한다', (_name, patch) => {
    const env: Record<string, string | undefined> = { ...productionBase, ...patch };
    for (const [k, v] of Object.entries(env)) if (v === '') delete env[k];
    expect(() => loadServerConfig(env)).toThrow(StartupError);
  });

  it('시작 코드 자릿수가 설정과 다르면 거부한다', () => {
    expect(() => loadServerConfig({ NODE_ENV: 'development', TEACHER_START_CODE: '123' })).toThrow(
      StartupError,
    );
  });

  it('개발에서는 비어 있는 비밀값을 이번 실행용 무작위 값으로 채운다', () => {
    const c = loadServerConfig({ NODE_ENV: 'development' });
    expect(c.generatedSecrets).toEqual(['PIN_HMAC_KEY', 'PIN_ENC_KEY', 'ID_HMAC_KEY', 'PERSONAL_HMAC_KEY']);
    expect(c.secrets.pinEncKey.length).toBe(32);
    expect(c.ops.DB_PATH).toBe(paths.devDbPath);
  });
});
