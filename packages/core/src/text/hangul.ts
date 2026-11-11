/**
 * 한글 판정(PLAN §6.3 `isHangul`). 반영 문이 "커서 앞 글자가 한글이면 아직 조합 중일 수 있다"를 판단할 때 쓴다.
 * 위치는 모두 UTF-16 코드 단위(`textarea.selectionStart`, `Y.Text` 위치와 같은 단위).
 */

/** 완성형(AC00–D7A3), 첫가끝 자모(1100–11FF, A960–A97F, D7B0–D7FF), 호환 자모(3130–318F) */
export function isHangulCodePoint(cp: number): boolean {
  return (
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xd7b0 && cp <= 0xd7ff) ||
    (cp >= 0x3130 && cp <= 0x318f)
  );
}

/** 첫 코드 포인트가 한글인가. 빈 문자열은 false. */
export function isHangul(ch: string): boolean {
  const cp = ch.codePointAt(0);
  return cp !== undefined && isHangulCodePoint(cp);
}

/** `index` 바로 앞 코드 포인트(서로게이트 쌍은 하나로). `index`가 0이거나 범위 밖이면 undefined. */
export function codePointBefore(text: string, index: number): number | undefined {
  if (!Number.isInteger(index) || index <= 0 || index > text.length) return undefined;
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
  }
  return low;
}
