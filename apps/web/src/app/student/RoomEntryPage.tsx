import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { pendingResume } from '../../application/resumeOnDevice.ts';
import { ClosedView } from '../../ui/screens/common/Closed.tsx';
import { ErrorStateView } from '../../ui/screens/common/ErrorState.tsx';
import { LoadingView } from '../../ui/screens/common/Loading.tsx';
import { RoomCardView } from '../../ui/screens/student/RoomCardView.tsx';
import { useAppDeps } from '../providers.tsx';
import { useReentry } from './hooks/useReentry.ts';
import { useRoomFlow } from './RoomFlow.tsx';
import type { StudentRoomMemory } from '../../ports/deviceMemory.ts';

/**
 * `/:code` S1 수업 카드 + 동의(PRD F-02·F-03). 기기에 살아 있는 기억이 있으면 카드를 건너뛰고 바로 이어 쓴다(③).
 * 이어 쓰기를 기다리는 요청이 있으면 S6으로 간다(새로고침해도 그 화면으로, PRD F-14).
 */
export function RoomEntryPage() {
  const flow = useRoomFlow();
  const { entry } = flow;

  if (entry.status === 'loading') return <LoadingView />;
  if (entry.entry) return <Reenter entry={entry.entry} />;
  return <FirstEntry />;
}

function Reenter({ entry }: { readonly entry: StudentRoomMemory }) {
  const deps = useAppDeps();
  const flow = useRoomFlow();
  const navigate = useNavigate();
  const { setEntry, dropSession, resetRoom } = flow;
  // 토큰만 무효(방은 살아 있거나 확인 못 함): 앞서 들고 있던 수업방 정보를 버리고 S1이 새로 조회한다(PRD 16.6).
  const onForget = useCallback(() => {
    dropSession();
    resetRoom(false);
    setEntry(null);
  }, [dropSession, resetRoom, setEntry]);
  const { phase, agree, agreeing, retry } = useReentry(deps, entry, flow.session, onForget);

  if (phase.kind === 'go') {
    return <Navigate replace to={phase.to === 'write' && phase.docId ? `write/${phase.docId}` : 'genre'} />;
  }
  if (phase.kind === 'gone') return <ClosedView kind="expired" onHome={() => navigate('/')} />;
  if (phase.kind === 'error') return <ErrorStateView code={phase.code} onRetry={retry} />;
  if (phase.kind === 'consent') {
    const { room } = phase.hello;
    return (
      <RoomCardView
        className={room.className}
        roomTitle={room.title}
        schoolName={room.schoolName}
        expiresAt={room.expiresAt}
        agreed={flow.agreed}
        onAgreedChange={flow.setAgreed}
        onStart={() => void agree()}
        onLearnMore={() => navigate('/privacy')}
        starting={agreeing}
      />
    );
  }
  return <LoadingView />;
}

function FirstEntry() {
  const deps = useAppDeps();
  const flow = useRoomFlow();
  const navigate = useNavigate();
  const { room, loadRoom } = flow;
  const [waiting, setWaiting] = useState<boolean | null>(null);

  useEffect(() => loadRoom(), [loadRoom]);

  const roomId = room.status === 'ready' ? room.room.roomId : null;
  useEffect(() => {
    if (!roomId) return;
    let alive = true;
    void pendingResume(deps).then(
      p => alive && setWaiting(p?.roomId === roomId),
      () => alive && setWaiting(false),
    );
    return () => {
      alive = false;
    };
  }, [deps, roomId]);

  if (room.status === 'loading') return <LoadingView />;
  if (room.status === 'error') {
    if (room.code === 'E_ROOM_NOT_FOUND')
      return <ClosedView kind="missingRoom" onHome={() => navigate('/')} />;
    if (room.code === 'E_ROOM_EXPIRED') return <ClosedView kind="expired" onHome={() => navigate('/')} />;
    return <ErrorStateView code={room.code} onRetry={() => loadRoom(true)} />;
  }
  const info = room.room;
  if (info.status === 'EXPIRED' || info.status === 'DELETED') {
    return <ClosedView kind="expired" onHome={() => navigate('/')} />;
  }
  // 닫힌 수업방은 새 입장을 막는다(이미 들어온 학생만 읽기, PRD F-02).
  if (info.status === 'CLOSED') return <ErrorStateView code="E_ROOM_CLOSED" onRetry={() => loadRoom(true)} />;
  if (waiting === null) return <LoadingView />;
  if (waiting) return <Navigate replace to="wait" />;

  return (
    <RoomCardView
      className={info.className}
      roomTitle={info.title}
      schoolName={info.schoolName}
      expiresAt={info.expiresAt}
      agreed={flow.agreed}
      onAgreedChange={flow.setAgreed}
      onStart={() => navigate('name')}
      onLearnMore={() => navigate('/privacy')}
    />
  );
}
