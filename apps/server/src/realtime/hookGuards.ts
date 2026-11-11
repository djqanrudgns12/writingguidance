import { AppError } from '@geulbang/core/errors';
import type { Logger } from '../log.ts';

/**
 * Hocuspocus 훅 감싸기(PLAN §4.7 대응 1). 둘로 나눈다.
 *
 * - 판단 훅(`onAuthenticate`, `onLoadDocument`, `beforeUnloadDocument`, `onStoreDocument`):
 *   예외를 기록한 뒤 **그대로 던진다**. 삼키면 Hocuspocus가 인증 성공·빈 문서·내림 허용으로 처리한다.
 * - 알림 훅(`connected`, `onChange`, `onStateless`, `onDisconnect`, `onAwarenessUpdate`, `afterStoreDocument`,
 *   `beforeBroadcastStateless`): 예외를 잡아 기록하고 **삼킨다**. 기다려 주지 않는 훅의 예외는 프로세스를 죽인다.
 */

type Hook<P, R> = (payload: P) => Promise<R> | R;

export function decisionHook<P, R>(name: string, log: Logger, fn: Hook<P, R>): (payload: P) => Promise<R> {
  return async payload => {
    try {
      return await fn(payload);
    } catch (error) {
      if (error instanceof AppError) {
        log.info('hook_rejected', { hook: name, code: error.code });
        // Hocuspocus는 던진 오류의 `reason`을 기기의 `authenticationFailed {reason}`으로 보낸다
        // (없으면 'permission-denied'). 기기가 E_AUTH·E_FORBIDDEN 등을 구분하도록 코드를 싣는다.
        throw Object.assign(error, { reason: error.code });
      }
      log.error('hook_failed', { hook: name, error });
      throw error;
    }
  };
}

export function notifyHook<P>(
  name: string,
  log: Logger,
  fn: Hook<P, unknown>,
): (payload: P) => Promise<void> {
  return async payload => {
    try {
      await fn(payload);
    } catch (error) {
      log.error('hook_failed', { hook: name, error });
    }
  };
}
