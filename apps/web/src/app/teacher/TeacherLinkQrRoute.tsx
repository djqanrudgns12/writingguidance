import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ClosedView } from '../../ui/screens/common/Closed.tsx';
import { LoadingView } from '../../ui/screens/common/Loading.tsx';
import { TeacherLinkQrView } from '../../ui/screens/teacher/index.ts';
import { useAppDeps } from '../providers.tsx';
import { stripHashFromAddressBar, teacherLinkOf, teacherPaths } from './paths.ts';

function readHashToken(): string {
  try {
    return decodeURIComponent(globalThis.location.hash.replace(/^#/, '')).trim();
  } catch {
    return '';
  }
}

/**
 * 선생님 링크 QR 별도 창(PRD F-16, `/t/room/:roomId/qr#토큰`). 토큰은 첫 그림 때 `#` 뒤에서 읽고 바로 주소창에서 지운다.
 * 창을 다시 불러와 `#`이 없으면 이 기기 기억에서 그 방 토큰을 찾는다.
 */
export function TeacherLinkQrRoute() {
  const deps = useAppDeps();
  const navigate = useNavigate();
  const { roomId = '' } = useParams();
  const [hashToken] = useState(readHashToken);
  const [token, setToken] = useState<string | null | undefined>(hashToken || undefined);

  useEffect(() => {
    stripHashFromAddressBar();
    if (hashToken) return;
    let cancelled = false;
    deps.memory.teachers(deps.now()).then(
      list => {
        if (!cancelled) setToken(list.find(t => t.roomId === roomId)?.teacherToken ?? null);
      },
      () => {
        if (!cancelled) setToken(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [deps, roomId, hashToken]);

  if (token === undefined) return <LoadingView />;
  if (token === null) return <ClosedView kind="missingRoom" onHome={() => navigate(teacherPaths.home)} />;

  return (
    <TeacherLinkQrView
      teacherLinkUrl={teacherLinkOf(deps.config, token)}
      onClose={() => {
        globalThis.close();
        // 스크립트가 연 창이 아니면 닫히지 않는다: 대시보드로 돌아간다.
        navigate(teacherPaths.room(roomId), { replace: true });
      }}
    />
  );
}
