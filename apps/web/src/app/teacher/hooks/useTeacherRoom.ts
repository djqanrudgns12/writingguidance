import type { ErrorCode } from '@geulbang/core/errors';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { connectTeacher, type TeacherSession } from '../../../application/teacher.ts';
import type { TeacherRoomMemory } from '../../../ports/deviceMemory.ts';
import type { Unsubscribe } from '../../../ports/observable.ts';
import type { ConnectionState, RoomChannelState } from '../../../ports/realtime.ts';
import { useAppDeps } from '../../providers.tsx';
import {
  initialTeacherRoomState,
  reduceTeacherRoom,
  type TeacherRoomAction,
  type TeacherRoomState,
} from './teacherRoomState.ts';

export interface TeacherRoomHandle {
  /** 연결 전(기기 ID를 읽는 중)이면 null */
  readonly teacher: TeacherSession | null;
  readonly state: TeacherRoomState;
  readonly channelState: RoomChannelState;
  readonly connection: ConnectionState;
  readonly failure: ErrorCode | null;
  /** 서버 기준 지금(연결 전이면 기기 시계) */
  readonly serverNow: () => number;
  /** 명령 응답(`ack`)으로 안 결과를 이벤트보다 먼저 반영할 때 */
  readonly dispatch: (action: TeacherRoomAction) => void;
}

/**
 * 교사 수업방 연결(PLAN §2.3 ⑧⑨, §4.4): `connectTeacher` → `hello` + 이벤트를 합친 상태.
 * 화면을 떠나면 채널과 연결을 닫는다. 같은 방·같은 토큰이면 다시 그려도 연결을 새로 만들지 않는다.
 */
export function useTeacherRoom(entry: TeacherRoomMemory | null): TeacherRoomHandle {
  const deps = useAppDeps();
  const [state, dispatch] = useReducer(reduceTeacherRoom, initialTeacherRoomState);
  const [teacher, setTeacher] = useState<TeacherSession | null>(null);
  const [channelState, setChannelState] = useState<RoomChannelState>('connecting');
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [failure, setFailure] = useState<ErrorCode | null>(null);

  const roomId = entry?.roomId ?? null;
  const token = entry?.teacherToken ?? null;

  useEffect(() => {
    if (!entry || roomId === null || token === null) return;
    let cancelled = false;
    let session: TeacherSession | null = null;
    const unsubs: Unsubscribe[] = [];

    void deps.memory.deviceId().then(deviceId => {
      if (cancelled) return;
      const t = connectTeacher(deps, entry, deviceId);
      session = t;
      const { channel } = t;

      const onHello = (hello: ReturnType<typeof channel.hello.get>) => {
        if (hello) dispatch({ type: 'hello', hello });
      };
      onHello(channel.hello.get());
      unsubs.push(channel.hello.subscribe(onHello));
      setChannelState(channel.state.get());
      unsubs.push(channel.state.subscribe(setChannelState));
      setFailure(channel.failure.get());
      unsubs.push(channel.failure.subscribe(setFailure));
      setConnection(t.session.state.get());
      unsubs.push(t.session.state.subscribe(setConnection));

      unsubs.push(
        channel.on('summary.batch', data => dispatch({ type: 'summary.batch', data })),
        channel.on('participant.update', (data, serverNow) =>
          dispatch({ type: 'participant.update', data, serverNow }),
        ),
        channel.on('doc.status', data => dispatch({ type: 'doc.status', data })),
        channel.on('timer', data => dispatch({ type: 'timer', data })),
        channel.on('resume.pending', data => dispatch({ type: 'resume.pending', data })),
        channel.on('resume.decided', data => dispatch({ type: 'resume.decided', requestId: data.requestId })),
        channel.on('room.settings', data => dispatch({ type: 'room.settings', settings: data.settings })),
        channel.on('room.status', data => dispatch({ type: 'room.status', status: data.status })),
      );
      setTeacher(t);
    });

    return () => {
      cancelled = true;
      for (const unsub of unsubs) unsub();
      session?.close();
      setTeacher(null);
    };
    // entry 객체가 새로 만들어져도 방·토큰이 같으면 다시 연결하지 않는다(그래서 entry 대신 두 값을 본다).
  }, [deps, roomId, token]);

  const serverNow = useCallback(() => (teacher ? teacher.session.serverNow() : deps.now()), [teacher, deps]);

  return { teacher, state, channelState, connection, failure, serverNow, dispatch };
}
