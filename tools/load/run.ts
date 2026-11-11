import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { countChars, DOC_KEYS } from '@geulbang/core';
import { defaultConfig } from '@geulbang/core/config';
import {
  decodeDocEvent,
  decodeRoomMessage,
  docDocumentName,
  encodeCommand,
  encodeCredential,
  roomDocumentName,
  type Ack,
  type CommandName,
  type Credential,
  type RoomEvent,
} from '@geulbang/core/protocol';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { loadServerConfig } from '../../apps/server/src/config.ts';
import { createMemoryLogger } from '../../apps/server/src/log.ts';
import { startServer, type RunningServer } from '../../apps/server/src/server.ts';

/**
 * 실시간 부하 시험 도구(PLAN §10.6, P5-6).
 * - 실행: `node --conditions=@geulbang/source tools/load/run.ts [옵션]`
 * - 흐름: REST 수업방 생성 → 교사 연결 → 학생 N명 입장·연결·`doc.create` →
 *   학생은 초당 한글 2~3음절 입력 + 3~10초 쉼 반복, 교사는 30초마다 서랍(`doc:*`)을 옮기며 가끔 한 글자 고침.
 * - 측정: 서버 `precheck`가 허용하지 않는 임의 `meta` 키를 쓰지 않고, 본문(`body`)에 순수 가상 한글만 넣은 뒤
 *   목표 글자 수(`countChars`)가 교사 서랍·타일(`summary.batch`)·학생 문서에 도달하는 시각으로 지연을 잰다.
 */

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** 통과 기준(PLAN §10.6) */
const THRESHOLDS = {
  drawerP95Ms: 1000,
  tileP95Ms: 3000,
  teacherToStudentP95Ms: 1000,
  maxDisconnects: 0,
  maxCpuAvgPct: 5,
  maxMemRssMb: 300,
} as const;

const DRAWER_ROTATE_MS = 30_000;
const TEACHER_EDIT_INTERVAL_MS = 10_000;
const PS_INTERVAL_MS = 10_000;
const STUDENT_STEP_MS = 1000;
const STUDENT_REST_MIN_MS = 3000;
const STUDENT_REST_MAX_MS = 10_000;
const SELF_DEFAULT_START_CODE = '12345678';

/**
 * 초등 글쓰기 풍의 가상 한글 문장 조각(표식·특수 기호 없음, 순수 한글과 공백·마침표만).
 * 각 조각은 한글 2~3음절로 이루어져 한 번 넣을 때마다 `countChars`가 2~3씩 늘어난다.
 */
const VIRTUAL_CHUNKS: readonly string[] = [
  '오늘 ',
  '아침에 ',
  '창문을 ',
  '활짝 ',
  '열었더니 ',
  '선선한 ',
  '바람이 ',
  '불어왔다. ',
  '운동장 ',
  '구석에 ',
  '작은 ',
  '민들레가 ',
  '노랗게 ',
  '피어 ',
  '있었다. ',
  '친구와 ',
  '함께 ',
  '도서관에 ',
  '가서 ',
  '재미있는 ',
  '동화책을 ',
  '빌렸다. ',
  '점심에는 ',
  '따뜻한 ',
  '국과 ',
  '고소한 ',
  '밥을 ',
  '맛있게 ',
  '먹었다. ',
  '하교길에 ',
  '구름이 ',
  '솜사탕 ',
  '모양으로 ',
  '하늘을 ',
  '천천히 ',
  '지나갔다. ',
  '집에 ',
  '돌아와 ',
  '강아지랑 ',
  '공놀이를 ',
  '신나게 ',
  '했다.\n',
];

/** 교사가 서랍에서 가끔 덧붙이는 가상 한글 한 글자 */
const TEACHER_SYLLABLES: readonly string[] = ['참', '좋', '늘', '빛', '별', '봄', '꿈', '솔'];

/** 별명 생성용 앞말·뒷말 (금지어 없음, 합쳐서 4~5자) */
const NICK_PREFIXES: readonly string[] = [
  '하늘',
  '바다',
  '별빛',
  '구름',
  '햇살',
  '달빛',
  '초록',
  '은하',
  '노을',
  '솔잎',
];
const NICK_SUFFIXES: readonly string[] = [
  '고래',
  '토끼',
  '참새',
  '여우',
  '사슴',
  '펭귄',
  '수달',
  '부엉이',
  '다람쥐',
  '거북이',
];

export interface LoadOptions {
  readonly url: string;
  readonly students: number;
  readonly minutes: number;
  readonly startCode: string | undefined;
  readonly serverPid: number | undefined;
  readonly self: boolean;
}

interface StudentInputRecord {
  readonly seq: number;
  readonly sentAt: number;
  readonly targetChars: number;
  drawerRecorded: boolean;
  tileRecorded: boolean;
}

