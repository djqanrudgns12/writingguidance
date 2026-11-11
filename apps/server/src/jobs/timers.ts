import { randomUUID } from 'node:crypto';
import type { Config } from '@geulbang/core/config';
import { ko } from '@geulbang/core/copy';
import type { Notice } from '@geulbang/core/protocol';
import type { Logger } from '../log.ts';
import type { RoomEvents } from '../realtime/roomEvents.ts';
import type { Repos } from '../store/repos/index.ts';
import { timerStateOf, type StoredTimer } from '../store/repos/timers.ts';

/**
 * 타이머 알림 예약(PLAN §7.5 `timers.ts`, PRD F-19). 사건 기반: 시작·멈춤·계속·취소 뒤 그 방 예약을 다시 만든다.
 * - 끝나기 N분 전 알림(`alerts`): 타이머 길이와 같거나 더 이른 알림은 건너뛴다.
 * - 끝날 때: 타이머를 `IDLE`로 돌리고 `timer` 이벤트, `endText`가 있으면 TIMER 알림.
 * - 예약은 메모리에만 있다. 서버가 다시 켜지면 `restore()`가 DB의 RUNNING 타이머로 다시 만든다(PLAN §7.1-3).
 *   꺼진 사이 지난 알림은 보내지 않는다(다시 연결한 기기는 최근 `NOTICE_REPLAY_SEC` 알림만 보므로).
 */
export interface TimerScheduler {
  reschedule(roomId: string): void;
  cancel(roomId: string): void;
  restore(): void;
  close(): void;
}

const MINUTE_MS = 60_000;

/** "N분 남았어요": 분 숫자 + `ko.teacher.timerRemainingMinSuffix`(화면 문구는 ko.ts에만 둔다) */
export function timerAlertText(minutes: number): string {
  return `${minutes}${ko.teacher.timerRemainingMinSuffix}`;
}

export function createTimerScheduler(deps: {
  readonly config: Readonly<Config>;
  readonly repos: Repos;
  readonly events: RoomEvents;
  readonly log: Logger;
  readonly now: () => number;
}): TimerScheduler {
  const { repos, events, log } = deps;
  const scheduled = new Map<string, NodeJS.Timeout[]>();

  const clear = (roomId: string) => {
    for (const t of scheduled.get(roomId) ?? []) clearTimeout(t);
    scheduled.delete(roomId);
  };

  const sendNotice = (roomId: string, text: string) => {
    const room = repos.rooms.findById(roomId);
    if (!room) return;
    const notice: Notice = {
      noticeId: randomUUID(),
      text,
      sentAt: deps.now(),
      sound: room.settings.sound,
      kind: 'TIMER',
    };
    repos.notices.insert(roomId, notice);
    events.toStudents(roomId, 'notice', notice);
  };

  const finish = (timer: StoredTimer) => {
    const current = repos.timers.find(timer.roomId);
    // 그사이 멈추거나 다시 시작했으면 이 예약은 낡았다.
    if (!current || current.status !== 'RUNNING' || current.endsAt !== timer.endsAt) return;
    const idle: StoredTimer = { ...current, status: 'IDLE', endsAt: null, pausedRemainingMs: null };
    repos.timers.save(idle);
    events.toRoom(timer.roomId, 'timer', timerStateOf(idle, deps.now()));
    if (current.endText.trim().length > 0) sendNotice(timer.roomId, current.endText);
    scheduled.delete(timer.roomId);
  };

  const guarded = (label: string, fn: () => void) => () => {
    try {
      fn();
    } catch (error) {
      log.error('timer_failed', { detail: label, error });
    }
  };

  const reschedule = (roomId: string) => {
    clear(roomId);
    const timer = repos.timers.find(roomId);
    if (!timer || timer.status !== 'RUNNING' || timer.endsAt === null) return;
    const now = deps.now();
    const handles: NodeJS.Timeout[] = [];
    const durationMs = timer.durationMs ?? timer.endsAt - now;
    for (const minutes of timer.alerts) {
      if (minutes * MINUTE_MS >= durationMs) continue;
      const at = timer.endsAt - minutes * MINUTE_MS;
      if (at <= now) continue;
      handles.push(
        setTimeout(
          guarded('alert', () => {
            const current = repos.timers.find(roomId);
            if (current?.status === 'RUNNING' && current.endsAt === timer.endsAt) {
              sendNotice(roomId, timerAlertText(minutes));
            }
          }),
          at - now,
        ),
      );
    }
    handles.push(
      setTimeout(
        guarded('end', () => finish(timer)),
        Math.max(0, timer.endsAt - now),
      ),
    );
    for (const h of handles) h.unref();
    scheduled.set(roomId, handles);
  };

  return {
    reschedule,
    cancel: clear,
    restore() {
      const now = deps.now();
      for (const timer of repos.timers.listRunning()) {
        if (timer.endsAt !== null && timer.endsAt <= now) {
          // 꺼진 사이 끝났다: 조용히 멈춘 상태로(지난 알림은 다시 보내지 않는다).
          repos.timers.save({ ...timer, status: 'IDLE', endsAt: null, pausedRemainingMs: null });
          continue;
        }
        reschedule(timer.roomId);
      }
    },
    close() {
      for (const roomId of [...scheduled.keys()]) clear(roomId);
    },
  };
}
