/**
 * 되돌리기 키 가로채기(PRD 9.3-12, PLAN §6.3 `keys.ts`). 브라우저 기본 되돌리기는 입력칸 값을 통째로 바꿔
 * 동시 편집을 깨므로 막고 Yjs 되돌리기(내 입력만)로 처리한다. 조합 중에는 아무것도 하지 않는다.
 * Enter·Backspace는 가로채지 않는다(PRD 9.3-11).
 */
export type HistoryAction = 'undo' | 'redo';

export function historyActionFromKey(e: KeyboardEvent): HistoryAction | null {
  if (e.isComposing || e.altKey) return null;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && e.ctrlKey && !e.metaKey) return 'redo';
  return null;
}

/** iPad 흔들기·키보드 되돌리기 단추 등은 `beforeinput`의 historyUndo/historyRedo로 온다. */
export function historyActionFromInput(e: InputEvent): HistoryAction | null {
  if (e.isComposing) return null;
  if (e.inputType === 'historyUndo') return 'undo';
  if (e.inputType === 'historyRedo') return 'redo';
  return null;
}
