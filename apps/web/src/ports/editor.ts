import type * as Y from 'yjs';
import type { Unsubscribe } from './observable.ts';
import type { SyncedDoc } from './realtime.ts';

/**
 * 편집기 포트(PLAN §2.5·§6.3). 화면은 이것만 안다. 지금 구현은 기본 입력칸 + 한글 반영 문(`adapters/editor`),
 * 실기기 관문이 실패하면 같은 포트 뒤에서 CodeMirror 6 어댑터로 바꾼다(PRD 9.3 차선책).
 */
export interface TextRange {
  /** 어느 칸인가: 본문·제목·메모(도움 질문 ID) */
  readonly field: 'body' | 'title' | { readonly memo: string };
  readonly start: number;
  readonly end: number;
  readonly direction?: 'forward' | 'backward' | 'none';
}

export interface EditorOptions {
  readonly role: 'student' | 'teacher';
  readonly readOnly: boolean;
  /** 되돌리기 묶음 시간(`UNDO_GROUP_MS` 중 하나) */
  readonly undoGroupMs: number;
  /** 진단 기록(PRD 13.2): `/dev/editor`는 늘 켜고, 쓰기 화면은 서버가 보낸 값을 따른다. */
  readonly diagnosticsEnabled: boolean;
}

export interface EditorFields {
  readonly body: HTMLTextAreaElement;
  readonly title?: HTMLInputElement;
  readonly memos?: ReadonlyMap<string, HTMLTextAreaElement>;
  /** 입력칸 뒤 거울 층(형광·원격 커서) */
  readonly mirror?: HTMLElement;
}

export interface EditorPort {
  mount(fields: EditorFields, doc: SyncedDoc, options: EditorOptions): EditorBinding;
}

export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface EditorBinding {
  readonly viewDoc: Y.Doc;
  /** 반영 문 조건을 지킨 뒤 선택한다(맞춤법 항목 누름). */
  select(range: TextRange): Promise<void>;
  /** 거울 층에만 그린다. */
  highlight(ranges: readonly TextRange[]): void;
  /** 구조 버튼·복원·되살리기처럼 앱이 하는 변경. 조합 중이 아닐 때 한 번에 적용한다. */
  applyAppEdit(edit: (doc: Y.Doc) => void): Promise<void>;
  /** 문이 열릴 때 적용한다. */
  setReadOnly(on: boolean): void;
  undo(): void;
  redo(): void;
  /** 되돌리기·다시 하기 단추를 켤지(PRD F-13). 내 입력 기록이 바뀔 때마다 알린다. */
  historyState(): HistoryState;
  onHistoryChange(listener: (state: HistoryState) => void): Unsubscribe;
  onLargeDelete(listener: (removed: number) => void): Unsubscribe;
  /** "선생님이 고친 곳은 잠시 뒤 보여요" */
  onHoldChange(listener: (holding: boolean) => void): Unsubscribe;
  /** 글자 크기·글꼴·배치가 바뀌었을 때 거울 층을 다시 맞춘다(PRD F-13). */
  syncLayout(): void;
  /** 도움 질문 메모 칸을 동적으로 붙이고 뗀다(PRD F-07). */
  bindMemo(id: string, el: HTMLTextAreaElement): Unsubscribe;
  destroy(): void;
}
