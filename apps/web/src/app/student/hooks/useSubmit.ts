import { MS_PER_SECOND, type DocStatus } from '@geulbang/core';
import type { ErrorCode } from '@geulbang/core/errors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { submitDoc, trackDocs } from '../../../application/submitDoc.ts';
import type { EditorBinding } from '../../../ports/editor.ts';
import type { CommandError, RoomChannel, SyncedDoc } from '../../../ports/realtime.ts';
import type { WriteSubmission } from '../../../ui/screens/student/write/types.ts';
import { errorCodeOf } from '../errorCode.ts';

/**
 * 제출(PRD F-11, PLAN §2.3 ⑥): 확인 → 쓰던 입력 기록(반영 문이 연 뒤, `applyAppEdit` 빈 편집) → 편집 잠금
 * → `submitDoc`(기기 저장 기다림 → 대기열) → 대기열 결과 → 도장 → `제출 완료`.
 * - 오프라인이면 대기열이 기다렸다 보낸다: 그동안 `제출 대기`.
 * - `E_STALE`(교사가 다시 열어 준 뒤 도착한 옛 제출): 조용히 다시 쓰기 상태로 돌린다.
 * - 그 밖의 거절: 잠금을 풀고 한 줄 알린다.
 */
export interface SubmitState {
  readonly submission: WriteSubmission;
  /** 제출 중이라 입력칸을 잠가 둔다(서버 잠금이 오기 전에도) */
  readonly lockForSubmit: boolean;
  readonly submitting: boolean;
  readonly stampVisible: boolean;
  submit(): Promise<void>;
}

type Result = { readonly ok: boolean; readonly error?: CommandError };

export function useSubmit(args: {
  readonly channel: RoomChannel | null;
  readonly doc: SyncedDoc;
  readonly binding: EditorBinding | null;
  /** 서버가 잠근 글(제출·닫힘, `doc.locked`) */
  readonly locked: boolean;
  /** 수업방 닫힘도 서버 잠금이라, 닫힘이면 잠금을 제출로 보지 않는다 */
  readonly roomClosed: boolean;
  readonly docStatus: DocStatus | null;
  readonly onError: (code: ErrorCode) => void;
}): SubmitState {
  const { channel, doc, binding, locked, roomClosed, docStatus, onError } = args;
  const [pending, setPending] = useState<string | null>(null);
  const [lockForSubmit, setLockForSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedHere, setSubmittedHere] = useState(false);
  const [stampVisible, setStampVisible] = useState(false);
  const results = useRef(new Map<string, Result>());
  const pendingRef = useRef<string | null>(null);
  const tracker = useRef<ReturnType<typeof trackDocs> | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const stampTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const settle = useCallback((commandId: string, r: Result) => {
    if (pendingRef.current !== commandId) return;
    pendingRef.current = null;
    setPending(null);
    if (r.ok) {
      // 잠금은 이제 `제출 완료`(submission)와 서버 잠금이 잇는다.
      setLockForSubmit(false);
      setSubmittedHere(true);
      setStampVisible(true);
      clearTimeout(stampTimer.current);
      // 도장은 한 번 찍히고 1초 안에 사라진다(PRD F-11).
      stampTimer.current = setTimeout(() => setStampVisible(false), MS_PER_SECOND);
      return;
    }
    setLockForSubmit(false);
    const code = r.error?.code ?? 'E_INTERNAL';
    if (code !== 'E_STALE') onErrorRef.current(code);
  }, []);

  useEffect(() => {
    if (!channel) return;
    tracker.current = trackDocs(channel);
    const off = channel.queue.onResult(r => {
      const result: Result = { ok: r.ok, ...(r.error ? { error: r.error } : {}) };
      results.current.set(r.commandId, result);
      settle(r.commandId, result);
    });
    // 새로고침 전에 넣어 둔 제출이 아직 남아 있으면 이어서 기다린다(`제출 대기`).
    let alive = true;
    void channel.queue.pending().then(
      list => {
        const mine = list.find(p => p.docId === doc.docId);
        if (!alive || !mine || pendingRef.current) return;
        pendingRef.current = mine.commandId;
        setPending(mine.commandId);
        setLockForSubmit(true);
      },
      () => {},
    );
    return () => {
      alive = false;
      off();
      tracker.current?.close();
      tracker.current = null;
    };
  }, [channel, doc.docId, settle]);

  useEffect(() => () => clearTimeout(stampTimer.current), []);

  // 교사가 `다시 쓰게 하기`를 누르면 다시 쓸 수 있다.
  useEffect(() => {
    if (docStatus === 'REOPENED' || docStatus === 'DRAFT') setSubmittedHere(false);
  }, [docStatus]);

  const submit = useCallback(async () => {
    if (!channel || !binding || submitting || pendingRef.current) return;
    setSubmitting(true);
    try {
      // 쓰던 한글 입력을 먼저 기록한다(반영 문이 열린 뒤, 빈 앱 편집이 기록만 한다).
      await binding.applyAppEdit(() => {});
      setLockForSubmit(true);
      const generation = tracker.current?.get(doc.docId)?.generation ?? 0;
      const commandId = await submitDoc(channel, doc, generation);
      pendingRef.current = commandId;
      setPending(commandId);
      // 대기열이 넣자마자 보내 결과가 먼저 왔을 수 있다.
      const early = results.current.get(commandId);
      if (early) settle(commandId, early);
    } catch (error) {
      setLockForSubmit(false);
      onErrorRef.current(errorCodeOf(error));
    } finally {
      setSubmitting(false);
    }
  }, [binding, channel, doc, settle, submitting]);

  const submitted = (locked && !roomClosed) || docStatus === 'SUBMITTED' || submittedHere;
  const submission: WriteSubmission = pending ? 'pending' : submitted ? 'submitted' : 'none';
  return { submission, lockForSubmit, submitting, stampVisible, submit };
}
