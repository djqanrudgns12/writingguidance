/**
 * 대사·속마음 범위(docs/ai-harness.md 5절 서버 보정 1). LLM 판단을 믿지 않고 원문에서 직접 계산한다.
 * - 따옴표 쌍: “…” ‘…’ "…" '…' 「…」 『…』 (줄을 넘지 않는 짝만)
 * - 대본·웹툰·만화 줄: 줄 머리의 `이름:` / `이름 :` 뒤(장면 설명 `장면:`·`해설:`·`지문:`은 제외)
 */
export interface Range {
  readonly start: number;
  readonly end: number;
}

const PAIRS: readonly (readonly [string, string])[] = [
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
];

const NARRATION_LABELS = new Set(['장면', '해설', '지문', '배경', '설명', '나레이션', '내레이션']);

export function dialogueRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    collectQuoted(line, offset, ranges);
    const speaker = /^\s*([^\s:：]{1,12})\s*[:：]\s*/.exec(line);
    if (speaker && speaker[1] && !NARRATION_LABELS.has(speaker[1])) {
      ranges.push({ start: offset + speaker[0].length, end: offset + line.length });
    }
    offset += line.length + 1;
  }
  return ranges;
}

function collectQuoted(line: string, offset: number, out: Range[]): void {
  for (const [open, close] of PAIRS) {
    let from = 0;
    for (;;) {
      const a = line.indexOf(open, from);
      if (a < 0) break;
      const b = line.indexOf(close, a + 1);
      if (b < 0) break;
      out.push({ start: offset + a, end: offset + b + 1 });
      from = b + 1;
    }
  }
  // 곧은따옴표는 여는 것과 닫는 것이 같아 차례로 짝짓는다(홀수 개면 마지막 하나는 버림).
  for (const q of ['"', "'"]) {
    const at: number[] = [];
    for (let i = line.indexOf(q); i >= 0; i = line.indexOf(q, i + 1)) at.push(i);
    for (let k = 0; k + 1 < at.length; k += 2) {
      const a = at[k];
      const b = at[k + 1];
      if (a !== undefined && b !== undefined) out.push({ start: offset + a, end: offset + b + 1 });
    }
  }
}

export const inside = (ranges: readonly Range[], start: number, end: number): boolean =>
  ranges.some(r => start >= r.start && end <= r.end);
