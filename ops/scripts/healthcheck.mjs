#!/usr/bin/env node
// 쌤유 글방 상태 확인 도구(PLAN §15.2) — ① 로컬 /internal/health ② 공개 /api/health ③ 공개 wss://.../ws 101 ④ 원본 직접 접근 403을 점검한다.
// 외부 npm 패키지에 의존하지 않고 Node 24 내장 모듈만 사용하여 첫 배포 전 bootstrap 사본에서도 단독 실행된다.
// 보안 규칙: 응답 본문 원문·토큰·별명·IP는 절대 로그나 표준 출력에 찍지 않는다.

import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { parseArgs } from 'node:util';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
// RFC 6455 클라이언트 마스킹 정상 종료 프레임(Close, FIN=1, opcode=8, MASK=1, len=0, mask=00000000)
const WS_MASKED_CLOSE_FRAME = Buffer.from([0x88, 0x80, 0x00, 0x00, 0x00, 0x00]);

function printUsage() {
  process.stdout.write(
    [
      '사용법: node ops/scripts/healthcheck.mjs [옵션]',
      '   또는: sh ops/we.sh healthcheck [옵션]',
      '',
      '글방 운영 경로를 점검합니다(본문·토큰 출력 없음).',
      '  ① http://127.0.0.1:4460/internal/health (릴리스·DB·스키마 판·연결 수·저장 실패 0건)',
      '  ② https://write.ssamuniverse.com/api/health (공개 API 200·DB ok)',
      '  ③ wss://write.ssamuniverse.com/ws (웹소켓 101 업그레이드)',
      '  ④ https://origin-write.ssamuniverse.com/api/health (비밀 머리 없는 직접 호출 403 차단)',
      '',
      '옵션:',
      '  --local-only                ① 로컬 /internal/health 와 로컬 ws://127.0.0.1:<port>/ws 101만 점검합니다.',
      '  --expect-release <릴리스>   서버가 보고하는 릴리스 식별자(예: releases/abc1234) 일치 여부를 검증합니다.',
      '  --port <포트>               로컬 서버 포트 (기본: $WE_PORT 또는 4460)',
      '  --public-origin <주소>      공개 주소 (기본: $WE_PUBLIC_ORIGIN 또는 https://write.ssamuniverse.com)',
      '  --origin-host <호스트>      원본 호스트 (기본: $WE_ORIGIN_HOST 또는 origin-write.ssamuniverse.com)',
      '  --timeout-ms <밀리초>       개별 점검 제한 시간 (기본: 10000)',
      '  --quiet                     성공 시 출력을 생략하고 실패 요약만 표준 오류에 남깁니다(하트비트용).',
      '  -h, --help                  이 도움말을 보여 줍니다.',
      '',
    ].join('\n'),
  );
}

