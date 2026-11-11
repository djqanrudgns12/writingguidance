import { type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { TeacherRoomMemory } from '../../ports/deviceMemory.ts';
import { ClosedView } from '../../ui/screens/common/Closed.tsx';
import { LoadingView } from '../../ui/screens/common/Loading.tsx';
import { useTeacherEntry } from './hooks/useTeacherEntry.ts';
import { teacherPaths } from './paths.ts';

/**
 * `/t/room/:roomId*` 공통 앞단: 이 기기가 그 방의 교사 토큰을 기억하는지 본다.
 * 모르면 닫힌 문 화면(선생님 링크·PIN으로 다시 들어오게 선생님 홈으로).
 */
export function TeacherRoomGate({ children }: { children: (entry: TeacherRoomMemory) => ReactNode }) {
  const { roomId = '' } = useParams();
  const navigate = useNavigate();
  const state = useTeacherEntry(roomId);
  if (state.status === 'loading') return <LoadingView />;
  if (state.status === 'missing') {
    return <ClosedView kind="missingRoom" onHome={() => navigate(teacherPaths.home)} />;
  }
  return <>{children(state.entry)}</>;
}
