import type { ErrorCode } from '@geulbang/core/errors';
import { useEffect, useState } from 'react';
import type { AppDeps } from '../../../application/deps.ts';
import { openDoc, type StudentSession } from '../../../application/openWriting.ts';
import type { StudentRoomMemory } from '../../../ports/deviceMemory.ts';
import type { SyncedDoc } from '../../../ports/realtime.ts';
import { errorCodeOf } from '../errorCode.ts';

/**
 * 학생 글 하나를 연다(`openDoc`: 기기 사본을 먼저 넣고 붙인다, 연결 없이도 바로 쓴다). 화면을 떠나면 닫는다.
 * 여는 도중 떠나면 다 열린 뒤 바로 닫는다(같은 글 제공자가 둘 남지 않게).
 */
export function useStudentDoc(
  deps: Pick<AppDeps, 'localStore'>,
  student: StudentSession | null,
  entry: Pick<StudentRoomMemory, 'roomId' | 'expiresAt'>,
  docId: string,
): { readonly doc: SyncedDoc | null; readonly error: ErrorCode | null } {
  const [doc, setDoc] = useState<SyncedDoc | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const { roomId, expiresAt } = entry;

  useEffect(() => {
    if (!student) return;
    let alive = true;
    let opened: SyncedDoc | null = null;
    setError(null);
    openDoc(deps, student, { roomId, expiresAt }, docId).then(
      d => {
        if (!alive) {
          d.close();
          return;
        }
        opened = d;
        setDoc(d);
      },
      (e: unknown) => alive && setError(errorCodeOf(e)),
    );
    return () => {
      alive = false;
      opened?.close();
      setDoc(null);
    };
  }, [deps, student, roomId, expiresAt, docId]);

  return { doc, error };
}
