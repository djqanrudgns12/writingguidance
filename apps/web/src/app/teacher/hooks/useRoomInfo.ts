import type { ApiOutput } from '@geulbang/core/api';
import type { ErrorCode } from '@geulbang/core/errors';
import { useCallback, useEffect, useState } from 'react';
import type { TeacherRoomMemory } from '../../../ports/deviceMemory.ts';
import { useAppDeps } from '../../providers.tsx';
import { errorCodeOf } from '../errors.ts';

export type TeacherRoomInfo = ApiOutput<'teacherRoomResult'>;

export type RoomInfoState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly info: TeacherRoomInfo }
  | { readonly status: 'error'; readonly code: ErrorCode };

/** 입장 코드·짧은 주소·삭제 예정일(REST `teacherRoom`). 실시간 `hello`에는 입장 코드가 없어서 따로 받는다. */
export function useRoomInfo(entry: TeacherRoomMemory): { state: RoomInfoState; reload: () => void } {
  const deps = useAppDeps();
  const [state, setState] = useState<RoomInfoState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const { roomId, teacherToken } = entry;
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    deps.api.teacherRoom(roomId, teacherToken).then(
      info => {
        if (!cancelled) setState({ status: 'ready', info });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', code: errorCodeOf(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [deps, roomId, teacherToken, attempt]);
  const reload = useCallback(() => setAttempt(n => n + 1), []);
  return { state, reload };
}
