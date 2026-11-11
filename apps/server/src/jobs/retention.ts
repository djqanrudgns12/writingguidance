import { computeCommandCutoffMs, dayKey, MS_PER_DAY } from '@geulbang/core';
import type { Config } from '@geulbang/core/config';
import type { DeleteRoom } from '../application/deleteRoom.ts';
import type { Logger } from '../log.ts';
import type { Repos } from '../store/repos/index.ts';
import { pruneRateBuckets } from './rateBuckets.ts';

/**
 * 정리 작업(PLAN §5.3, PRD F-24). 60초마다:
 * 1. 만료된 수업방 → `deleteRoom`(PLAN §7.7 순서: 방송 → 연결 닫기 → 행 삭제 → 체크포인트 → 메모리 정리)
 * 2. 개인 모드 만료(v1.1, 아직 없음)
 * 3. 하루 지난 속도 제한 칸 4. `COMMAND_RETENTION_DAYS` 지난 명령 기록 5. 일주일 지난 AI 하루 칸
 * 시작할 때 한 번: 서버가 호출 도중 꺼져 RESERVED로 남은 AI 예약을 REFUNDED로 되돌린다.
 */
/** PLAN §5.3 "60초마다". 제품 동작이 아니라 정리 주기라 내부 값으로 둔다(ADR-053의 내부 값 규칙). */
const RETENTION_INTERVAL_MS = 60_000;
/** PLAN §5.3-5 "ai_daily WHERE day < :sevenDaysAgo" */
const AI_DAILY_KEEP_DAYS = 7;

export interface RetentionJob {
  /** 한 회차(시험에서 바로 부를 때도 쓴다). 회차가 겹치면 뒤의 것은 건너뛴다. */
  runOnce(): Promise<void>;
  stop(): void;
}

export function startRetention(deps: {
  readonly config: Readonly<Config>;
  readonly repos: Repos;
  readonly log: Logger;
  readonly now: () => number;
  readonly deleteRoom: DeleteRoom;
}): RetentionJob {
  const { config, repos, log } = deps;
  let running: Promise<void> | null = null;

  const once = async () => {
    const now = deps.now();
    for (const roomId of repos.rooms.listExpiredIds(now)) {
      try {
        await deps.deleteRoom(roomId, 'EXPIRED');
      } catch (error) {
        log.error('retention_delete_failed', { error });
      }
    }
    const buckets = pruneRateBuckets(repos.db, now);
    const commands = repos.commands.prune(computeCommandCutoffMs(now, config));
    const daily = repos.aiUsage.pruneDaily(dayKey(now - AI_DAILY_KEEP_DAYS * MS_PER_DAY, config.TIMEZONE));
    if (buckets + commands + daily > 0) {
      log.debug('retention', { detail: `buckets=${buckets} commands=${commands} ai_daily=${daily}` });
    }
  };

  const runOnce = () => {
    running ??= once()
      .catch((error: unknown) => log.error('retention_failed', { error }))
      .finally(() => {
        running = null;
      });
    return running;
  };

  const timer = setInterval(() => void runOnce(), RETENTION_INTERVAL_MS);
  timer.unref();
  return {
    runOnce,
    stop() {
      clearInterval(timer);
    },
  };
}

/** 서버가 AI 호출 도중 꺼져 남은 예약을 되돌린다(PLAN §5.3 "시작할 때"). 우리 쪽 사정이라 한도에서 뺀다. */
export function refundInterruptedAi(repos: Repos, config: Readonly<Config>, now: number): number {
  let n = 0;
  for (const usage of repos.aiUsage.listReserved()) {
    const changed = repos.aiUsage.settle(usage.id, {
      status: 'REFUNDED',
      errorCode: 'E_INTERNAL',
      model: null,
      latencyMs: 0,
      tokensIn: 0,
      tokensOut: 0,
      finishedAt: now,
    });
    if (changed === 1) {
      repos.aiUsage.releaseDaily(dayKey(usage.createdAt, config.TIMEZONE), 'GLOBAL');
      n++;
    }
  }
  return n;
}
