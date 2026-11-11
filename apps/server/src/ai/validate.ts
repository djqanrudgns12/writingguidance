import { AiCallError } from './port.ts';
import { LIMITS, type DirectionResult, type FeedbackResult, type SpellResult } from './schemas.ts';

/**
 * 받은 결과 다듬기(PLAN §8.5, PRD 6.3 "걸러내기").
 * - 길이 한도를 20% 안으로 넘으면 문장 경계에서 자르고, 더 넘으면 형식 오류(재시도 대상).
 * - 구조가 틀렸을 때만 재시도한다. 개수가 많으면 앞에서부터 쓴다.
 */
const TOLERANCE = 1.2;

/** 코드 포인트 기준 길이 */
const len = (s: string) => [...s].length;

/** 한도를 조금 넘으면 문장 경계(마침표·물음표·느낌표 뒤)나 마지막 띄어쓰기에서 자른다. 많이 넘으면 null. */
export function fitLength(text: string, max: number): string | null {
  const t = text.trim();
  if (len(t) <= max) return t;
  if (len(t) > Math.ceil(max * TOLERANCE)) return null;
  const chars = [...t].slice(0, max);
  const head = chars.join('');
  const sentenceEnd = Math.max(
    head.lastIndexOf('.'),
    head.lastIndexOf('?'),
    head.lastIndexOf('!'),
    head.lastIndexOf('요'),
  );
  if (sentenceEnd >= Math.floor(head.length / 2)) return head.slice(0, sentenceEnd + 1);
  const space = head.lastIndexOf(' ');
  return space > 0 ? head.slice(0, space) : head;
}

const mustFit = (text: string, max: number): string => {
  const fitted = fitLength(text, max);
  if (fitted === null || fitted.length === 0) throw new AiCallError('format', 'length');
  return fitted;
};

const optionalFit = (text: string | undefined, max: number): string | undefined => {
  if (text === undefined) return undefined;
  const fitted = fitLength(text, max);
  return fitted && fitted.length > 0 ? fitted : undefined;
};

/** 맞춤법: 글에 없는 `original`, 고친 것과 같은 것, 겹치는 위치는 버린다. 30개 넘으면 앞 30개. */
export function cleanSpell(result: SpellResult, text: string): SpellResult {
  const taken: { start: number; end: number }[] = [];
  const items: SpellResult['items'] = [];
  for (const item of result.items) {
    if (items.length >= LIMITS.spellItems) break;
    if (item.original === item.suggestion) continue;
    const at = findFree(text, item.original, item.context.before, taken);
    if (at < 0) continue;
    taken.push({ start: at, end: at + item.original.length });
    items.push({
      ...item,
      reason:
        fitLength(item.reason, LIMITS.spellReason) ?? [...item.reason].slice(0, LIMITS.spellReason).join(''),
      context: {
        before: [...item.context.before].slice(-LIMITS.spellContext).join(''),
        after: [...item.context.after].slice(0, LIMITS.spellContext).join(''),
      },
    });
  }
  return { items };
}

/** `original`이 있는 자리 중 이미 쓴 자리와 겹치지 않는 첫 곳. 앞 글자가 맞는 곳을 먼저 본다. */
function findFree(
  text: string,
  original: string,
  before: string,
  taken: { start: number; end: number }[],
): number {
  const free = (at: number) => taken.every(t => at + original.length <= t.start || at >= t.end);
  const candidates: number[] = [];
  for (let at = text.indexOf(original); at >= 0; at = text.indexOf(original, at + 1)) candidates.push(at);
  const preferred = candidates.filter(
    at => before.length > 0 && text.slice(Math.max(0, at - before.length), at) === before,
  );
  for (const at of [...preferred, ...candidates]) if (free(at)) return at;
  return -1;
}

export function cleanFeedback(result: FeedbackResult): FeedbackResult {
  if (result.improve.length < LIMITS.improveMin) throw new AiCallError('format', 'improve');
  const out: FeedbackResult = {
    praise: mustFit(result.praise, LIMITS.praise),
    improve: result.improve.slice(0, LIMITS.improveMax).map(s => mustFit(s, LIMITS.improve)),
  };
  const factCheck = optionalFit(result.factCheck, LIMITS.note);
  const eraNote = optionalFit(result.eraNote, LIMITS.note);
  const softenNote = optionalFit(result.softenNote, LIMITS.note);
  return {
    ...out,
    ...(factCheck ? { factCheck } : {}),
    ...(eraNote ? { eraNote } : {}),
    ...(softenNote ? { softenNote } : {}),
  };
}

export function cleanDirection(result: DirectionResult): DirectionResult {
  if (result.ideas.length < LIMITS.ideasMin) throw new AiCallError('format', 'ideas');
  return {
    ideas: result.ideas.slice(0, LIMITS.ideasMax).map(i => ({
      text: mustFit(i.text, LIMITS.idea),
      ...(i.label ? { label: [...i.label].slice(0, 12).join('') } : {}),
    })),
  };
}

/** 다듬은 글 첫 줄이 "다듬은 글:" 같은 머리말이면 떼어 낸다(PLAN §8.5). 기기와 서버 모두 쓴다. */
export function stripPolishPreamble(text: string): string {
  return text.replace(/^\s*(?:다듬은\s*글|고친\s*글)\s*[:：]\s*\n?/, '');
}
