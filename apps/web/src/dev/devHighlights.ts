import type { TextRange } from '../ports/editor.ts';

/**
 * 거울 층 정렬 확인용 형광 범위를 본문에서 고른다(PLAN §11.5 P2-4).
 * 첫 줄부터 30줄 너머 끝 줄까지 고르게 어절을 골라 스크롤·글자 크기 변경 시 줄 맞춤이 어긋나는지 한눈에 보게 한다.
 */
export function computeAlignmentHighlights(bodyText: string): TextRange[] {
  if (bodyText.length === 0) return [];

  const ranges: TextRange[] = [];
  const lines = bodyText.split('\n');
  let offset = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? '';
    const shouldMark =
      lines.length <= 4 || lineIdx === 0 || lineIdx === lines.length - 1 || lineIdx % 3 === 2;

    if (shouldMark && line.length > 0) {
      const words = [...line.matchAll(/\S+/g)];
      if (words.length > 0) {
        // 줄마다 가운데 쪽 어절을 골라 가로·세로 정렬을 함께 본다.
        const picked = words[Math.floor(words.length / 2)]!;
        const start = offset + (picked.index ?? 0);
        const end = start + picked[0].length;
        if (end > start) {
          ranges.push({ field: 'body', start, end });
        }
      }
    }

    offset += line.length + 1;
  }

  // 공백만 있는 글이더라도 최소 한 구간은 잡히게 보강한다.
  if (ranges.length === 0) {
    ranges.push({ field: 'body', start: 0, end: Math.min(bodyText.length, 4) });
  }

  return ranges;
}
