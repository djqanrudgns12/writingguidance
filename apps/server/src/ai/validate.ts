import { checkGenerated, endsPolitely } from './guard/outputGuard.ts';
import { actualKind, fallbackReason, withinEditBudget } from './guard/spellRules.ts';
import { AiCallError } from './port.ts';
import { LIMITS, type DirectionResult, type FeedbackResult, type SpellResult } from './schemas.ts';

/** 우리가 넣은 자리표시자(개인정보 `[전화번호1]`, 가린 비속어 `⟦가림1⟧`). 이것이 든 맞춤법 항목은 뺀다(S-08). */
export const PLACEHOLDER = /\[(?:전화번호|이메일|주민번호|주소)\d+\]|⟦가림\d+⟧/;

/** 응답 단위 규칙(G) 위반: 그 응답을 버리고 다시 묻는다(docs/ai-harness.md L4). */
function guard(text: string, source: string, speech: boolean): void {
  const rule = checkGenerated(text, { source, speech });
  if (rule) throw new AiCallError('unsafe', rule);
}

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

/**
 * 목록 항목(고칠 점·방향)용: 한도를 조금 넘어 잘린 결과가 해요체로 끝나지 않으면("…흐름이 더") 그 항목만 뺀다.
 * 잘린 말을 학생에게 보이지도, 그것 때문에 응답 전체를 버리지도 않는다(레드팀 평가에서 발견).
 */
const fitItem = (text: string, max: number): string | null => {
  const fitted = fitLength(text, max);
  if (fitted === null || fitted.length === 0) return null;
  if (fitted !== text.trim() && !endsPolitely(fitted)) return null;
  return fitted;
};

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

/**
 * 맞춤법(docs/ai-harness.md S-01~S-05·S-08): 항목 단위로 걸러 틀린 항목만 뺀다(응답 전체를 버리지 않음).
 * 글에 없는 `original`, 고친 것과 같은 것, 겹치는 위치, 자리표시자가 든 것, 문장을 새로 쓰는 수준의 바꿈은 뺀다.
 * 종류는 실제 변화로 다시 붙이고, 고친 말이 규칙을 어기면 빼고, 이유가 규칙을 어기면 종류별 기본 이유로 바꾼다.
 * 등급·근거는 원문 전체를 아는 쪽(`application/aiRequest.ts`)이 붙인다.
 */
export function cleanSpell(result: SpellResult, text: string): SpellResult {
  const taken: { start: number; end: number }[] = [];
  const items: SpellResult['items'] = [];
  for (const item of result.items) {
    if (items.length >= LIMITS.spellItems) break;
    if (PLACEHOLDER.test(item.original) || PLACEHOLDER.test(item.suggestion)) continue;
    const kind = actualKind(item.original, item.suggestion);
    if (!kind) continue;
    if (!withinEditBudget(item.original, item.suggestion)) continue;
    if (checkGenerated(item.suggestion, { source: text, speech: false })) continue;
    const at = findFree(text, item.original, item.context.before, taken);
    if (at < 0) continue;
    taken.push({ start: at, end: at + item.original.length });
    const fitted =
      fitLength(item.reason, LIMITS.spellReason) ?? [...item.reason].slice(0, LIMITS.spellReason).join('');
    const reason = checkGenerated(fitted, { source: text, speech: true }) ? fallbackReason(kind) : fitted;
    items.push({
      ...item,
      kind,
      reason,
      context: {
        before: [...item.context.before].slice(-LIMITS.spellContext).join(''),
        after: [...item.context.after].slice(0, LIMITS.spellContext).join(''),
      },
    });
  }
  return { items };
}

/** `original`이 있는 자리 중 이미 쓴 자리와 겹치지 않는 첫 곳. 앞 글자가 맞는 곳을 먼저 본다. */
export function findFree(
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

/**
 * 대신 써 주기·긴 인용(docs/ai-harness.md D-01·D-02): 화살표·"이렇게 써 보세요" 뒤의 긴 완성 문장, 원문 25자 이상 그대로 옮기기.
 */
const REWRITE = /(?:→|->|⇒|로 바꾸면|로 고치면|이렇게 써 ?보세요\s*[:：])\s*["'“‘]?([^"'”’]{18,})/;
function writesForStudent(s: string, source: string): boolean {
  if (REWRITE.test(s)) return true;
  const chars = [...s];
  for (let i = 0; i + 25 <= chars.length; i++) {
    if (source.includes(chars.slice(i, i + 25).join(''))) return true;
  }
  return false;
}

export function cleanFeedback(result: FeedbackResult, source = ''): FeedbackResult {
  const praise = fitItem(result.praise, LIMITS.praise);
  if (praise === null) throw new AiCallError('format', 'praise');
  guard(praise, source, true);
  const improve = result.improve
    .slice(0, LIMITS.improveMax + 1)
    .map(s => fitItem(s, LIMITS.improve))
    .filter((s): s is string => s !== null && !writesForStudent(s, source))
    .slice(0, LIMITS.improveMax);
  if (improve.length < LIMITS.improveMin) throw new AiCallError('format', 'improve');
  for (const s of improve) guard(s, source, true);
  const note = (t: string | undefined) => {
    const fitted = optionalFit(t, LIMITS.note);
    if (fitted) guard(fitted, source, true);
    return fitted;
  };
  const factCheck = note(result.factCheck);
  const eraNote = note(result.eraNote);
  const softenNote = note(result.softenNote);
  return {
    praise,
    improve,
    ...(factCheck ? { factCheck } : {}),
    ...(eraNote ? { eraNote } : {}),
    ...(softenNote ? { softenNote } : {}),
  };
}

/** 방향 이름표(D-03): 정해 둔 이름이거나 12자 이내 한글·띄어쓰기만. */
const LABEL_OK = /^[가-힣 ]{1,12}$/;

export function cleanDirection(result: DirectionResult, source = ''): DirectionResult {
  const ideas = result.ideas
    .map(i => ({ text: fitItem(i.text, LIMITS.idea), label: i.label?.trim() }))
    .filter((i): i is { text: string; label: string | undefined } => i.text !== null)
    .filter(i => !writesForStudent(i.text, source))
    .slice(0, LIMITS.ideasMax);
  if (ideas.length < LIMITS.ideasMin) throw new AiCallError('format', 'ideas');
  return {
    ideas: ideas.map(i => {
      // "제목 후보"·"후렴 후보"처럼 이름표가 후보인 항목은 명사 목록이라 해요체 검사를 하지 않는다(레드팀 평가에서 발견).
      guard(i.text, source, !(i.label ?? '').endsWith('후보'));
      const label =
        i.label && LABEL_OK.test(i.label) && !checkGenerated(i.label, { source, speech: false })
          ? i.label
          : undefined;
      return { text: i.text, ...(label ? { label } : {}) };
    }),
  };
}

/** 다듬은 글 첫 줄이 "다듬은 글:" 같은 머리말이면 떼어 낸다(PLAN §8.5). 기기와 서버 모두 쓴다. */
export function stripPolishPreamble(text: string): string {
  return text.replace(/^\s*(?:다듬은\s*글|고친\s*글)\s*[:：]\s*\n?/, '');
}
