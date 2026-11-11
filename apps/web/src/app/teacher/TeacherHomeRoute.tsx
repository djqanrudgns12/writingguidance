import { MS_PER_SECOND } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { TeacherHomeView, type TeacherRecentRoom } from '../../ui/screens/teacher/index.ts';
import { useAppDeps } from '../providers.tsx';
import { useToast } from './hooks/useToast.ts';
import { teacherPaths } from './paths.ts';
import { ToastLayer } from './ToastLayer.tsx';

function isRegisteredState(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && (state as { registered?: unknown }).registered === true
  );
}

/**
 * T0 선생님 홈(PRD F-20): 이 기기가 기억하는 최근 수업방(최대 `RECENT_ROOMS_MAX`, 최근 사용 순).
 * 앱 업데이트는 홈·선생님 홈에서만 적용한다(PLAN §6.6).
 */
export function TeacherHomeRoute() {
  const deps = useAppDeps();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast(deps.config.NOTICE_SHOW_SEC * MS_PER_SECOND);
  const registered = isRegisteredState(location.state);
  const { show } = toast;

  // 등록 링크를 막 저장하고 넘어왔으면 한 번 알린다.
  useEffect(() => {
    if (registered) show(ko.teacher.registerLinkSavedToast);
  }, [registered, show]);
  const [rooms, setRooms] = useState<readonly TeacherRecentRoom[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    deps.memory.teachers(deps.now()).then(
      list => {
        if (cancelled) return;
        const recent = [...list]
          .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
          .slice(0, deps.config.RECENT_ROOMS_MAX)
          .map(t => ({ roomId: t.roomId, displayName: t.displayName, expiresAt: t.expiresAt }));
        setRooms(recent);
      },
      () => {
        if (!cancelled) setRooms([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [deps]);

  useEffect(() => {
    deps.pwa.applyIfReady();
    return deps.pwa.updateReady.subscribe(ready => {
      if (ready) deps.pwa.applyIfReady();
    });
  }, [deps]);

  return (
    <>
      <TeacherHomeView
        recentRooms={rooms ?? []}
        loading={rooms === null}
        onCreateRoom={() => navigate(teacherPaths.create)}
        onOpenRoom={roomId => navigate(teacherPaths.room(roomId))}
        onEnterWithPin={() => navigate(teacherPaths.pin)}
        onBack={() => navigate('/')}
      />
      <ToastLayer control={toast} />
    </>
  );
}
