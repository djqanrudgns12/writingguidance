import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { mountEditor } from '../../../adapters/editor/editor.ts';
import type { AppDeps } from '../../../application/deps.ts';
import type { EditorBinding } from '../../../ports/editor.ts';
import type { Unsubscribe } from '../../../ports/observable.ts';
import type { SyncedDoc } from '../../../ports/realtime.ts';

/**
 * 쓰기 화면의 편집기 바인딩(PLAN §6.3). 입력칸 값·선택·초점·`readOnly`는 바인딩만 다룬다: 이 훅은 비제어 입력칸
 * ref를 넘겨 붙이고(학생 모드), 도움 질문 메모 칸이 붙고 떨어질 때 `bindMemo`로 잇기만 한다.
 */
export interface EditorFieldsRefs {
  readonly body: RefObject<HTMLTextAreaElement | null>;
  readonly title: RefObject<HTMLInputElement | null>;
  readonly mirror: RefObject<HTMLDivElement | null>;
}

export interface EditorHandle {
  readonly binding: EditorBinding | null;
  /** `WriteView.memoRef`: 메모 칸이 생기면 바인딩에 붙이고, 사라지면 뗀다. */
  memoRef(questionId: string, el: HTMLTextAreaElement | null): void;
}

export function useEditorBinding(
  deps: Pick<AppDeps, 'config'>,
  doc: SyncedDoc,
  refs: EditorFieldsRefs,
  diagnosticsEnabled: boolean,
): EditorHandle {
  const [binding, setBinding] = useState<EditorBinding | null>(null);
  const bindingRef = useRef<EditorBinding | null>(null);
  const memoEls = useRef(new Map<string, HTMLTextAreaElement>());
  const memoUnbind = useRef(new Map<string, Unsubscribe>());
  const diagnostics = useRef(diagnosticsEnabled);

  // 입력칸이 그려진 뒤 같은 작업 안에서 붙인다(사용자가 치기 전에 바인딩이 값을 맞춘다).
  useLayoutEffect(() => {
    const body = refs.body.current;
    if (!body) return;
    const b = mountEditor(
      {
        body,
        ...(refs.title.current ? { title: refs.title.current } : {}),
        ...(refs.mirror.current ? { mirror: refs.mirror.current } : {}),
      },
      doc,
      {
        role: 'student',
        readOnly: false,
        undoGroupMs: deps.config.UNDO_GROUP_MS.normal,
        diagnosticsEnabled: diagnostics.current,
      },
      { config: deps.config },
    );
    bindingRef.current = b;
    for (const [id, el] of memoEls.current) memoUnbind.current.set(id, b.bindMemo(id, el));
    setBinding(b);
    return () => {
      for (const off of memoUnbind.current.values()) off();
      memoUnbind.current.clear();
      bindingRef.current = null;
      b.destroy();
      setBinding(null);
    };
  }, [deps.config, doc, refs]);

  const memoRef = useCallback((questionId: string, el: HTMLTextAreaElement | null) => {
    memoUnbind.current.get(questionId)?.();
    memoUnbind.current.delete(questionId);
    if (!el) {
      memoEls.current.delete(questionId);
      return;
    }
    memoEls.current.set(questionId, el);
    const b = bindingRef.current;
    if (b) memoUnbind.current.set(questionId, b.bindMemo(questionId, el));
  }, []);

  return { binding, memoRef };
}
