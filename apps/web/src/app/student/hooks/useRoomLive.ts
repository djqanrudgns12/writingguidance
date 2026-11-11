import { MS_PER_SECOND, type DocStatus, type RoomStatus } from '@geulbang/core';
import type { Config } from '@geulbang/core/config';
import type { Hello, Notice, RoomSettings, TimerState } from '@geulbang/core/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomChannel } from '../../../ports/realtime.ts';

/**
 * 쓰기 화면이 듣는 수업방 채널 이벤트(PRD F-08·F-19·F-22, PLAN §4.4).
 * - 설정(켠 AI 버튼·소리)·수업방 상태(닫힘·삭제)·타이머: hello에서 시작해 이벤트로 바뀐다.
 * - 교사 알림: `NOTICE_SHOW_SEC` 동안 보인다. 다시 연결하면 hello의 최근 알림 중 `NOTICE_REPLAY_SEC` 안의 것을 한 번 보인다.
 * - 이 글의 상태(`doc.status`)·`teacher.editing`
 */
export interface RoomLive {
  readonly settings: RoomSettings | null;
  readonly roomStatus: RoomStatus | null;
  readonly timer: TimerState | null;
  readonly notice: Notice | null;
  dismissNotice(): void;
  /** 이 글의 상태(hello 또는 `doc.status`) */
  readonly docStatus: DocStatus | null;
}

export interface RoomLiveHandlers {
  onNotice?(notice: Notice): void;
  onTeacherEditing?(): void;
}

export function useRoomLive(
  channel: RoomChannel | null,
  hello: Hello | null,
  docId: string,
  config: Pick<Config, 'NOTICE_SHOW_SEC' | 'NOTICE_REPLAY_SEC'>,
  /** 서버 기준 지금(알림 시각은 서버 시각이다) */
  serverNow: () => number,
  handlers: RoomLiveHandlers,
): RoomLive {
  const [settings, setSettings] = useState<RoomSettings | null>(null);
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [docStatus, setDocStatus] = useState<DocStatus | null>(null);
  const shown = useRef(new Set<string>());
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(handlers);
  latest.current = handlers;

  const show = useCallback(
    (n: Notice) => {
      if (shown.current.has(n.noticeId)) return;
      shown.current.add(n.noticeId);
      setNotice(n);
      latest.current.onNotice?.(n);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setNotice(null), config.NOTICE_SHOW_SEC * MS_PER_SECOND);
    },
    [config.NOTICE_SHOW_SEC],
  );

  // hello는 다시 연결할 때마다 새로 온다.
  useEffect(() => {
    if (!hello) return;
    setSettings(hello.room.settings);
    setRoomStatus(hello.room.status);
    setTimer(hello.timer);
    const mine = hello.docs.find(d => d.docId === docId);
    if (mine) setDocStatus(mine.status);
    const replayFrom = serverNow() - config.NOTICE_REPLAY_SEC * MS_PER_SECOND;
    const recent = [...hello.recentNotices].sort((a, b) => b.sentAt - a.sentAt)[0];
    // 다시 연결: 끊긴 사이 온 최근 알림 하나(이미 본 것은 다시 보이지 않는다)
    if (recent && recent.sentAt >= replayFrom) show(recent);
  }, [hello, docId, config.NOTICE_REPLAY_SEC, serverNow, show]);

  useEffect(() => {
    if (!channel) return;
    const offs = [
      channel.on('room.settings', d => setSettings(d.settings)),
      channel.on('room.status', d => setRoomStatus(d.status)),
      channel.on('timer', t => setTimer(t)),
      channel.on('notice', n => show(n)),
      channel.on('doc.status', d => {
        if (d.docId === docId) setDocStatus(d.status);
      }),
      channel.on('teacher.editing', d => {
        if (d.docId === docId) latest.current.onTeacherEditing?.();
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [channel, docId, show]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const dismissNotice = useCallback(() => {
    clearTimeout(hideTimer.current);
    setNotice(null);
  }, []);

  return { settings, roomStatus, timer, notice, dismissNotice, docStatus };
}
