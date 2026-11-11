import type { ErrorCode } from '@geulbang/core/errors';
import type { Hello } from '@geulbang/core/protocol';
import { useCallback, useRef, useState } from 'react';
import type { AppDeps } from '../../../application/deps.ts';
import { consentNeeded, updateConsent } from '../../../application/joinRoom.ts';
import type { StudentSession } from '../../../application/openWriting.ts';
import { errorCodeOf } from '../errorCode.ts';

/**
 * 처리방침 다시 동의 관문(PRD F-03, 검토 B03). 쓰기(S5)·글 종류(S4)를 주소로 바로 열거나 새로고침해도
 * hello의 정책 판이 동의한 판과 다르면 다시 동의를 먼저 받는다. 판단은 S1 다시 들어오기와 같은 `consentNeeded`.
 * hello가 오기 전(오프라인)에는 묻지 않는다: 기기 사본으로 쓰기는 계속되고, 연결되면 그때 묻는다.
 */
export interface ConsentGate {
  /** 다시 동의해야 하는 판. 필요 없으면 null */
  readonly needed: string | null;
  readonly agreeing: boolean;
  readonly error: ErrorCode | null;
  agree(): Promise<void>;
}

export function useConsentGate(
  deps: Pick<AppDeps, 'newId'>,
  student: StudentSession | null,
  hello: Hello | null,
): ConsentGate {
  const [agreeing, setAgreeing] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  // 동의가 끝나면 다시 그리게 한다(동의한 판은 연결별 기억에 있다).
  const [, setAgreedTick] = useState(0);
  const commandId = useRef<string | null>(null);
  const needed = student && hello ? consentNeeded(student.channel, hello) : null;

  const agree = useCallback(async () => {
    if (!student || !needed || agreeing) return;
    setAgreeing(true);
    setError(null);
    // 다시 하기 사이에는 같은 명령 ID(서버가 한 번만 처리).
    commandId.current ??= deps.newId();
    try {
      await updateConsent(student.channel, needed, commandId.current);
      commandId.current = null;
      setAgreedTick(n => n + 1);
    } catch (e) {
      setError(errorCodeOf(e));
    } finally {
      setAgreeing(false);
    }
  }, [deps, student, needed, agreeing]);

  return { needed, agreeing, error, agree };
}
