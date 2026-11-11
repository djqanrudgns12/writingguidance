/**
 * 글 차이 계산(PLAN §6.3). 위치는 UTF-16 코드 단위.
 * - `diffForInput`: `input` 이벤트 한 번의 차이(내 입력 기록). 입력 종류(`inputType`)는 추측하지 않고 값만 비교한다.
 * - `outerChangedRange`: 원격 반영 때 입력칸에서 고칠 가장 바깥 범위 하나(`setRangeText`).
 * 경계는 서로게이트 쌍 가운데를 가르지 않는다.
 */

export interface TextChange {
  readonly index: number;
  readonly deleteCount: number;
  readonly insert: string;
}

export interface ChangedRange {
  readonly start: number;
  /** `prev`에서 바뀐 범위 끝(포함하지 않음) */
  readonly endOld: number;
  /** `next`에서 바뀐 범위 끝(포함하지 않음) */
  readonly endNew: number;
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function commonSuffix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
  return i;
}

/** 앞 경계 p가 쌍을 가르면 한 칸 앞으로, 뒤 경계(길이 s)가 쌍을 가르면 한 칸 줄인다. */
function alignToCodePoints(prev: string, next: string, p: number, s: number): [number, number] {
  let start = p;
  while (start > 0 && (isHigh(prev.charCodeAt(start - 1)) || isHigh(next.charCodeAt(start - 1)))) start--;
  let suffix = s;
  while (
    suffix > 0 &&
    (isLow(prev.charCodeAt(prev.length - suffix)) || isLow(next.charCodeAt(next.length - suffix)))
  ) {
    suffix--;
  }
  return [start, suffix];
}

export function outerChangedRange(prev: string, next: string): ChangedRange | null {
  if (prev === next) return null;
  const p = commonPrefix(prev, next);
  const s = Math.min(commonSuffix(prev, next), Math.min(prev.length, next.length) - p);
  const [start, suffix] = alignToCodePoints(prev, next, p, s);
  return { start, endOld: prev.length - suffix, endNew: next.length - suffix };
}

/**
 * `caret`은 바뀐 뒤(`next`) 커서의 끝 위치(selectionEnd). 같은 글자가 이어져 바뀐 곳이 여러 가지로 풀리면
 * 바뀐 범위가 커서에서 끝나는 쪽을 고른다(예: "가가" → "가가가", 커서 1이면 맨 앞에 넣은 것).
 */
export function diffForInput(prev: string, next: string, caret: number): TextChange | null {
  if (prev === next) return null;
  const minLen = Math.min(prev.length, next.length);
  const maxPrefix = commonPrefix(prev, next);
  const maxSuffix = commonSuffix(prev, next);

  let p: number;
  let s: number;
  const suffixAtCaret = next.length - caret;
  if (Number.isInteger(caret) && caret >= 0 && caret <= next.length && suffixAtCaret <= maxSuffix) {
    s = Math.min(suffixAtCaret, minLen);
    p = Math.min(maxPrefix, minLen - s);
  } else {
    p = Math.min(maxPrefix, minLen);
    s = Math.min(maxSuffix, minLen - p);
  }
  const [start, suffix] = alignToCodePoints(prev, next, p, s);
  return {
    index: start,
    deleteCount: prev.length - suffix - start,
    insert: next.slice(start, next.length - suffix),
  };
}

export function applyChange(text: string, change: TextChange): string {
  return text.slice(0, change.index) + change.insert + text.slice(change.index + change.deleteCount);
}
