import { randomUUID } from 'node:crypto';
import type { CommandName, Notice } from '@geulbang/core/protocol';
import type { TimerScheduler } from '../../jobs/timers.ts';
import { timerStateOf, type StoredTimer } from '../../store/repos/timers.ts';
import {
  command,
  requireTeacher,
  roomFor,
  type CommandDeps,
  type CommandSpec,
  type Handler,
} from './types.ts';

/**
 * 수업 진행 명령(PRD F-16·F-19, PLAN §4.4): 알림 바로 보내기, 타이머, 연결 점검 왕복.
 * 타이머는 서버에 끝나는 시각으로 저장하고(늦게 들어온 기기도 같은 시간), 바뀔 때마다 모두에게 `timer`를 보낸다.
 * 알림 소리는 수업방 설정의 `알림 소리` 하나를 따른다(PRD F-19).
 */
export function classCommands(
  deps: CommandDeps & { readonly timers: TimerScheduler },
): Array<[CommandName, CommandSpec]> {
  const { repos, events } = deps;

  const noticeSend: Handler<'notice.send'> = (actor, args, now) => {
    requireTeacher(actor);
    const room = roomFor(deps, actor, now);
    const notice: Notice = {
      noticeId: randomUUID(),
      text: args.text,
      sentAt: now,
      sound: room.settings.sound,
      kind: 'MANUAL',
    };
    repos.notices.insert(room.id, notice);
    return {
      result: { noticeId: notice.noticeId },
      after: () => events.toStudents(room.id, 'notice', notice),
    };
  };

  /** 타이머를 저장하고, 끝난 뒤 예약을 다시 만들고 모두에게 알린다. */
  const saveTimer = (timer: StoredTimer, now: number) => {
    repos.timers.save(timer);
    const state = timerStateOf(timer, now);
    return {
      result: { timer: state },
      after: () => {
        deps.timers.reschedule(timer.roomId);
        events.toRoom(timer.roomId, 'timer', state);
      },
    };
  };

  const start: Handler<'timer.start'> = (actor, args, now) => {
    requireTeacher(actor);
    const room = roomFor(deps, actor, now);
    const durationMs = args.durationSec * 1000;
    // 타이머 길이와 같거나 더 이른 알림은 끈다(PRD F-19 "5분 타이머의 5분 전").
    const alerts = [...new Set(args.alerts)].filter(m => m * 60 < args.durationSec).sort((a, b) => b - a);
    return saveTimer(
      {
        roomId: room.id,
        status: 'RUNNING',
        durationMs,
        endsAt: now + durationMs,
        pausedRemainingMs: null,
        alerts,
        endText: args.endText,
        startedAt: now,
      },
      now,
    );
  };

  const current = (roomId: string, now: number) => {
    const timer = repos.timers.find(roomId);
    return { timer, unchanged: { result: { timer: timerStateOf(timer, now) } } };
  };

  const pause: Handler<'timer.pause'> = (actor, _args, now) => {
    requireTeacher(actor);
    const room = roomFor(deps, actor, now);
    const { timer, unchanged } = current(room.id, now);
    if (timer?.status !== 'RUNNING' || timer.endsAt === null) return unchanged;
    return saveTimer(
      { ...timer, status: 'PAUSED', endsAt: null, pausedRemainingMs: Math.max(0, timer.endsAt - now) },
      now,
    );
  };

  const resume: Handler<'timer.resume'> = (actor, _args, now) => {
    requireTeacher(actor);
    const room = roomFor(deps, actor, now);
    const { timer, unchanged } = current(room.id, now);
    if (timer?.status !== 'PAUSED' || timer.pausedRemainingMs === null) return unchanged;
    return saveTimer(
      { ...timer, status: 'RUNNING', endsAt: now + timer.pausedRemainingMs, pausedRemainingMs: null },
      now,
    );
  };

  const cancel: Handler<'timer.cancel'> = (actor, _args, now) => {
    requireTeacher(actor);
    const room = roomFor(deps, actor, now);
    const { timer, unchanged } = current(room.id, now);
    if (!timer || timer.status === 'IDLE') return unchanged;
    return saveTimer({ ...timer, status: 'IDLE', endsAt: null, pausedRemainingMs: null }, now);
  };

  const ping: Handler<'ping'> = (actor, args, now) => {
    requireTeacher(actor);
    return { result: { sentAt: args.sentAt, serverNow: now } };
  };

  return [
    command('notice.send', noticeSend),
    command('timer.start', start),
    command('timer.pause', pause),
    command('timer.resume', resume),
    command('timer.cancel', cancel),
    command('ping', ping),
  ];
}