let parsed;
try {
  parsed = parseArgs({
    options: {
      'local-only': { type: 'boolean', default: false },
      'expect-release': { type: 'string' },
      port: { type: 'string' },
      'public-origin': { type: 'string' },
      'origin-host': { type: 'string' },
      'timeout-ms': { type: 'string' },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
} catch (error) {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : '인자 오류'} (--help 참고)\n`);
  process.exit(1);
}

if (parsed.values.help) {
  printUsage();
  process.exit(0);
}

const localOnly = parsed.values['local-only'];
const expectedRelease = parsed.values['expect-release'];
const port = Number(parsed.values.port ?? process.env['WE_PORT'] ?? '4460');
const publicOrigin =
  parsed.values['public-origin'] ?? process.env['WE_PUBLIC_ORIGIN'] ?? 'https://write.ssamuniverse.com';
const originHost =
  parsed.values['origin-host'] ?? process.env['WE_ORIGIN_HOST'] ?? 'origin-write.ssamuniverse.com';
const timeoutMs = Number(parsed.values['timeout-ms'] ?? '10000');
const quiet = parsed.values.quiet;

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  process.stderr.write('ERROR: 유효하지 않은 포트 번호입니다\n');
  process.exit(1);
}
if (!Number.isFinite(timeoutMs) || timeoutMs < 500) {
  process.stderr.write('ERROR: timeout-ms는 500 이상이어야 합니다\n');
  process.exit(1);
}

async function checkInternalHealth() {
  const url = `http://127.0.0.1:${port}/internal/health`;
  const res = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status !== 200) {
    await res.body?.cancel();
    return { ok: false, name: '① 로컬 /internal/health', reason: `HTTP ${res.status}` };
  }
  const body = await res.json();
  const valid =
    body !== null &&
    typeof body === 'object' &&
    body.ok === true &&
    body.db === 'ok' &&
    body.persistFailures === 0 &&
    typeof body.release === 'string' &&
    typeof body.schemaVersion === 'string' &&
    typeof body.connections === 'number';

  if (!valid) {
    return {
      ok: false,
      name: '① 로컬 /internal/health',
      reason: '응답 필드 검증 실패(ok/db/persistFailures)',
    };
  }
  if (expectedRelease && body.release !== expectedRelease) {
    return {
      ok: false,
      name: '① 로컬 /internal/health',
      reason: `릴리스 불일치 (기대 ${expectedRelease}, 실제 ${String(body.release)})`,
    };
  }
  return {
    ok: true,
    name: '① 로컬 /internal/health',
    detail: `release=${body.release} schema=${body.schemaVersion} conn=${body.connections}`,
  };
}

async function checkPublicApiHealth() {
  const url = new URL('/api/health', publicOrigin);
  const res = await fetch(url, {
    redirect: 'error',
    headers: { 'user-agent': 'geulbang-healthcheck/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const pop = res.headers.get('x-amz-cf-pop') ?? '-';
  if (res.status !== 200) {
    await res.body?.cancel();
    return { ok: false, name: '② 공개 /api/health', reason: `HTTP ${res.status} (pop=${pop})` };
  }
  const envelope = await res.json();
  const data = envelope !== null && typeof envelope === 'object' ? envelope.data : null;
  if (!data || typeof data !== 'object' || data.ok !== true || data.db !== 'ok') {
    return { ok: false, name: '② 공개 /api/health', reason: `봉투 검증 실패 (pop=${pop})` };
  }
  if (expectedRelease && data.version !== expectedRelease) {
    return {
      ok: false,
      name: '② 공개 /api/health',
      reason: `공개 릴리스 불일치 (기대 ${expectedRelease}, 실제 ${String(data.version)})`,
    };
  }
  return {
    ok: true,
    name: '② 공개 /api/health',
    detail: `HTTP 200 version=${String(data.version)} pop=${pop}`,
  };
}

function checkWebSocketUpgrade(wsUrlString, label) {
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let wsUrl;
    try {
      wsUrl = new URL(wsUrlString);
    } catch {
      finish({ ok: false, name: label, reason: '잘못된 WebSocket 주소 형식' });
      return;
    }

    const secure = wsUrl.protocol === 'wss:';
    const targetPort = wsUrl.port ? Number(wsUrl.port) : secure ? 443 : 80;
    const hostHeader = wsUrl.port ? `${wsUrl.hostname}:${wsUrl.port}` : wsUrl.hostname;
    const wsKey = randomBytes(16).toString('base64');
    const expectedAccept = createHash('sha1')
      .update(wsKey + WS_GUID)
      .digest('base64');

    const socket = secure
      ? tls.connect({
          host: wsUrl.hostname,
          port: targetPort,
          servername: wsUrl.hostname,
          ALPNProtocols: ['http/1.1'],
        })
      : net.connect({ host: wsUrl.hostname, port: targetPort });

    const timer = setTimeout(() => {
      socket.destroy();
      finish({ ok: false, name: label, reason: `시간 초과 (${timeoutMs}ms)` });
    }, timeoutMs);

    const sendRequest = () => {
      const pathWithQuery = `${wsUrl.pathname || '/'}${wsUrl.search || ''}`;
      const reqLines = [
        `GET ${pathWithQuery} HTTP/1.1`,
        `Host: ${hostHeader}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Version: 13',
        'User-Agent: geulbang-healthcheck/1.0',
        '',
        '',
      ].join('\r\n');
      socket.write(reqLines);
    };

    if (secure) socket.once('secureConnect', sendRequest);
    else socket.once('connect', sendRequest);

    let headerBuf = '';
    socket.on('data', chunk => {
      headerBuf += chunk.toString('latin1');
      if (headerBuf.length > 16_384) {
        socket.destroy();
        finish({ ok: false, name: label, reason: '응답 머리 크기 초과' });
        return;
      }
      const sep = headerBuf.indexOf('\r\n\r\n');
      if (sep === -1) return;

      const lines = headerBuf.slice(0, sep).split('\r\n');
      const statusLine = lines[0] ?? '';
      const statusMatch = /^HTTP\/1\.1\s+(\d{3})\b/.exec(statusLine);
      const statusCode = statusMatch ? Number(statusMatch[1]) : 0;

      const headers = new Map();
      for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        const colon = line.indexOf(':');
        if (colon > 0) {
          headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
        }
      }

      if (statusCode === 101 && headers.get('sec-websocket-accept') === expectedAccept) {
        try {
          socket.write(WS_MASKED_CLOSE_FRAME);
        } catch {
          // 닫기 프레임 전송 실패는 무시
        }
        socket.end();
        finish({ ok: true, name: label, detail: 'HTTP 101 Switching Protocols' });
      } else {
        socket.destroy();
        finish({ ok: false, name: label, reason: `HTTP ${statusCode || '응답 이상'}` });
      }
    });

    socket.on('error', err => {
      socket.destroy();
      finish({ ok: false, name: label, reason: err.code ? `연결 오류 (${err.code})` : '연결 오류' });
    });

    socket.on('end', () => {
      finish({ ok: false, name: label, reason: '업그레이드 전 연결 종료' });
    });
  });
}

async function checkOriginDirectBlocked() {
  const url = `https://${originHost}/api/health`;
  const res = await fetch(url, {
    redirect: 'manual',
    headers: { 'user-agent': 'geulbang-healthcheck/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  await res.body?.cancel();
  if (res.status !== 403) {
    return {
      ok: false,
      name: '④ 원본 직접 호출 차단',
      reason: `기대 HTTP 403, 실제 HTTP ${res.status}`,
    };
  }
  return { ok: true, name: '④ 원본 직접 호출 차단', detail: 'HTTP 403 (잠금 확인)' };
}

async function runChecks() {
  const checks = [];
  try {
    checks.push(await checkInternalHealth());
  } catch (err) {
    checks.push({
      ok: false,
      name: '① 로컬 /internal/health',
      reason: err instanceof Error && 'code' in err ? String(err.code) : '요청 실패',
    });
  }

  if (localOnly) {
    checks.push(await checkWebSocketUpgrade(`ws://127.0.0.1:${port}/ws`, '①-b 로컬 ws://127.0.0.1/ws'));
    return checks;
  }

  const publicUrl = new URL(publicOrigin);
  const wssProtocol = publicUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const wssUrl = `${wssProtocol}//${publicUrl.host}/ws`;

  const [pubApi, pubWs, originLock] = await Promise.all([
    checkPublicApiHealth().catch(() => ({
      ok: false,
      name: '② 공개 /api/health',
      reason: '요청 실패',
    })),
    checkWebSocketUpgrade(wssUrl, '③ 공개 wss:///ws'),
    checkOriginDirectBlocked().catch(() => ({
      ok: false,
      name: '④ 원본 직접 호출 차단',
      reason: '요청 실패',
    })),
  ]);

  checks.push(pubApi, pubWs, originLock);
  return checks;
}

const results = await runChecks();
const failed = results.filter(r => !r.ok);

if (!quiet) {
  for (const r of results) {
    if (r.ok) process.stdout.write(`[OK]   ${r.name} — ${r.detail}\n`);
    else process.stdout.write(`[FAIL] ${r.name} — ${r.reason}\n`);
  }
} else {
  for (const r of failed) {
    process.stderr.write(`[FAIL] ${r.name} — ${r.reason}\n`);
  }
}

if (failed.length > 0) {
  process.exitCode = 1;
}