interface TeacherInputRecord {
  readonly seq: number;
  readonly docId: string;
  readonly sentAt: number;
  readonly targetChars: number;
  recorded: boolean;
}

interface PsSample {
  readonly at: string;
  readonly cpuPct: number;
  readonly rssMb: number;
}

interface LatencySummary {
  readonly count: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly avgMs: number | null;
  readonly maxMs: number | null;
}

interface StudentContext {
  readonly index: number;
  readonly participantId: string;
  readonly nickname: string;
  readonly docId: string;
  readonly socket: HocuspocusProviderWebsocket;
  readonly roomProvider: HocuspocusProvider;
  readonly docProvider: HocuspocusProvider;
  readonly doc: Y.Doc;
  readonly inputs: Map<number, StudentInputRecord>;
  seq: number;
  chunkCursor: number;
  isResting: boolean;
  restStartedAt: number;
  restUntil: number;
  close(): void;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeNickname(index: number): string {
  const p = NICK_PREFIXES[index % NICK_PREFIXES.length] ?? '하늘';
  const s = NICK_SUFFIXES[Math.floor(index / NICK_PREFIXES.length) % NICK_SUFFIXES.length] ?? '고래';
  const cycle = Math.floor(index / (NICK_PREFIXES.length * NICK_SUFFIXES.length));
  return cycle === 0 ? `${p}${s}` : `${p}${s}${cycle + 1}`;
}

function newToken(): { readonly token: string; readonly hash: string } {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');
  return { token, hash };
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`시간 초과(${timeoutMs}ms): ${label}`);
    await sleep(25);
  }
}

function parseCliArgs(argv: readonly string[]): LoadOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      url: { type: 'string' },
      students: { type: 'string' },
      minutes: { type: 'string' },
      'start-code': { type: 'string' },
      'server-pid': { type: 'string' },
      self: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    process.stdout.write(
      [
        '사용법: node --conditions=@geulbang/source tools/load/run.ts [옵션]',
        '',
        '옵션:',
        '  --url <주소>          대상 서버 주소 (기본: http://127.0.0.1:4461)',
        '  --students <수>       학생 수 (기본: 21)',
        '  --minutes <분>        실행 시간(분, 기본: 40)',
        '  --start-code <코드>   선생님 시작 코드 (없으면 환경 변수 LOAD_START_CODE)',
        '  --server-pid <PID>    10초마다 ps로 CPU·메모리를 잴 서버 PID (--self면 기본 process.pid)',
        '  --self                같은 프로세스에서 시험 서버(포트 0, AI_PROVIDER=fake)를 띄워 실행',
        '  -h, --help            도움말 출력',
        '',
      ].join('\n'),
    );
    process.exit(0);
  }

  const students = values.students !== undefined ? Number(values.students) : 21;
  const minutes = values.minutes !== undefined ? Number(values.minutes) : 40;
  const serverPid = values['server-pid'] !== undefined ? Number(values['server-pid']) : undefined;

  if (!Number.isInteger(students) || students < 1) {
    throw new Error(`--students는 1 이상의 정수여야 합니다: ${String(values.students)}`);
  }
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`--minutes는 0보다 큰 숫자여야 합니다: ${String(values.minutes)}`);
  }
  if (serverPid !== undefined && (!Number.isInteger(serverPid) || serverPid < 1)) {
    throw new Error(`--server-pid는 양의 정수여야 합니다: ${String(values['server-pid'])}`);
  }

  const self = Boolean(values.self);
  const startCode =
    values['start-code'] ??
    process.env['LOAD_START_CODE'] ??
    process.env['TEACHER_START_CODE'] ??
    (self ? SELF_DEFAULT_START_CODE : undefined);

  return {
    url: (values.url ?? 'http://127.0.0.1:4461').replace(/\/+$/, ''),
    students,
    minutes,
    startCode,
    serverPid,
    self,
  };
}

interface HttpResult {
  readonly status: number;
  readonly json: {
    readonly data?: Record<string, unknown>;
    readonly error?: { readonly code?: string; readonly message?: string };
  };
}

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as HttpResult['json'];
  return { status: res.status, json };
}

