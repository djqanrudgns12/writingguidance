import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { bytesToBase64Url } from '@geulbang/core';
import { createAdaptorServer } from '@hono/node-server';
import type { Hocuspocus } from '@hocuspocus/server';
import { createAnthropicAi } from './ai/anthropic.ts';
import { createFakeAi } from './ai/fake.ts';
import type { AiPort } from './ai/port.ts';
import { paths, type ServerConfig } from './config.ts';
import { createHttpApp } from './http/app.ts';
import { refundInterruptedAi, startRetention, type RetentionJob } from './jobs/retention.ts';
import type { Logger } from './log.ts';
import { createRealtime, type Realtime, type RealtimeContext } from './realtime/hocuspocus.ts';
import { attachRealtime } from './realtime/upgrade.ts';
import { checkpoint, openDatabase, quickCheck, type Db } from './store/db.ts';
import { migrate } from './store/migrate.ts';
import { createRepos } from './store/repos/index.ts';

export interface StartOptions {
  readonly config: ServerConfig;
  readonly log: Logger;
  readonly now?: () => number;
  /** DB 파일이 없을 때 만들어도 되는가. 기본: 운영이 아니면 true, 운영은 `--init` 때만 */
  readonly allowCreateDb?: boolean;
  /** 시험에서 웹 빌드 위치를 바꿀 때 */
  readonly webDistDir?: string;
  /** 시험에서 개발 비밀값을 정할 때. 없으면 `DEV_DOCS_ENABLED`일 때 시작마다 새로 만든다. */
  readonly devSecret?: string;
  /** 시험에서 대기(저장 재시도, PIN 전역 감속)를 줄일 때 */
  readonly sleep?: (ms: number) => Promise<void>;
  /** 시험에서 AI를 바꿔 끼울 때(지연·실패 흉내). 없으면 설정 `AI_PROVIDER`로 만든다. */
  readonly ai?: AiPort | null;
}

export interface RunningServer {
  readonly url: string;
  readonly port: number;
  readonly db: Db;
  readonly hocuspocus: Hocuspocus<RealtimeContext>;
  readonly realtime: Realtime;
  readonly retention: RetentionJob;
  /** 개발 전용 `dev` 자격 비밀값(꺼져 있으면 undefined) */
  readonly devSecret: string | undefined;
  /** 끝내기 순서(PLAN §7.1-6). 두 번 불러도 한 번만 돈다. */
  stop(reason: string): Promise<void>;
}

