import { outerChangedRange } from './diff.ts';

/**
 * 맞춤법 항목의 위치 찾기(PLAN §8.6, PRD 6.3). 모델이 내는 글자 위치는 거의 맞지 않아서 화면이 직접 찾는다.
 * 1. 요청할 때의 글에서 항목 자리(앞뒤 글자가 맞는 곳)를 찾고, 그 뒤 바뀐 만큼 지금 글의 예상 위치로 옮긴다.
 * 2. 지금 글에서 `앞 + original + 뒤`가 맞는 곳 → 여러 개면 예상 위치에 가까운 것.
 * 3. 없으면 `original`만 맞는 곳 중 가까운 것. 그래도 없으면 null(목록에는 보이되 누를 수 없음).
 * 위치는 UTF-16 단위(입력칸 `selectionStart`와 같은 단위).
 */
export interface SpellTarget {
  readonly original: string;
  readonly context: { readonly before: string; readonly after: string };
}

export interface Located {
  readonly start: number;
  readonly end: number;
}

function allIndexes(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const out: number[] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) out.push(at);
  return out;
}

/** 앞뒤 글자까지 맞는 `original` 시작 위치들 */
function withContext(text: string, t: SpellTarget): number[] {
  const whole = t.context.before + t.original + t.context.after;
  return allIndexes(text, whole).map(at => at + t.context.before.length);
}

/** 요청 때 글의 위치를 지금 글의 위치로 옮긴다(바뀐 범위 앞은 그대로, 뒤는 길이 차이만큼). */
export function mapPosition(before: string, after: string, at: number): number {
  const r = outerChangedRange(before, after);
  if (!r) return at;
  if (at <= r.start) return at;
  if (at >= r.endOld) return at + (r.endNew - r.endOld);
  return r.start; // 바뀐 곳 안이면 바뀐 곳 시작
}

const nearest = (candidates: readonly number[], expected: number): number | undefined =>
  [...candidates].sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected) || a - b)[0];

export function locateSpell(
  requestText: string,
  currentText: string,
  target: SpellTarget,
  hint?: number,
): Located | null {
  const fromRequest = withContext(requestText, target);
  const requestAt = nearest(
    fromRequest.length > 0 ? fromRequest : allIndexes(requestText, target.original),
    hint ?? 0,
  );
  const expected = requestAt === undefined ? (hint ?? 0) : mapPosition(requestText, currentText, requestAt);
  const exact = withContext(currentText, target);
  const pick = nearest(exact.length > 0 ? exact : allIndexes(currentText, target.original), expected);
  if (pick === undefined) return null;
  return { start: pick, end: pick + target.original.length };
}

/**
 * 같은 결과의 여러 항목을 한꺼번에: 앞 항목이 차지한 자리는 다음 항목이 다시 고르지 않는다
 * (같은 실수가 여러 번 나온 경우 각각 다른 자리로).
 */
export function locateAll(
  requestText: string,
  currentText: string,
  targets: readonly SpellTarget[],
): (Located | null)[] {
  const taken: Located[] = [];
  const free = (l: Located) => taken.every(t => l.end <= t.start || l.start >= t.end);
  return targets.map(target => {
    const exact = withContext(currentText, target).map(start => ({
      start,
      end: start + target.original.length,
    }));
    const loose = allIndexes(currentText, target.original).map(start => ({
      start,
      end: start + target.original.length,
    }));
    const first = locateSpell(requestText, currentText, target);
    const expected = first?.start ?? 0;
    const pool = [...exact, ...loose].filter(free);
    const best = pool.sort(
      (a, b) =>
        Number(!exact.some(e => e.start === a.start)) - Number(!exact.some(e => e.start === b.start)) ||
        Math.abs(a.start - expected) - Math.abs(b.start - expected),
    )[0];
    if (!best) return null;
    taken.push(best);
    return best;
  });
}
