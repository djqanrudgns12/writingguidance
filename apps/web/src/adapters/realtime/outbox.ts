import type { Unsubscribe } from '../../ports/observable.ts';
import type { OutboxEntry, OutboxStorePort } from '../../ports/localStore.ts';
import type { CommandError, RoomChannel } from '../../ports/realtime.ts';

/**
 * 명령 대기열(PLAN §6.5 `outbox.ts`, §2.3 ⑥). 오프라인에서도 의미가 있는 명령(`doc.submit`)만 기기에 적어 두고,
 * 연결되고 **그 글의 동기화가 끝난 뒤** 만든 순서대로 보낸다. 같은 `commandId`로 다시 보내므로 서버가 한 번만 실행한다.
 * - `ack` 성공·`E_STALE`(이미 다시 열린 뒤 도착한 옛 제출)·그 밖의 되돌릴 수 없는 거절 → 지우고 결과를 알린다.
 * - `E_SYNC_PENDING`·응답 없음 → 남겨 두고 잠시 뒤 다시.
 * - `holdOn`이 붙잡으라는 거절(동의 판이 지난 학생의 제출, P6-consent-block) → 지우지도 다시 보내지도 않고 멈춘다.
 *   재동의 뒤 `flush`나 다시 연결(`ready`)·새 제출이 다시 보낸다. 같은 commandId라 서버는 한 번만 처리한다.
 * - 그 글 동기화 기다리기가 거부됨:
 *   - 닫힘처럼 다시 될 수 있으면(`retryable`) 남겨 둔 채 이번 실행을 끝내고 잠시 뒤 다시(그때 새 제공자로, 검토 7번).
 *   - 영구 거절(`retryable:false`, 예: `E_DOC_TOO_LARGE`)이면 그 명령은 다시 해도 안 된다. 지우고 실패로 알려
 *     화면이 제출 잠금을 풀게 하고, 뒤의 다른 글 제출을 이어 보낸다(검토 B07). 글 사본은 기기 저장소에 그대로 있다.
 */
export interface OutboxResult {
  readonly entry: OutboxEntry;
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: CommandError;
}

export interface OutboxDeps {
  readonly store: OutboxStorePort;
  readonly channel: Pick<RoomChannel, 'roomId' | 'state' | 'send'>;
  /**
   * 그 글의 기기 변경이 서버에 다 닿을 때까지 기다린다(제공자 `unsyncedChanges === 0`).
   * 더 기다릴 수 없으면 `CommandError`로 거부한다(`retryable`이면 잠시 뒤 다시).
   */
  readonly waitDocSynced: (docId: string) => Promise<void>;
  readonly onResult?: (result: OutboxResult) => void;
  /** 이 거절이면 지우지 않고 붙잡아 둔다(뒤의 것도 순서대로 기다린다). 없으면 붙잡지 않는다. */
  readonly holdOn?: (error: CommandError) => boolean;
  readonly retryDelayMs?: number;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
}

export interface Outbox {
  /** 넣고 바로 보내기를 시도한다. 돌려주는 값은 `commandId`. */
  enqueue(
    entry: Omit<OutboxEntry, 'commandId' | 'createdAt' | 'roomId'> & { commandId?: string },
  ): Promise<string>;
  /** 지금 남은 것(화면의 "보내는 중" 표시용) */
  pending(): Promise<OutboxEntry[]>;
  flush(): Promise<void>;
  close(): void;
}

const RETRY_LATER = new Set(['E_SYNC_PENDING', 'E_OFFLINE', 'E_SERVER_DOWN', 'E_RATE_LIMITED', 'E_INTERNAL']);

export function createOutbox(deps: OutboxDeps): Outbox {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const retryDelay = deps.retryDelayMs ?? 1500;
  const roomId = deps.channel.roomId;
  let running: Promise<void> | null = null;
  let again = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const scheduleRetry = () => {
    if (closed || retryTimer) return;
    retryTimer = setTimer(() => {
      retryTimer = undefined;
      void flush();
    }, retryDelay);
  };

  /**
   * 다 보냈거나 연결이 없으면 `done`, 잠시 뒤 다시 보내야 하면 `retry`, 붙잡았으면 `held`.
   * `done`이 아니면 그사이 들어온 flush 요청으로 바로 다시 돌지 않는다(같은 거절을 곧바로 되풀이하지 않게).
   */
  const runOnce = async (): Promise<'done' | 'retry' | 'held'> => {
    const entries = await deps.store.list(roomId);
    for (const entry of entries) {
      if (closed || deps.channel.state.get() !== 'ready') return 'done';
      if (entry.docId) {
        try {
          await deps.waitDocSynced(entry.docId);
        } catch (error) {
          const e = error as Partial<CommandError> | undefined;
          if (e?.retryable !== false || !e.code) {
            // 항목은 지우지 않는다. 순서를 지키려고 뒤의 것도 이번에는 보내지 않는다.
            scheduleRetry();
            return 'retry';
          }
          await deps.store.remove(entry.commandId);
          deps.onResult?.({ entry, ok: false, error: { code: e.code, retryable: false } });
          continue;
        }
      }
      if (closed || deps.channel.state.get() !== 'ready') return 'done';
      try {
        const data = await deps.channel.send(entry.name, entry.args, { commandId: entry.commandId });
        await deps.store.remove(entry.commandId);
        deps.onResult?.({ entry, ok: true, data });
      } catch (error) {
        const e = error as CommandError;
        if (RETRY_LATER.has(e.code)) {
          scheduleRetry();
          return 'retry'; // 순서를 지키려고 뒤의 것도 기다린다.
        }
        // 다시 보낼 때를 기다린다: 같은 거절을 계속 되풀이하지 않게 시간표도 걸지 않는다.
        if (deps.holdOn?.(e)) return 'held';
        await deps.store.remove(entry.commandId);
        deps.onResult?.({ entry, ok: false, error: e });
      }
    }
    return 'done';
  };

  const flush = async (): Promise<void> => {
    if (closed) return;
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let result: 'done' | 'retry' | 'held';
      do {
        again = false;
        result = await runOnce();
      } while (again && result === 'done' && !closed);
    })().finally(() => {
      running = null;
    });
    return running;
  };

  const unsubscribe: Unsubscribe = deps.channel.state.subscribe(s => {
    if (s === 'ready') void flush();
  });

  return {
    async enqueue(input) {
      const commandId = input.commandId ?? newId();
      await deps.store.put({
        commandId,
        roomId,
        docId: input.docId,
        name: input.name,
        args: input.args,
        createdAt: now(),
      });
      void flush();
      return commandId;
    },
    pending: () => deps.store.list(roomId),
    flush,
    close() {
      closed = true;
      unsubscribe();
      if (retryTimer) clearTimer(retryTimer);
    },
  };
}
