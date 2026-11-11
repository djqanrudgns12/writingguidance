import { DOC_KEYS, DOC_META_KEYS, HELP_QUESTION_IDS, HELP_QUESTIONS } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import type { ErrorCode } from '@geulbang/core/errors';
import { useEffect, useRef, useState, type RefObject } from 'react';
import * as Y from 'yjs';
import { mountEditor, type MountedEditor } from '../../../adapters/editor/editor.ts';
import { openDocForRoom } from '../../../application/openWriting.ts';
import type { TeacherSession } from '../../../application/teacher.ts';
import type { Unsubscribe } from '../../../ports/observable.ts';
import type { DrawerMemo } from '../../../ui/screens/teacher/index.ts';
import { useAppDeps } from '../../providers.tsx';
import { errorCodeOf } from '../errors.ts';

export interface DrawerDocText {
  readonly title: string;
  readonly body: string;
  readonly meta: Readonly<Record<string, string | null>>;
}

export interface StudentDrawerHandle {
  readonly titleRef: RefObject<HTMLInputElement | null>;
  readonly bodyRef: RefObject<HTMLTextAreaElement | null>;
  readonly mirrorRef: RefObject<HTMLDivElement | null>;
  /** 제공자를 붙이고 편집기를 올리는 중 */
  readonly loading: boolean;
  /** 교사가 한글을 치는 동안 학생 변경을 보류 중(PRD F-18) */
  readonly holding: boolean;
  readonly memos: readonly DrawerMemo[];
  readonly failure: ErrorCode | null;
  /** 편집기가 올라가 있으면 그 바인딩(되돌리기·복원·복사) */
  readonly binding: () => MountedEditor | null;
  /** 지금 편집용 문서의 제목·본문·메타(복사용) */
  readonly readText: () => DrawerDocText | null;
}

/** 도움 질문 메모(읽기 전용, PRD F-18): 통신용 문서의 `memo` 맵에서 빈 칸을 뺀 것, 질문 목록 순서. */
export function readDrawerMemos(netDoc: Y.Doc): DrawerMemo[] {
  const memo = netDoc.getMap<unknown>(DOC_KEYS.memo);
  const items: DrawerMemo[] = [];
  for (const id of HELP_QUESTION_IDS) {
    const value = memo.get(id);
    const note = value instanceof Y.Text ? value.toString() : typeof value === 'string' ? value : '';
    if (note.trim().length === 0) continue;
    items.push({ questionId: id, question: ko.student[HELP_QUESTIONS[id].promptKey], note });
  }
  return items;
}

function readMeta(doc: Y.Doc): Record<string, string | null> {
  const meta = doc.getMap<unknown>(DOC_KEYS.meta);
  const out: Record<string, string | null> = {};
  for (const key of Object.values(DOC_META_KEYS)) {
    const v = meta.get(key);
    out[key] = typeof v === 'string' ? v : null;
  }
  return out;
}

/**
 * T4 서랍(PLAN §2.3 ⑧, §6.3 교사 서랍): 그 글을 같은 연결 위 제공자로 열고 학생과 같은 편집기(교사 모드)를 붙인다.
 * 서랍을 닫거나 다른 글로 바꾸면 편집기를 떼고 제공자를 닫는다. 입력칸은 화면(`StudentDrawerView`)이 비제어로 그리고
 * 이 훅은 ref로만 넘긴다(반영 문이 닫혀 있는 동안 화면이 값·선택·초점을 건드리지 않게).
 */
export function useStudentDrawer(
  teacher: TeacherSession | null,
  docId: string,
  room: { readonly roomId: string; readonly expiresAt: number },
): StudentDrawerHandle {
  const deps = useAppDeps();
  const titleRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<MountedEditor | null>(null);
  const [loading, setLoading] = useState(true);
  const [holding, setHolding] = useState(false);
  const [memos, setMemos] = useState<readonly DrawerMemo[]>([]);
  const [failure, setFailure] = useState<ErrorCode | null>(null);
  const { roomId, expiresAt } = room;

  useEffect(() => {
    if (!teacher) return;
    let cancelled = false;
    let closeDoc: (() => void) | null = null;
    let binding: MountedEditor | null = null;
    const cleanups: Unsubscribe[] = [];
    setLoading(true);
    setFailure(null);

    openDocForRoom(deps, teacher.session, docId, roomId, expiresAt).then(
      doc => {
        if (cancelled) {
          doc.close();
          return;
        }
        closeDoc = () => doc.close();
        const body = bodyRef.current;
        if (!body) {
          setFailure('E_INTERNAL');
          setLoading(false);
          return;
        }
        const title = titleRef.current;
        const mirror = mirrorRef.current;
        binding = mountEditor(
          { body, ...(title ? { title } : {}), ...(mirror ? { mirror } : {}) },
          doc,
          {
            role: 'teacher',
            readOnly: doc.locked.get(),
            undoGroupMs: deps.config.UNDO_GROUP_MS.normal,
            diagnosticsEnabled: false,
          },
          { config: deps.config },
        );
        bindingRef.current = binding;
        const mounted = binding;
        cleanups.push(doc.locked.subscribe(locked => mounted.setReadOnly(locked)));
        cleanups.push(mounted.onHoldChange(setHolding));
        setFailure(doc.failure.get());
        cleanups.push(doc.failure.subscribe(setFailure));
        const refreshMemos = () => setMemos(readDrawerMemos(doc.netDoc));
        refreshMemos();
        doc.netDoc.on('update', refreshMemos);
        cleanups.push(() => doc.netDoc.off('update', refreshMemos));
        mounted.syncLayout();
        setLoading(false);
      },
      (error: unknown) => {
        if (cancelled) return;
        setFailure(errorCodeOf(error));
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
      for (const cleanup of cleanups) cleanup();
      binding?.destroy();
      bindingRef.current = null;
      closeDoc?.();
      setHolding(false);
    };
  }, [deps, teacher, docId, roomId, expiresAt]);

  const readText = (): DrawerDocText | null => {
    const binding = bindingRef.current;
    if (!binding) return null;
    const { viewDoc } = binding;
    return {
      title: viewDoc.getText(DOC_KEYS.title).toString(),
      body: viewDoc.getText(DOC_KEYS.body).toString(),
      meta: readMeta(viewDoc),
    };
  };

  return {
    titleRef,
    bodyRef,
    mirrorRef,
    loading,
    holding,
    memos,
    failure,
    binding: () => bindingRef.current,
    readText,
  };
}
