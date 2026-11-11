import type { ErrorCode } from '@geulbang/core/errors';
import type { Hello } from '@geulbang/core/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pickResumeDoc, waitHello, type StudentSession } from '../../../application/openWriting.ts';
import type { AppDeps } from '../../../application/deps.ts';
import { consentNeeded, updateConsent } from '../../../application/joinRoom.ts';
import { purgeRoomOnDevice, settleInvalidStudentToken } from '../../../application/purgeLocal.ts';
import type { StudentRoomMemory } from '../../../ports/deviceMemory.ts';
import { errorCodeOf, isConnectionError } from '../errorCode.ts';

/**
 * 같은 기기 다시 들어오기(PLAN §2.3 ③): 기억한 토큰으로 바로 연결 → hello → 정책 판이 같으면 이어 쓸 글로.
 * - 정책 판이 바뀌었으면 S1(다시 동의, PRD F-03 S2)을 보이고 `consent.update` 뒤에 이어 간다.
 * - `E_AUTH`(토큰 무효)면 방을 다시 조회해, 지워진 방이면 기기 사본까지 지우고 닫힌 문, 아니면 기억만 지우고 S1로.
 * - 연결이 없으면(오프라인·서버 멈춤) 마지막 글이 있을 때 바로 쓰기 화면으로 간다(기기 사본으로 쓴다).
 */
export type ReentryPhase =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'consent'; readonly hello: Hello; readonly policyVersion: string }
  | { readonly kind: 'go'; readonly to: 'write' | 'genre'; readonly docId: string | null }
  | { readonly kind: 'forgotten' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'error'; readonly code: ErrorCode };

export interface Reentry {
  readonly phase: ReentryPhase;
  /** 다시 동의(S2) → 서버에 적고 이어 간다 */
  agree(): Promise<void>;
  readonly agreeing: boolean;
  retry(): void;
}

export function useReentry(
  deps: AppDeps,
  entry: StudentRoomMemory | null,
  open: (entry: StudentRoomMemory) => StudentSession | null,
  onForget: () => void,
): Reentry {
  const [phase, setPhase] = useState<ReentryPhase>({ kind: 'connecting' });
  const [agreeing, setAgreeing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const consentCommand = useRef<string | null>(null);
  const studentRef = useRef<StudentSession | null>(null);

  const resume = useCallback((hello: Hello, e: StudentRoomMemory) => {
    const doc = pickResumeDoc(e, hello.docs);
    setPhase(doc ? { kind: 'go', to: 'write', docId: doc.docId } : { kind: 'go', to: 'genre', docId: null });
  }, []);

  useEffect(() => {
    // 연결은 그리기 중이 아니라 여기서 연다(StrictMode가 효과를 다시 붙여도 같은 토큰이면 같은 연결).
    const student = entry ? open(entry) : null;
    studentRef.current = student;
    if (!entry || !student) return;
    let alive = true;
    setPhase({ kind: 'connecting' });

    // 연결이 없으면 기다리지 않고 기기 사본으로 쓰기 화면을 연다.
    const offState = student.session.state.subscribe(s => {
      if (!alive || (s !== 'offline' && s !== 'server-down')) return;
      if (entry.lastDocId) setPhase({ kind: 'go', to: 'write', docId: entry.lastDocId });
    });

    waitHello(student.channel).then(
      hello => {
        if (!alive) return;
        const policy = consentNeeded(student.channel, hello);
        if (policy) {
          setPhase({ kind: 'consent', hello, policyVersion: policy });
          return;
        }
        resume(hello, entry);
      },
      (error: unknown) => {
        if (!alive) return;
        const code = errorCodeOf(error);
        if (code === 'E_AUTH' || code === 'E_FORBIDDEN') {
          // 지워진 방도 `E_AUTH`로 온다: 방 조회로 확인한 뒤 지운다(검토 B04).
          void settleInvalidStudentToken(deps, entry)
            .catch(() => 'revoked' as const)
            .then(result => {
              if (!alive) return;
              if (result === 'gone') {
                setPhase({ kind: 'gone' });
                return;
              }
              onForget();
              setPhase({ kind: 'forgotten' });
            });
          return;
        }
        if (code === 'E_ROOM_NOT_FOUND' || code === 'E_ROOM_EXPIRED') {
          void purgeRoomOnDevice(deps, entry.roomId).catch(() => {});
          setPhase({ kind: 'gone' });
          return;
        }
        if (isConnectionError(code) && entry.lastDocId) {
          setPhase({ kind: 'go', to: 'write', docId: entry.lastDocId });
          return;
        }
        setPhase({ kind: 'error', code });
      },
    );
    return () => {
      alive = false;
      offState();
    };
    // `attempt`: 다시 하기
  }, [deps, entry, open, onForget, resume, attempt]);

  const agree = useCallback(async () => {
    const student = studentRef.current;
    if (phase.kind !== 'consent' || !entry || !student) return;
    setAgreeing(true);
    consentCommand.current ??= deps.newId();
    try {
      await updateConsent(student.channel, phase.policyVersion, consentCommand.current);
      consentCommand.current = null;
      resume(phase.hello, entry);
    } catch (error) {
      setPhase({ kind: 'error', code: errorCodeOf(error) });
    } finally {
      setAgreeing(false);
    }
  }, [deps, entry, phase, resume]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);

  return { phase, agree, agreeing, retry };
}