async function getJson(baseUrl: string, path: string): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}${path}`);
  const json = (await res.json()) as HttpResult['json'];
  return { status: res.status, json };
}

function createProviderSocket(
  wsUrl: string,
  onDisconnect: () => void,
  onReconnect: () => void,
  isClosing: () => boolean,
): HocuspocusProviderWebsocket {
  const steps = defaultConfig.RECONNECT_BACKOFF_MS;
  const first = steps[0] ?? 1000;
  const second = steps[1] ?? first * 2;
  const socket = new HocuspocusProviderWebsocket({
    url: wsUrl,
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    delay: first,
    minDelay: first,
    factor: second / first,
    maxDelay: steps.at(-1) ?? 15_000,
    jitter: true,
    maxAttempts: 0,
    messageReconnectTimeout: defaultConfig.CLIENT_STALE_SEC * 1000,
  });

  let everConnected = false;
  let disconnectedAfterConnect = false;
  socket.on('status', ({ status }: { status: string }) => {
    if (isClosing()) return;
    if (status === 'connected') {
      if (!everConnected) {
        everConnected = true;
      } else if (disconnectedAfterConnect) {
        disconnectedAfterConnect = false;
        onReconnect();
      }
    } else if (status === 'disconnected' && everConnected && !disconnectedAfterConnect) {
      disconnectedAfterConnect = true;
      onDisconnect();
    }
  });
  return socket;
}

async function sampleProcessPs(pid: number): Promise<PsSample | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', '%cpu=,rss='], {
      env: { ...process.env, LC_ALL: 'C' },
    });
    const parts = stdout.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const cpuPct = Number(parts[0]);
    const rssKb = Number(parts[1]);
    if (!Number.isFinite(cpuPct) || !Number.isFinite(rssKb)) return null;
    return {
      at: new Date().toISOString(),
      cpuPct,
      rssMb: Number((rssKb / 1024).toFixed(2)),
    };
  } catch {
    return null;
  }
}

function summarizeLatencies(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) {
    return { count: 0, p50Ms: null, p95Ms: null, avgMs: null, maxMs: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (p: number): number => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return Number((sorted[idx] ?? 0).toFixed(1));
  };
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const max = sorted[sorted.length - 1] ?? 0;
  return {
    count: sorted.length,
    p50Ms: pick(0.5),
    p95Ms: pick(0.95),
    avgMs: Number((sum / sorted.length).toFixed(1)),
    maxMs: Number(max.toFixed(1)),
  };
}

function formatMs(ms: number | null): string {
  return ms === null ? '측정 없음' : `${ms.toFixed(1)} ms`;
}

async function runLoadTest(options: LoadOptions): Promise<void> {
  let tempDir: string | undefined;
  let selfServer: RunningServer | undefined;
  let closing = false;
  const students: StudentContext[] = [];
  let teacherSocket: HocuspocusProviderWebsocket | undefined;
  let teacherRoomProvider: HocuspocusProvider | undefined;
  let activeDrawerProvider: HocuspocusProvider | undefined;
  let activeDrawerDoc: Y.Doc | undefined;

  try {
    let baseUrl = options.url;
    const serverLog = createMemoryLogger();
    if (options.self) {
      tempDir = mkdtempSync(join(tmpdir(), 'geulbang-load-'));
      const serverConfig = loadServerConfig({
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '0',
        DB_PATH: join(tempDir, 'load.sqlite'),
        LOG_LEVEL: 'info',
        AI_PROVIDER: 'fake',
        TEACHER_START_CODE: options.startCode ?? SELF_DEFAULT_START_CODE,
        ROOM_MAX_PARTICIPANTS: String(Math.max(defaultConfig.ROOM_MAX_PARTICIPANTS, options.students + 5)),
        ROOM_CREATE_PER_DEVICE_PER_DAY: '1000',
        ROOM_CREATE_PER_IP_PER_DAY: '1000',
        CODE_LOOKUP_PER_DEVICE_PER_MIN: '10000',
        CODE_LOOKUP_PER_IP_PER_MIN: '10000',
      });
      selfServer = await startServer({
        config: serverConfig,
        log: serverLog,
        webDistDir: join(tempDir, 'no-web-dist'),
      });
      baseUrl = selfServer.url;
    }

    const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/ws`;
    const effectivePid = options.serverPid ?? (options.self ? process.pid : undefined);
    const isSelfCombinedPs = options.self && options.serverPid === undefined;

    process.stdout.write(
      `[load] 준비 시작: url=${baseUrl}, students=${options.students}, minutes=${options.minutes}, self=${options.self}\n`,
    );

    // 1. REST로 수업방 만들기 (교사 링크 토큰 기기에서 생성, PIN 중복 시 재시도)
    const teacherLink = newToken();
    const teacherDeviceId = randomUUID();
    let roomId = '';
    let entryCode = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const pin = String(randomInt(100_000, 999_999));
      const created = await postJson(
        baseUrl,
        '/api/rooms',
        {
          className: '5학년 1반',
          title: '실시간 부하 시험',
          showSchool: false,
          genres: ['story', 'poem', 'essay'],
          aiButtons: ['SPELL', 'FEEDBACK'],
          pin,
          linkTokenHash: teacherLink.hash,
          deviceId: teacherDeviceId,
          commandId: randomUUID(),
        },
        options.startCode ? { 'x-start-code': options.startCode } : {},
      );
      if (created.status === 200 && created.json.data) {
        roomId = String(created.json.data['roomId'] ?? '');
        entryCode = String(created.json.data['entryCode'] ?? '');
        break;
      }
      if (created.json.error?.code !== 'E_PIN_TAKEN') {
        throw new Error(`수업방 만들기 실패 (${created.status}): ${created.json.error?.code ?? 'UNKNOWN'}`);
      }
    }
    if (!roomId || !entryCode) throw new Error('수업방 ID 또는 입장 코드를 받지 못했습니다.');

    const lookup = await getJson(baseUrl, `/api/rooms/by-code/${entryCode}`);
    const policyVersion =
      lookup.status === 200 && typeof lookup.json.data?.['policyVersion'] === 'string'
        ? lookup.json.data['policyVersion']
        : defaultConfig.POLICY_VERSION;

    // 측정 수집기
    let disconnects = 0;
    let reconnects = 0;
    let docErrorEvents = 0;
    let teacherEditingEvents = 0;
    const studentToDrawerMs: number[] = [];
    const studentToTileMs: number[] = [];
    const teacherToStudentMs: number[] = [];
    const psSamples: PsSample[] = [];
    const teacherInputs = new Map<number, TeacherInputRecord>();
    const studentsByDocId = new Map<string, StudentContext>();
    let teacherSeq = 0;

    // 2. 교사 실시간 연결 (room:*)
    const teacherCredential: Credential = {
      v: 1,
      kind: 'teacher',
      token: teacherLink.token,
      deviceId: teacherDeviceId,
    };
    const teacherToken = encodeCredential(teacherCredential);
    teacherSocket = createProviderSocket(
      wsUrl,
      () => {
        disconnects++;
      },
      () => {
        reconnects++;
      },
      () => closing,
    );

    let teacherHello = false;
    teacherRoomProvider = new HocuspocusProvider({
      websocketProvider: teacherSocket,
      name: roomDocumentName(roomId),
      document: new Y.Doc(),
      token: teacherToken,
    });
    teacherRoomProvider.on('stateless', ({ payload }: { payload: string }) => {
      const msg = decodeRoomMessage(payload);
      if (!msg || msg.kind !== 'evt') return;
      const evt: RoomEvent = msg.evt;
      if (evt.name === 'hello') {
        teacherHello = true;
      } else if (evt.name === 'summary.batch') {
        const receivedAt = performance.now();
        for (const summary of evt.data) {
          const st = studentsByDocId.get(summary.docId);
          if (!st) continue;
          for (const input of st.inputs.values()) {
            if (!input.tileRecorded && summary.chars >= input.targetChars) {
              input.tileRecorded = true;
              studentToTileMs.push(receivedAt - input.sentAt);
            }
          }
        }
      }
    });
    teacherRoomProvider.on('authenticationFailed', ({ reason }: { reason: string }) => {
      throw new Error(`교사 room 인증 실패: ${reason}`);
    });
    teacherRoomProvider.attach();
    await waitFor(() => teacherHello, '교사 hello');

    // 3. 학생 N명 입장 → 실시간 연결 → doc.create → doc:* 연결
    for (let i = 0; i < options.students; i++) {
      const nickname = makeNickname(i);
      const deviceToken = newToken();
      const deviceId = randomUUID();
      const joined = await postJson(baseUrl, `/api/rooms/${roomId}/join`, {
        nickname,
        consentVersion: policyVersion,
        deviceId,
        deviceTokenHash: deviceToken.hash,
        commandId: randomUUID(),
      });
      if (joined.status !== 200 || !joined.json.data) {
        throw new Error(
          `학생 입장 실패 (${nickname}, ${joined.status}): ${joined.json.error?.code ?? 'UNKNOWN'}`,
        );
      }
      const participantId = String(joined.json.data['participantId'] ?? '');
      const studentCred: Credential = {
        v: 1,
        kind: 'student',
        token: deviceToken.token,
        deviceId,
      };
      const studentToken = encodeCredential(studentCred);
      const socket = createProviderSocket(
        wsUrl,
        () => {
          disconnects++;
        },
        () => {
          reconnects++;
        },
        () => closing,
      );

      let gotHello = false;
      const acks = new Map<string, Ack>();
      const roomProvider = new HocuspocusProvider({
        websocketProvider: socket,
        name: roomDocumentName(roomId),
        document: new Y.Doc(),
        token: studentToken,
      });
      roomProvider.on('stateless', ({ payload }: { payload: string }) => {
        const msg = decodeRoomMessage(payload);
        if (!msg) return;
        if (msg.kind === 'ack') acks.set(msg.ack.id, msg.ack);
        else if (msg.evt.name === 'hello') gotHello = true;
        else if (msg.evt.name === 'teacher.editing') teacherEditingEvents++;
      });
      roomProvider.on('authenticationFailed', ({ reason }: { reason: string }) => {
        throw new Error(`학생(${nickname}) room 인증 실패: ${reason}`);
      });
      roomProvider.attach();
      await waitFor(() => gotHello, `학생(${nickname}) hello`);

      const cmdId = randomUUID();
      roomProvider.sendStateless(
        encodeCommand(cmdId, 'doc.create' as CommandName, { genre: 'story', subtype: 'short' }),
      );
      await waitFor(() => acks.has(cmdId), `학생(${nickname}) doc.create ack`);
      const ack = acks.get(cmdId);
      if (!ack || !ack.ok) {
        throw new Error(`학생(${nickname}) doc.create 실패: ${ack && !ack.ok ? ack.error.code : 'NO_ACK'}`);
      }
      const docId = String((ack.data as { docId?: unknown })?.docId ?? '');
      if (!docId) throw new Error(`학생(${nickname}) docId 비어 있음`);

      const doc = new Y.Doc();
      const docProvider = new HocuspocusProvider({
        websocketProvider: socket,
        name: docDocumentName(docId),
        document: doc,
        token: studentToken,
      });
      docProvider.on('stateless', ({ payload }: { payload: string }) => {
        const evt = decodeDocEvent(payload);
        if (evt?.name === 'doc.error') docErrorEvents++;
      });
      docProvider.on('authenticationFailed', ({ reason }: { reason: string }) => {
        throw new Error(`학생(${nickname}) doc 인증 실패: ${reason}`);
      });

      const inputs = new Map<number, StudentInputRecord>();
      doc.on('update', (_update: Uint8Array, origin: unknown) => {
        if (origin === 'student-edit' || !docProvider.isSynced) return;
        const receivedAt = performance.now();
        const chars = countChars(doc.getText(DOC_KEYS.body).toString());
        for (const rec of teacherInputs.values()) {
          if (!rec.recorded && rec.docId === docId && receivedAt >= rec.sentAt && chars >= rec.targetChars) {
            rec.recorded = true;
            teacherToStudentMs.push(receivedAt - rec.sentAt);
          }
        }
      });

      docProvider.attach();
      await waitFor(() => docProvider.isSynced, `학생(${nickname}) doc 동기화`);

      const ctx: StudentContext = {
        index: i,
        participantId,
        nickname,
        docId,
        socket,
        roomProvider,
        docProvider,
        doc,
        inputs,
        seq: 0,
        chunkCursor: i % VIRTUAL_CHUNKS.length,
        isResting: false,
        restStartedAt: 0,
        restUntil: 0,
        close() {
          docProvider.destroy();
          doc.destroy();
          roomProvider.destroy();
          socket.destroy();
        },
      };
      students.push(ctx);
      studentsByDocId.set(docId, ctx);
    }

    process.stdout.write(
      `[load] 준비 완료: 방=${roomId}, 학생 ${students.length}명 연결·문서 생성 완료. ${options.minutes}분 시험 시작...\n`,
    );

    const startedAtIso = new Date().toISOString();
    const durationMs = Math.round(options.minutes * 60 * 1000);
    const endTime = performance.now() + durationMs;

    // 4. 서버 CPU·메모리(ps) 10초 간격 수집
    let psTimer: ReturnType<typeof setInterval> | undefined;
    const recordPs = async () => {
      if (effectivePid === undefined) return;
      const sample = await sampleProcessPs(effectivePid);
      if (sample) psSamples.push(sample);
    };
    await recordPs();
    if (effectivePid !== undefined) {
      psTimer = setInterval(() => {
        void recordPs();
      }, PS_INTERVAL_MS);
      psTimer.unref();
    }

    // 5. 학생 입력 루프: 초당 한글 2~3음절 입력(3~5초 연속) 후 임의 3~10초 쉼
    const runStudentLoop = async (student: StudentContext): Promise<void> => {
      // 시작 시점이 한데 몰리지 않도록 학생별로 짧은 초기 시차를 둔다
      const initialStaggerMs = (student.index * 170) % 1500;
      if (initialStaggerMs > 0)
        await sleep(Math.min(initialStaggerMs, Math.max(0, endTime - performance.now())));

      while (performance.now() < endTime) {
        student.isResting = false;
        const burstSteps = randomInt(3, 5);
        for (let step = 0; step < burstSteps && performance.now() < endTime; step++) {
          const chunk = VIRTUAL_CHUNKS[student.chunkCursor % VIRTUAL_CHUNKS.length] ?? '가나다 ';
          student.chunkCursor++;
          const seq = ++student.seq;
          const body = student.doc.getText(DOC_KEYS.body);
          const sentAt = performance.now();
          student.doc.transact(() => {
            body.insert(body.length, chunk);
          }, 'student-edit');
          const targetChars = countChars(body.toString());
          student.inputs.set(seq, {
            seq,
            sentAt,
            targetChars,
            drawerRecorded: false,
            tileRecorded: false,
          });

          const remaining = endTime - performance.now();
          if (remaining <= 0) break;
          await sleep(Math.min(STUDENT_STEP_MS, remaining));
        }

        if (performance.now() >= endTime) break;
        const restMs = randomInt(STUDENT_REST_MIN_MS, STUDENT_REST_MAX_MS);
        const now = performance.now();
        student.isResting = true;
        student.restStartedAt = now;
        student.restUntil = now + restMs;
        const remaining = endTime - now;
        if (remaining <= 0) break;
        await sleep(Math.min(restMs, remaining));
      }
      student.isResting = true;
    };

    // 6. 교사 루프: 30초마다 다른 학생 글 서랍(doc:*)을 열고 가끔 한 글자 고침
    const closeActiveDrawer = () => {
      if (activeDrawerProvider) {
        activeDrawerProvider.destroy();
        activeDrawerProvider = undefined;
      }
      if (activeDrawerDoc) {
        activeDrawerDoc.destroy();
        activeDrawerDoc = undefined;
      }
    };

    const runTeacherLoop = async (): Promise<void> => {
      if (!teacherSocket || students.length === 0) return;
      let drawerIdx = 0;
      let syllableIdx = 0;

      while (performance.now() < endTime) {
        const target = students[drawerIdx % students.length];
        drawerIdx++;
        if (!target) break;

        closeActiveDrawer();
        const drawerDoc = new Y.Doc();
        const drawerProvider = new HocuspocusProvider({
          websocketProvider: teacherSocket,
          name: docDocumentName(target.docId),
          document: drawerDoc,
          token: teacherToken,
        });
        drawerProvider.on('stateless', ({ payload }: { payload: string }) => {
          const evt = decodeDocEvent(payload);
          if (evt?.name === 'doc.error') docErrorEvents++;
        });
        activeDrawerDoc = drawerDoc;
        activeDrawerProvider = drawerProvider;

        let drawerReady = false;
        let drawerSyncedAt = Number.POSITIVE_INFINITY;
        let baselineChars = 0;

        drawerDoc.on('update', (_update: Uint8Array, origin: unknown) => {
          if (origin === 'teacher-edit' || !drawerReady || !drawerProvider.isSynced) return;
          const receivedAt = performance.now();
          const chars = countChars(drawerDoc.getText(DOC_KEYS.body).toString());
          if (chars <= baselineChars) return;
          for (const input of target.inputs.values()) {
            if (
              !input.drawerRecorded &&
              input.sentAt >= drawerSyncedAt &&
              input.targetChars > baselineChars &&
              chars >= input.targetChars
            ) {
              input.drawerRecorded = true;
              studentToDrawerMs.push(receivedAt - input.sentAt);
            }
          }
          baselineChars = chars;
        });

        drawerProvider.attach();
        await waitFor(
          () => drawerProvider.isSynced || performance.now() >= endTime,
          `교사 서랍 동기화 (${target.nickname})`,
        );
        baselineChars = countChars(drawerDoc.getText(DOC_KEYS.body).toString());
        drawerSyncedAt = performance.now();
        drawerReady = true;

        const drawerUntil = Math.min(endTime, performance.now() + DRAWER_ROTATE_MS);
        let nextEditAt =
          performance.now() + Math.min(TEACHER_EDIT_INTERVAL_MS, Math.max(2000, durationMs / 6));

        while (performance.now() < drawerUntil) {
          if (performance.now() >= nextEditAt) {
            // 학생이 멈춘(쉬는) 상태에서 직전 입력이 서랍에 도착한 뒤에 고친다(PLAN §10.6 "교사 입력 → 학생(멈춘 상태)").
            const waitRestDeadline = Math.min(drawerUntil - 300, performance.now() + 8000);
            const hasPendingDrawer = () => {
              const currentChars = countChars(drawerDoc.getText(DOC_KEYS.body).toString());
              for (const inp of target.inputs.values()) {
                if (inp.targetChars > currentChars) return true;
              }
              return false;
            };
            while (
              performance.now() < waitRestDeadline &&
              (!target.isResting ||
                hasPendingDrawer() ||
                performance.now() - target.restStartedAt < 150 ||
                target.restUntil - performance.now() < 300)
            ) {
              await sleep(40);
            }
            if (
              performance.now() < drawerUntil &&
              drawerProvider.isSynced &&
              target.isResting &&
              !hasPendingDrawer()
            ) {
              const syllable = TEACHER_SYLLABLES[syllableIdx % TEACHER_SYLLABLES.length] ?? '참';
              syllableIdx++;
              const tSeq = ++teacherSeq;
              const body = drawerDoc.getText(DOC_KEYS.body);
              const sentAt = performance.now();
              drawerDoc.transact(() => {
                body.insert(body.length, syllable);
              }, 'teacher-edit');
              const targetChars = countChars(body.toString());
              baselineChars = targetChars;
              teacherInputs.set(tSeq, {
                seq: tSeq,
                docId: target.docId,
                sentAt,
                targetChars,
                recorded: false,
              });
              nextEditAt = performance.now() + TEACHER_EDIT_INTERVAL_MS;
            } else {
              nextEditAt = performance.now() + 300;
            }
          }
          const stepWait = Math.min(200, Math.max(10, drawerUntil - performance.now()));
          await sleep(stepWait);
        }
      }
      closeActiveDrawer();
    };

    await Promise.all([...students.map(s => runStudentLoop(s)), runTeacherLoop()]);

    // 마지막 입력들이 서랍과 1초 주기 summary.batch에 도착하도록 잠시 기다린다
    await sleep(1500);
    if (psTimer) clearInterval(psTimer);
    await recordPs();

    closing = true;
    closeActiveDrawer();
    for (const s of students) s.close();
    teacherRoomProvider.destroy();
    teacherSocket.destroy();

    const finishedAtIso = new Date().toISOString();

    // 7. 지표 집계 및 통과 판정
    const drawerStats = summarizeLatencies(studentToDrawerMs);
    const tileStats = summarizeLatencies(studentToTileMs);
    const teacherStats = summarizeLatencies(teacherToStudentMs);
    const serverWarnOrErrorLogs = serverLog.lines.filter(
      l => l['level'] === 'warn' || l['level'] === 'error',
    );

    const cpuAvgPct =
      psSamples.length > 0
        ? Number((psSamples.reduce((acc, s) => acc + s.cpuPct, 0) / psSamples.length).toFixed(2))
        : null;
    const cpuMaxPct =
      psSamples.length > 0 ? Number(Math.max(...psSamples.map(s => s.cpuPct)).toFixed(2)) : null;
    const memAvgMb =
      psSamples.length > 0
        ? Number((psSamples.reduce((acc, s) => acc + s.rssMb, 0) / psSamples.length).toFixed(2))
        : null;
    const memMaxMb =
      psSamples.length > 0 ? Number(Math.max(...psSamples.map(s => s.rssMb)).toFixed(2)) : null;

    const checks = {
      drawerP95: drawerStats.p95Ms !== null && drawerStats.p95Ms <= THRESHOLDS.drawerP95Ms,
      tileP95: tileStats.p95Ms !== null && tileStats.p95Ms <= THRESHOLDS.tileP95Ms,
      teacherToStudentP95:
        teacherStats.p95Ms !== null && teacherStats.p95Ms <= THRESHOLDS.teacherToStudentP95Ms,
      disconnectsZero: disconnects <= THRESHOLDS.maxDisconnects && reconnects === 0 && docErrorEvents === 0,
      cpuAvg: isSelfCombinedPs || cpuAvgPct === null ? null : cpuAvgPct <= THRESHOLDS.maxCpuAvgPct,
      memMax: isSelfCombinedPs || memMaxMb === null ? null : memMaxMb <= THRESHOLDS.maxMemRssMb,
    };

    const overallPass =
      checks.drawerP95 &&
      checks.tileP95 &&
      checks.teacherToStudentP95 &&
      checks.disconnectsZero &&
      (checks.cpuAvg ?? true) &&
      (checks.memMax ?? true);

    const stamp = finishedAtIso.replace(/[:.]/g, '-');
    const outDir = join(repoRoot, '.local', 'load');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `${stamp}.json`);

    const cpuCheckLabel = isSelfCombinedPs
      ? '참고(클라이언트 포함)'
      : checks.cpuAvg === null
        ? 'SKIP'
        : checks.cpuAvg
          ? 'PASS'
          : 'FAIL';
    const memCheckLabel = isSelfCombinedPs
      ? '참고(클라이언트 포함)'
      : checks.memMax === null
        ? 'SKIP'
        : checks.memMax
          ? 'PASS'
          : 'FAIL';

    const report = {
      startedAt: startedAtIso,
      finishedAt: finishedAtIso,
      options: {
        url: baseUrl,
        students: options.students,
        minutes: options.minutes,
        self: options.self,
        serverPid: effectivePid ?? null,
      },
      thresholds: THRESHOLDS,
      metrics: {
        studentToDrawer: drawerStats,
        studentToTile: tileStats,
        teacherToStudent: teacherStats,
        disconnects,
        reconnects,
        docErrorEvents,
        teacherEditingEvents,
        serverWarnOrErrorCount: serverWarnOrErrorLogs.length,
        serverWarnOrErrorLogs,
        serverCpuAvgPct: cpuAvgPct,
        serverCpuMaxPct: cpuMaxPct,
        serverMemAvgMb: memAvgMb,
        serverMemMaxMb: memMaxMb,
        psSampleCount: psSamples.length,
      },
      checks: {
        drawerP95: checks.drawerP95 ? 'PASS' : 'FAIL',
        tileP95: checks.tileP95 ? 'PASS' : 'FAIL',
        teacherToStudentP95: checks.teacherToStudentP95 ? 'PASS' : 'FAIL',
        disconnectsZero: checks.disconnectsZero ? 'PASS' : 'FAIL',
        cpuAvg: cpuCheckLabel,
        memMax: memCheckLabel,
      },
      overall: overallPass ? 'PASS' : 'FAIL',
      psSamples,
    };

    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const rows: Array<readonly [string, string, string, string, string]> = [
      [
        '학생 입력 → 교사 서랍 도착',
        `n=${drawerStats.count}, p50=${formatMs(drawerStats.p50Ms)}`,
        `p95=${formatMs(drawerStats.p95Ms)}`,
        `p95 <= ${THRESHOLDS.drawerP95Ms} ms`,
        report.checks.drawerP95,
      ],
      [
        '학생 입력 → 교사 타일(summary.batch)',
        `n=${tileStats.count}, p50=${formatMs(tileStats.p50Ms)}`,
        `p95=${formatMs(tileStats.p95Ms)}`,
        `p95 <= ${THRESHOLDS.tileP95Ms} ms`,
        report.checks.tileP95,
      ],
      [
        '교사 입력 → 학생 도착',
        `n=${teacherStats.count}, p50=${formatMs(teacherStats.p50Ms)}`,
        `p95=${formatMs(teacherStats.p95Ms)}`,
        `p95 <= ${THRESHOLDS.teacherToStudentP95Ms} ms`,
        report.checks.teacherToStudentP95,
      ],
      [
        '끊김 / 재연결 수',
        `끊김=${disconnects}`,
        `재연결=${reconnects}, 거부=${docErrorEvents}`,
        `끊김 = ${THRESHOLDS.maxDisconnects}`,
        report.checks.disconnectsZero,
      ],
      [
        isSelfCombinedPs ? '서버 CPU (참고: 클라이언트 포함)' : '서버 CPU (ps 10초 간격)',
        cpuAvgPct !== null ? `평균=${cpuAvgPct.toFixed(2)}% (n=${psSamples.length})` : '미측정',
        cpuMaxPct !== null ? `최대=${cpuMaxPct.toFixed(2)}%` : '-',
        `평균 <= ${THRESHOLDS.maxCpuAvgPct}%`,
        report.checks.cpuAvg,
      ],
      [
        isSelfCombinedPs ? '서버 메모리 RSS (참고: 클라이언트 포함)' : '서버 메모리 RSS (ps 10초 간격)',
        memAvgMb !== null ? `평균=${memAvgMb.toFixed(1)} MB` : '미측정',
        memMaxMb !== null ? `최대=${memMaxMb.toFixed(1)} MB` : '-',
        `최대 <= ${THRESHOLDS.maxMemRssMb} MB`,
        report.checks.memMax,
      ],
    ];

    process.stdout.write('\n=== 실시간 부하 시험 결과 ===\n');
    process.stdout.write(`| 항목 | 측정 1 | 측정 2 | 기준 | 판정 |\n| --- | --- | --- | --- | --- |\n`);
    for (const [label, col1, col2, target, status] of rows) {
      process.stdout.write(`| ${label} | ${col1} | ${col2} | ${target} | ${status} |\n`);
    }
    process.stdout.write(`\n종합 판정: ${report.overall}\n`);
    process.stdout.write(`결과 파일: ${outPath}\n`);

    if (!overallPass) {
      process.exitCode = 1;
    }
  } finally {
    closing = true;
    if (activeDrawerProvider) activeDrawerProvider.destroy();
    if (activeDrawerDoc) activeDrawerDoc.destroy();
    for (const s of students) {
      try {
        s.close();
      } catch {
        // 정리 중 오류 무시
      }
    }
    try {
      teacherRoomProvider?.destroy();
      teacherSocket?.destroy();
    } catch {
      // 정리 중 오류 무시
    }
    if (selfServer) {
      await selfServer.stop('load_test_done');
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

await runLoadTest(parseCliArgs(process.argv.slice(2)));
