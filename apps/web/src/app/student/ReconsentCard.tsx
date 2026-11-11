import type { Hello } from '@geulbang/core/protocol';
import { useNavigate } from 'react-router';
import { ErrorStateView } from '../../ui/screens/common/ErrorState.tsx';
import { RoomCardView } from '../../ui/screens/student/RoomCardView.tsx';
import type { ConsentGate } from './hooks/useConsentGate.ts';
import { useRoomFlow } from './RoomFlow.tsx';

/** 다시 동의 화면(S1과 같은 수업 카드 + 동의, PRD F-03 S2). 동의를 보내다 실패하면 다시 하기. */
export function ReconsentCard({ hello, gate }: { readonly hello: Hello; readonly gate: ConsentGate }) {
  const flow = useRoomFlow();
  const navigate = useNavigate();
  if (gate.error) return <ErrorStateView code={gate.error} onRetry={() => void gate.agree()} />;
  const { room } = hello;
  return (
    <RoomCardView
      className={room.className}
      roomTitle={room.title}
      schoolName={room.schoolName}
      expiresAt={room.expiresAt}
      agreed={flow.agreed}
      onAgreedChange={flow.setAgreed}
      onStart={() => void gate.agree()}
      onLearnMore={() => navigate('/privacy')}
      starting={gate.agreeing}
    />
  );
}