/** 끝내기 전체에 주는 시간. launchd `ExitTimeOut 30`보다 짧게 둔다. */
const SHUTDOWN_BUDGET_MS = 25_000;
/** "저장 못 함" 글을 다시 저장해 보는 간격(PLAN §4.7 대응 2) */
const STORE_RETRY_INTERVAL_MS = 30_000;

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** 시작 순서(PLAN §7.1): 설정은 받은 상태 → DB 열기·검사·마이그레이션 → 앱·실시간을 같은 포트에 → listen. */
export async function startServer(options: StartOptions): Promise<RunningServer> {
  const { config, log } = options;
  const now = options.now ?? Date.now;
  const production = config.ops.NODE_ENV === 'production';

  const db = openDatabase(config.ops.DB_PATH, { create: options.allowCreateDb ?? !production });
  quickCheck(db);
  const report = migrate(db, paths.migrationsDir, now());
  log.info('db_ready', { detail: `schema ${report.current ?? '-'} applied [${report.applied.join(',')}]` });
  if (report.ahead.length > 0) {
    log.warn('schema_ahead', { detail: `이 릴리스보다 새 마이그레이션이 적용됨: ${report.ahead.join(',')}` });
  }

  // 정해 준 값(시험 코드·`DEV_SECRET`)이 없을 때만 무작위로 만들고, 그때만 주소를 기록에 찍는다.
  const fixedDevSecret = options.devSecret ?? config.ops.DEV_SECRET;
  const devSecret = config.ops.DEV_DOCS_ENABLED
    ? (fixedDevSecret ?? bytesToBase64Url(randomBytes(32)))
    : undefined;
  const repos = createRepos(db);
  const realtime = createRealtime({
    config,
    log,
    db,
    repos,
    now,
    devSecret,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });
  const { hocuspocus, persistence } = realtime;
  const startedAt = now();
  const ai = options.ai !== undefined ? options.ai : createAi(config, log);
  const refunded = refundInterruptedAi(repos, config.product, now());
  if (refunded > 0) log.warn('ai_reservations_refunded', { count: refunded });
  let gateway: ReturnType<typeof attachRealtime> | undefined;

  const app = createHttpApp({
    config,
    log,
    db,
    repos,
    now,
    sleep: options.sleep ?? defaultSleep,
    services: realtime.services,
    ai,
    startedAt,
    schemaVersion: report.current,
    webDistDir: options.webDistDir ?? paths.webDistDir,
    realtimeStats: () => ({
      connections: gateway?.connectionCount() ?? 0,
      documents: hocuspocus.getDocumentsCount(),
      persistFailures: persistence.failedCount(),
    }),
  });

  const server = createAdaptorServer({ fetch: app.fetch }) as Server;
  server.on('clientError', (_error, socket) => socket.destroy());
  gateway = attachRealtime(server, hocuspocus, { config, log });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.ops.PORT, config.ops.HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const url = `http://${config.ops.HOST}:${address.port}`;
  log.info('listening', { detail: url });
  if (devSecret && !fixedDevSecret) {
    // 개발 전용: 소유자 터미널에만 보인다. 주소의 # 뒤는 서버로 가지 않는다(PLAN §11.5).
    log.info('dev_editor', { detail: `/dev/editor#dev=${devSecret}` });
  }

  const retryTimer = setInterval(() => void persistence.retryFailed(hocuspocus), STORE_RETRY_INTERVAL_MS);
  retryTimer.unref();
  const retention = startRetention({
    config: config.product,
    repos,
    log,
    now,
    deleteRoom: realtime.services.deleteRoom,
  });

  let stopping: Promise<void> | undefined;
  const stop = (reason: string): Promise<void> => {
    stopping ??= shutdown(reason);
    return stopping;
  };

  const shutdown = async (reason: string) => {
    log.info('shutdown_start', { detail: reason });
    const deadline = now() + SHUTDOWN_BUDGET_MS;
    const g = gateway;

    // ① 새 HTTP·웹소켓 연결을 받지 않는다. 주기 작업(요약 묶음·tick)도 멈춘다.
    clearInterval(retryTimer);
    retention.stop();
    realtime.close();
    g?.stopAccepting();
    const httpClosed = new Promise<void>(resolve => server.close(() => resolve()));
    server.closeIdleConnections();

    // ② 열린 모든 문서 연결을 읽기 전용으로 바꿔 새 편집을 멈춘다. 기기는 자기 사본에 계속 쓴다.
    for (const document of hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) connection.readOnly = true;
    }

    // ③ 진행 중인 AI 호출을 중단한다. 각 요청이 끝나며 예약을 REFUNDED로 정산한다(못 하면 다음 시작 때 되돌림).
    const aborted = realtime.services.gate.abortAllAi();
    if (aborted > 0) log.info('shutdown_ai_aborted', { count: aborted });

    // ④ 미뤄 둔 저장을 바로 돌리고, 문서가 다 내려갈 때까지 기다린다(시간 안에서).
    hocuspocus.flushPendingStores();

    // ⑤ 연결을 닫는다(기기는 자동 재연결). 문서는 마지막 연결이 끊기면 저장 뒤 내려간다.
    await g?.close();
    await persistence.retryFailed(hocuspocus);
    while (hocuspocus.getDocumentsCount() > 0 && now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (hocuspocus.getDocumentsCount() > 0) {
      log.warn('shutdown_documents_left', { count: hocuspocus.getDocumentsCount() });
    }
    server.closeAllConnections();
    await httpClosed;

    // ⑥ WAL 체크포인트 → DB 닫기.
    const cp = checkpoint(db);
    if (cp.busy !== 0) log.warn('checkpoint_busy', { count: cp.busy });
    db.close();
    log.info('shutdown_done', { detail: reason });
  };

  return { url, port: address.port, db, hocuspocus, realtime, retention, devSecret, stop };
}

/** 설정 `AI_PROVIDER`로 AI 어댑터를 만든다. 키가 없으면 null(서버는 뜨고 AI 요청만 `E_AI_PROVIDER`). */
function createAi(config: ServerConfig, log: Logger): AiPort | null {
  if (config.product.AI_PROVIDER === 'fake') return createFakeAi();
  const apiKey = config.secrets.anthropicApiKey;
  if (!apiKey) {
    log.warn('ai_unconfigured', { detail: 'ANTHROPIC_API_KEY 없음: AI 요청은 E_AI_PROVIDER' });
    return null;
  }
  return createAnthropicAi({ apiKey });
}
