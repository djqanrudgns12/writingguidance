import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { joinRoom, newJoinAttempt, type JoinAttempt } from '../../application/joinRoom.ts';
import { requestResume } from '../../application/resumeOnDevice.ts';
import { LoadingView } from '../../ui/screens/common/Loading.tsx';
import { NicknameView } from '../../ui/screens/student/NicknameView.tsx';
import { useAppDeps } from '../providers.tsx';
import { errorCodeOf, errorLineOf } from './errorCode.ts';
import { useRoomFlow } from './RoomFlow.tsx';

/**
 * `/:code/name` S3 별명(PRD F-04). 동의 없이 바로 들어오면 S1로 돌려보낸다.
 * 별명이 겹치면(`E_NICK_TAKEN`) `내가 쓰던 거예요` → 이어 쓰기 요청(PLAN §2.3 ④) → S6.
 * 같은 별명으로 다시 누르면 같은 명령 ID·토큰으로 보내 서버가 한 번만 만든다(응답이 사라져도 안전).
 */
export function NicknamePage() {
  const deps = useAppDeps();
  const flow = useRoomFlow();
  const navigate = useNavigate();
  const { room, loadRoom } = flow;
  const [nickname, setNickname] = useState('');
  const [taken, setTaken] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const attempt = useRef<{ readonly nickname: string; readonly attempt: JoinAttempt } | null>(null);
  // 이어 쓰기 요청은 입장과 다른 명령이라 ID·토큰을 따로 둔다(같은 별명으로 다시 누르면 같은 값).
  const resumeAttempt = useRef<{ readonly nickname: string; readonly attempt: JoinAttempt } | null>(null);

  useEffect(() => loadRoom(), [loadRoom]);

  if (!flow.agreed) return <Navigate replace to=".." />;
  if (room.status !== 'ready') {
    return room.status === 'loading' ? <LoadingView /> : <Navigate replace to=".." />;
  }
  const info = room.room;

  const attemptFor = (name: string): JoinAttempt => {
    if (attempt.current?.nickname !== name)
      attempt.current = { nickname: name, attempt: newJoinAttempt(deps) };
    return attempt.current.attempt;
  };
  const resumeAttemptFor = (name: string): JoinAttempt => {
    if (resumeAttempt.current?.nickname !== name) {
      resumeAttempt.current = { nickname: name, attempt: newJoinAttempt(deps) };
    }
    return resumeAttempt.current.attempt;
  };

  const handleNext = async () => {
    const name = nickname.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const joined = await joinRoom(deps, info, flow.code, name, attemptFor(name));
      flow.setEntry(joined);
      navigate('../genre', { replace: true });
    } catch (e) {
      const code = errorCodeOf(e);
      if (code === 'E_NICK_TAKEN') setTaken(true);
      else setError(errorLineOf(code) ?? undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClaimMine = async () => {
    const name = nickname.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const resume = resumeAttemptFor(name);
      await requestResume(deps, info, flow.code, name, resume.commandId, resume.deviceToken);
      navigate('../wait', { replace: true });
    } catch (e) {
      setError(errorLineOf(errorCodeOf(e)) ?? undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <NicknameView
      roomLabel={`${info.className} · ${info.title}`}
      nickname={nickname}
      onNicknameChange={next => {
        setNickname(next);
        setTaken(false);
        setError(undefined);
      }}
      onNext={() => void handleNext()}
      taken={taken}
      onClaimMine={() => void handleClaimMine()}
      errorMessage={error}
      submitting={submitting}
    />
  );
}
