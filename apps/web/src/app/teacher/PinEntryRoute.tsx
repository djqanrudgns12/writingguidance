import { MS_PER_MINUTE } from '@geulbang/core';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { enterWithPin } from '../../application/teacher.ts';
import { PinEntryView } from '../../ui/screens/teacher/index.ts';
import { useAppDeps } from '../providers.tsx';
import { errorCodeOf, errorMessage } from './errors.ts';
import { useNow } from './hooks/useNow.ts';
import { teacherPaths } from './paths.ts';

/**
 * T5 PIN으로 들어가기(PRD F-20): 기기가 세션 토큰을 만들고 해시만 보낸다(`enterWithPin`). 들어가면 T3.
 * 서버가 잠갔다고 하면(`E_PIN_LOCKED`) 이 기기에서 `PIN_LOCK_MIN` 동안 숫자판을 막는다.
 */
export function PinEntryRoute() {
  const deps = useAppDeps();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const now = useNow(deps.now);
  /** 같은 PIN으로 다시 누르면 같은 명령(응답이 사라졌을 때 안전하게) */
  const attemptRef = useRef<{ pin: string; commandId: string; sessionToken: string } | null>(null);

  const submit = async () => {
    if (!attemptRef.current || attemptRef.current.pin !== pin) {
      attemptRef.current = { pin, commandId: deps.newId(), sessionToken: deps.newToken() };
    }
    const { commandId, sessionToken } = attemptRef.current;
    setSubmitting(true);
    setError(undefined);
    try {
      const { entry } = await enterWithPin(deps, pin, commandId, sessionToken);
      attemptRef.current = null;
      navigate(teacherPaths.room(entry.roomId), { replace: true });
    } catch (e) {
      const code = errorCodeOf(e);
      if (code === 'E_PIN_LOCKED') {
        setLockedUntil(deps.now() + deps.config.PIN_LOCK_MIN * MS_PER_MINUTE);
        setPin('');
      } else if (code === 'E_PIN_INVALID') {
        setError(errorMessage(code));
        setPin('');
      } else {
        // 연결 문제 등: PIN은 그대로 두고 다시 누르게 한다(같은 명령 ID로 다시 간다).
        setError(errorMessage(code));
      }
      setSubmitting(false);
    }
  };

  return (
    <PinEntryView
      value={pin}
      onChange={next => {
        setPin(next.replace(/\D+/g, '').slice(0, deps.config.PIN_MAX_LENGTH));
        setError(undefined);
      }}
      onSubmit={() => void submit()}
      submitting={submitting}
      error={error}
      lockedUntil={lockedUntil}
      nowMs={now}
      onBack={() => navigate(teacherPaths.home)}
      minLength={deps.config.PIN_MIN_LENGTH}
      maxLength={deps.config.PIN_MAX_LENGTH}
    />
  );
}
