import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiPort } from '../src/ai/port.ts';
import { loadServerConfig, type ServerConfig } from '../src/config.ts';
import { createMemoryLogger } from '../src/log.ts';
import { startServer, type RunningServer } from '../src/server.ts';

export interface TestServer {
  readonly server: RunningServer;
  readonly config: ServerConfig;
  readonly log: ReturnType<typeof createMemoryLogger>;
  readonly dir: string;
  close(): Promise<void>;
}

/** 시험마다 임시 폴더의 SQLite로 서버를 같은 프로세스에서 띄운다(PLAN §10.4). */
export async function startTestServer(
  env: Record<string, string> = {},
  options: { webDistDir?: string; ai?: AiPort | null; sleep?: (ms: number) => Promise<void> } = {},
): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), 'geulbang-test-'));
  const config = loadServerConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    DB_PATH: join(dir, 'test.sqlite'),
    LOG_LEVEL: 'debug',
    ...env,
  });
  const log = createMemoryLogger();
  const server = await startServer({
    config,
    log,
    webDistDir: options.webDistDir ?? join(dir, 'no-web-dist'),
    ...(options.ai !== undefined ? { ai: options.ai } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });
  return {
    server,
    config,
    log,
    dir,
    async close() {
      await server.stop('test');
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
