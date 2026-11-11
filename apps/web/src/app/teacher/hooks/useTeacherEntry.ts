import { useEffect, useState } from 'react';
import type { TeacherRoomMemory } from '../../../ports/deviceMemory.ts';
import { useAppDeps } from '../../providers.tsx';

export type TeacherEntryState =
  | { readonly status: 'loading' }
  | { readonly status: 'missing' }
  | { readonly status: 'ready'; readonly entry: TeacherRoomMemory };

/**
 * 이 기기가 기억하는 그 수업방의 교사 토큰(PRD F-20). 없으면 `missing`(선생님 링크·PIN으로 다시 들어와야 한다).
 * 찾으면 마지막 사용 시각을 고쳐 최근 수업방 순서를 맞춘다.
 */
export function useTeacherEntry(roomId: string): TeacherEntryState {
  const deps = useAppDeps();
  const [state, setState] = useState<TeacherEntryState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void deps.memory
      .teachers(deps.now())
      .then(list => list.find(t => t.roomId === roomId) ?? null)
      .then(
        found => {
          if (cancelled) return;
          if (!found) {
            setState({ status: 'missing' });
            return;
          }
          setState({ status: 'ready', entry: found });
          void deps.memory.rememberTeacher({ ...found, lastUsedAt: deps.now() }).catch(() => undefined);
        },
        () => {
          if (!cancelled) setState({ status: 'missing' });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [deps, roomId]);
  return state;
}
