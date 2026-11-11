import type { ErrorCode } from '@geulbang/core/errors';
import type { Hello } from '@geulbang/core/protocol';
import { useEffect, useState } from 'react';
import type { StudentSession } from '../../../application/openWriting.ts';
import type { StudentRoomMemory } from '../../../ports/deviceMemory.ts';
import type { ConnectionState, RoomChannelState } from '../../../ports/realtime.ts';
import { useObservable } from './useObservable.ts';

/**
 * 흐름 묶음의 실시간 연결을 화면 상태로 읽는다(S4·S5). 연결은 효과 안에서 연다(그리기 중에 열지 않는다).
 * 같은 토큰이면 묶음이 같은 연결을 돌려주므로 S1 → S5로 넘어가도 다시 연결하지 않는다.
 */
export interface StudentConnection {
  readonly student: StudentSession | null;
  readonly hello: Hello | null;
  readonly channelState: RoomChannelState;
  readonly failure: ErrorCode | null;
  readonly connection: ConnectionState;
}

export function useStudentSession(
  entry: StudentRoomMemory | null,
  open: (entry: StudentRoomMemory) => StudentSession | null,
): StudentConnection {
  const [student, setStudent] = useState<StudentSession | null>(null);

  useEffect(() => {
    setStudent(entry ? open(entry) : null);
  }, [entry, open]);

  const hello = useObservable(student?.channel.hello, null);
  const channelState = useObservable<RoomChannelState>(student?.channel.state, 'connecting');
  const failure = useObservable(student?.channel.failure, null);
  const connection = useObservable<ConnectionState>(student?.session.state, 'connecting');
  return { student, hello, channelState, failure, connection };
}
