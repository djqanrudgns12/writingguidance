import type { ErrorCode } from '@geulbang/core/errors';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { enterWithLink } from '../../application/teacher.ts';
import { ClosedView } from '../../ui/screens/common/Closed.tsx';
import { ErrorStateView } from '../../ui/screens/common/ErrorState.tsx';
import { LoadingView } from '../../ui/screens/common/Loading.tsx';
import { NotFound } from '../../ui/screens/common/NotFound.tsx';
import { useAppDeps } from '../providers.tsx';
import { errorCodeOf } from './errors.ts';
import { replaceAddressBar, RESERVED_TEACHER_SEGMENTS, teacherPaths } from './paths.ts';

/** 다시 들어올 수 없는 링크(지워졌거나 만료된 방, 새로 만든 링크로 바뀐 옛 링크) */
const DEAD_LINK_CODES: readonly ErrorCode[] = ['E_AUTH', 'E_ROOM_EXPIRED', 'E_ROOM_NOT_FOUND', 'E_FORBIDDEN'];

/**
 * 선생님 링크 `/t/:token`(PRD F-20, PLAN §6.1). 토큰은 받자마자 주소창에서 지우고(방문 기록·화면 공유로 새지 않게)
 * `enterWithLink`로 기기에 저장한 뒤 T3로 간다. 예약어(`register` 등)는 토큰으로 보지 않는다.
 */
export function TeacherLinkRoute() {
  const deps = useAppDeps();
  const navigate = useNavigate();
  const params = useParams();
  // 주소창을 바꾼 뒤에도 같은 토큰을 쓰게 처음 값만 붙잡아 둔다.
  const tokenRef = useRef(params['token'] ?? '');
  const token = tokenRef.current;
  const reserved = RESERVED_TEACHER_SEGMENTS.includes(token);
  const [failure, setFailure] = useState<ErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (reserved || !token) return;
    replaceAddressBar(teacherPaths.home);
    let cancelled = false;
    setFailure(null);
    enterWithLink(deps, token).then(
      entry => {
        if (!cancelled) navigate(teacherPaths.room(entry.roomId), { replace: true });
      },
      (error: unknown) => {
        if (!cancelled) setFailure(errorCodeOf(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [deps, navigate, token, reserved, attempt]);

  if (reserved || !token) return <NotFound />;
  if (failure && DEAD_LINK_CODES.includes(failure)) {
    return <ClosedView kind="expired" onHome={() => navigate(teacherPaths.home, { replace: true })} />;
  }
  if (failure) return <ErrorStateView code={failure} onRetry={() => setAttempt(n => n + 1)} />;
  return <LoadingView />;
}
