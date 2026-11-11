import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { TeacherRegisterView, type TeacherRegisterState } from '../../ui/screens/teacher/index.ts';
import { useAppDeps } from '../providers.tsx';
import { isStartCodeShape, writeStartCode } from './hooks/startCode.ts';
import { stripHashFromAddressBar, teacherPaths } from './paths.ts';

/** `#` 뒤 등록 코드. 첫 그림 때 한 번만 읽는다(읽은 뒤 바로 주소창에서 지우므로). */
function readRegisterCode(): string {
  try {
    return decodeURIComponent(globalThis.location.hash.replace(/^#/, '')).trim();
  } catch {
    return '';
  }
}

/**
 * 선생님 등록 링크(`/t/register#코드`, PRD F-15, PLAN §6.1): 코드를 기기 `kv`에 저장하고, 주소창에서 지운 뒤 `/t`.
 * 코드는 서버로 보내지 않는다(다음 수업방 만들기 때 머리로 간다). 모양이 틀리거나 저장이 막히면 이 화면에 남는다.
 */
export function TeacherRegisterRoute() {
  const deps = useAppDeps();
  const navigate = useNavigate();
  const [code] = useState(readRegisterCode);
  const [state, setState] = useState<TeacherRegisterState>(() =>
    isStartCodeShape(code, deps.config) ? 'saving' : 'invalid',
  );

  useEffect(() => {
    // 저장 여부와 관계없이 코드는 주소창에 남기지 않는다(방문 기록·화면 공유로 새지 않게).
    stripHashFromAddressBar();
    if (!isStartCodeShape(code, deps.config)) return;
    let cancelled = false;
    writeStartCode(deps.localStore.kv, code).then(
      () => {
        if (cancelled) return;
        setState('saved');
        navigate(teacherPaths.home, { replace: true, state: { registered: true } });
      },
      () => {
        if (!cancelled) setState('blocked');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [deps, code, navigate]);

  return (
    <TeacherRegisterView
      state={state}
      onCreateRoom={() => navigate(teacherPaths.create)}
      onTeacherHome={() => navigate(teacherPaths.home)}
    />
  );
}
