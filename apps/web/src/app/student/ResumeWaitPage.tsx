import { MS_PER_MINUTE } from '@geulbang/core';
import type { ErrorCode } from '@geulbang/core/errors';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { waitHello } from '../../application/openWriting.ts';
import {
  cancelResume,
  dropResumeFor,
  pendingResume,
  waitForDecision,
} from '../../application/resumeOnDevice.ts';
import type { StudentRoomMemory } from '../../ports/deviceMemory.ts';
import { ClosedView } from '../../ui/screens/common/Closed.tsx';
import { ErrorStateView } from '../../ui/screens/common/ErrorState.tsx';
import { LoadingView } from '../../ui/screens/common/Loading.tsx';
import { ResumeWaitView } from '../../ui/screens/student/ResumeWaitView.tsx';
import { useAppDeps } from '../providers.tsx';
import { errorCodeOf } from './errorCode.ts';
import { useRoomFlow } from './RoomFlow.tsx';

type Pending = NonNullable<Awaited<ReturnType<typeof pendingResume>>>;

type WaitState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'none' }
  | { readonly kind: 'waiting'; readonly pending: Pending }
  | { readonly kind: 'rejected'; readonly pending: Pending }
  | { readonly kind: 'error'; readonly code: ErrorCode };

/**
 * `/:code/wait` S6 이어 쓰기 기다림(PRD F-14, PLAN §2.3 ④). 기기에 둔 요청을 긴 조회로 기다린다(새로고침해도 이어짐).
 * 허용되면 새 토큰으로 연결해 참가자 ID를 hello에서 받고 기억에 넣은 뒤 S1(다시 들어오기 ③)으로 간다.
 */
export function ResumeWaitPage() {
  const deps = useAppDeps();
  const flow = useRoomFlow();
  const navigate = useNavigate();
  const { room, loadRoom, session, setEntry } = flow;
  const [state, setState] = useState<WaitState>({ kind: 'loading' });
  const [longWait, setLongWait] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => loadRoom(), [loadRoom]);

  const info = room.status === 'ready' ? room.room : null;
  useEffect(() => {
    if (!info) return;
    const controller = new AbortController();
    let alive = true;
    void (async () => {
      const pending = await pendingResume(deps).catch(() => null);
      if (!alive) return;
      if (!pending || pending.roomId !== info.roomId) {
        setState({ kind: 'none' });
        return;
      }
      setState({ kind: 'waiting', pending });
      // 허용 뒤 참가자 ID: 새 토큰으로 연결해 hello의 `me`에서 받는다(서버는 토큰을 건네지 않는다).
      const participantId = async () => {
        const temp: StudentRoomMemory = {
          roomId: info.roomId,
          entryCode: flow.code,
          className: info.className,
          title: info.title,
          nickname: pending.nickname,
          participantId: '',
          deviceToken: pending.deviceToken,
          lastDocId: null,
          lastUsedAt: deps.now(),
          expiresAt: info.expiresAt,
        };
        const student = session(temp);
        if (!student) throw { code: 'E_INTERNAL', retryable: true };
        const hello = await waitHello(student.channel);
        if (!hello.me) throw { code: 'E_AUTH', retryable: false };
        return hello.me.participantId;
      };
      try {
        const entry = await waitForDecision(deps, info, pending, participantId, controller.signal);
        if (!alive) return;
        if (entry) {
          setEntry(entry);
          navigate('..', { replace: true });
        } else if (!controller.signal.aborted) {
          setState({ kind: 'rejected', pending });
        }
      } catch (e) {
        if (alive) setState({ kind: 'error', code: errorCodeOf(e) });
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [deps, info, flow.code, session, setEntry, navigate, attempt]);

  // 수업방이 없어졌으면 그 방 이어 쓰기 대기도 지운다(검토 B04).
  const roomGone =
    room.status === 'error' && (room.code === 'E_ROOM_NOT_FOUND' || room.code === 'E_ROOM_EXPIRED');
  useEffect(() => {
    if (roomGone) void dropResumeFor(deps.localStore.kv, p => p.entryCode === flow.code).catch(() => {});
  }, [roomGone, deps, flow.code]);

  // 30분이 지나면 "선생님이 아직 못 보셨어요"를 더한다(요청은 저절로 사라지지 않는다, PRD F-14).
  useEffect(() => {
    if (state.kind !== 'waiting') return;
    const id = setTimeout(() => setLongWait(true), deps.config.RESUME_WAIT_HINT_MIN * MS_PER_MINUTE);
    return () => clearTimeout(id);
  }, [state.kind, deps.config.RESUME_WAIT_HINT_MIN]);

  if (roomGone) return <ClosedView kind="expired" onHome={() => navigate('/')} />;
  if (room.status === 'error') return <ErrorStateView code={room.code} onRetry={() => loadRoom(true)} />;
  if (state.kind === 'none') return <Navigate replace to="../name" />;
  if (state.kind === 'error')
    return <ErrorStateView code={state.code} onRetry={() => setAttempt(n => n + 1)} />;
  if (state.kind === 'loading') return <LoadingView />;

  const toName = () => navigate('../name', { replace: true });
  return (
    <ResumeWaitView
      status={state.kind === 'rejected' ? 'rejected' : 'waiting'}
      longWait={longWait}
      onCancel={() => {
        void cancelResume(deps, state.pending)
          .catch(() => {})
          .finally(toName);
      }}
      onChooseOther={toName}
    />
  );
}
