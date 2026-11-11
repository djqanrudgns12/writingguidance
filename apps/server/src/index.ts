import { resolve } from 'node:path';
import { loadServerConfig, paths, StartupError } from './config.ts';
import { createLogger } from './log.ts';
import { startServer, type RunningServer } from './server.ts';

/**
 * 프로세스 입구. 운영은 launchd가 `node --env-file=<secrets/app.env> apps/server/dist/index.js`로 띄운다(PLAN §15.2).
 * `--init`: 운영에서 DB 파일을 처음 한 번 만들 때만.
 */
async function main(): Promise<void> {
  let config;
  try {
    config = loadServerConfig(process.env);
  } catch (error) {
    process.stderr.write(`${error instanceof StartupError ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const log = createLogger(config.ops.LOG_LEVEL);
  if (config.generatedSecrets.length > 0) {
    log.warn('dev_secrets_generated', {
      detail: `이번 실행만 쓰는 무작위 값: ${config.generatedSecrets.join(',')}`,
    });
  }

  let running: RunningServer | undefined;

  const exitAfterStop = async (reason: string, code: number) => {
    try {
      await running?.stop(reason);
    } catch (error) {
      log.error('shutdown_failed', { error });
      code = 1;
    }
    process.exit(code);
  };

  process.on('SIGTERM', () => void exitAfterStop('SIGTERM', 0));
  process.on('SIGINT', () => void exitAfterStop('SIGINT', 0));
  // PLAN §4.7 대응 1: 기다려 주지 않는 곳의 거부는 기록만, 잡지 못한 예외는 저장을 시도한 뒤 끝낸다(launchd가 다시 띄움).
  process.on('unhandledRejection', reason => log.error('unhandled_rejection', { error: reason }));
  process.on('uncaughtException', error => {
    log.error('uncaught_exception', { error });
    void exitAfterStop('uncaughtException', 1);
  });

  try {
    running = await startServer({
      config,
      log,
      allowCreateDb: config.ops.NODE_ENV !== 'production' || process.argv.includes('--init'),
      ...(config.ops.WEB_DIST_DIR ? { webDistDir: resolve(paths.repoRoot, config.ops.WEB_DIST_DIR) } : {}),
    });
  } catch (error) {
    log.error('startup_failed', { error });
    process.exit(1);
  }
}

void main();
