import { createHash } from 'node:crypto';
import { ko } from '@geulbang/core/copy';
import type { DictionaryPort } from '../ai/dictionary.ts';
import { maskStudentProfanity } from '../ai/guard/lexicon.ts';
import { maskPii, namePii, restorePii, type PiiSpan } from '../ai/guard/pii.ts';
import {
  gradeContext,
  gradeSeverity,
  resolveRule,
  ruleOf,
  type SpellKindLabel,
  type SpellRuleId,
  type SpellSeverity,
} from '../ai/guard/spellRules.ts';
import type { DirectionResult, FeedbackResult, SpellResult } from '../ai/schemas.ts';
import { findFree } from '../ai/validate.ts';

/**
 * AI 요청의 앞뒤 안전 처리(docs/ai-harness.md L0·S-06·S-07·S-09·PO-06).
 * - 앞: 개인정보를 자리표시자로, 학생 글 속 비속어를 `⟦가림N⟧`으로 가리고, 1인칭 위험 신호를 본다.
 * - 뒤: 맞춤법 등급·근거를 원문 전체로 붙이고, 자리표시자를 되돌리거나 이름으로 바꾼다.
 * 대응표는 요청 하나 안에서만 쓰고 저장하지 않는다.
 */
export type AiNotice = 'PII_IN_TEXT' | 'PROFANITY_IN_TEXT';

export interface Masking {
  readonly pii: readonly PiiSpan[];
  /** 학생 글 속 쓰면 안 되는 표현(비속어·혐오·성적 표현·자해 방법·위험 제조)을 가린 대응 */
  readonly words: readonly { readonly token: string; readonly value: string }[];
  readonly notices: readonly AiNotice[];
}

export interface MaskedInput {
  readonly text: string;
  readonly helpNotes: readonly { readonly question: string; readonly note: string }[];
  readonly masking: Masking;
}

function maskOne(text: string) {
  const p = maskPii(text);
  const w = maskStudentProfanity(p.text);
  return {
    text: w.masked,
    pii: p.spans,
    words: w.spans.map(s => ({ token: s.token, value: p.text.slice(s.start, s.end) })),
  };
}

/** 학생 글에 우리 자리표시자 괄호(⟦⟧)가 이미 있으면 되살릴 때 헷갈리므로 비슷한 다른 괄호로 바꿔 보낸다. */
const neutralize = (s: string) => s.replace(/⟦/g, '〔').replace(/⟧/g, '〕');

export function maskForAi(
  text: string,
  helpNotes: readonly { readonly question: string; readonly note: string }[],
): MaskedInput {
  const main = maskOne(neutralize(text));
  const notes = helpNotes.map(n => ({ question: n.question, note: maskOne(neutralize(n.note)).text }));
  const notices: AiNotice[] = [];
  if (main.pii.length > 0) notices.push('PII_IN_TEXT');
  if (main.words.length > 0) notices.push('PROFANITY_IN_TEXT');
  return { text: main.text, helpNotes: notes, masking: { pii: main.pii, words: main.words, notices } };
}

/** 남용 탐지용 불투명 ID(M-04): 참여자 ID의 해시 앞 32자. 참여자 ID 자체도 임의 UUID라 사람을 알 수 없다. */
export const userTagOf = (participantId: string): string =>
  createHash('sha256').update(`geulbang:${participantId}`, 'utf8').digest('hex').slice(0, 32);

/** 자리표시자 → 원래 값(다듬은 글, 맞춤법 앞뒤 글자). 가린 비속어는 되살리지 않고 ○○로. */
export function unmaskForStudentText(text: string, m: Masking): string {
  let out = restorePii(text, m.pii);
  for (const w of m.words) out = out.split(w.token).join(ko.student.aiMaskedWord);
  return out;
}

/** 자리표시자 → 종류 이름(한마디·방향: AI 말 안에서 학생 개인정보를 되풀이하지 않게). */
function unmaskForSpeech(text: string, m: Masking): string {
  let out = namePii(text, m.pii, ko.student.aiPiiKind);
  for (const w of m.words) out = out.split(w.token).join(ko.student.aiMaskedWord);
  return out;
}

export interface SpellOutItem {
  readonly original: string;
  readonly suggestion: string;
  readonly reason: string;
  readonly kind: SpellKindLabel;
  readonly context: { readonly before: string; readonly after: string };
  readonly severity: SpellSeverity;
  readonly rule: { readonly id: SpellRuleId; readonly label: string; readonly url: string };
}

const CONTEXT = 6;

/**
 * 맞춤법 마무리: 원문 전체에서 위치를 다시 찾아 등급(S-06)·근거(S-07)를 붙이고, 앞뒤 글자의 자리표시자를 되돌리고,
 * 학생 글 속 비속어 자리에 권장 항목(S-09)을 더한다. 등급 순서(고쳐요 → 권장해요 → 그대로)로 정렬한다.
 */
export function finalizeSpell(
  items: SpellResult['items'],
  realText: string,
  genre: string,
  m: Masking,
): { items: SpellOutItem[]; notices?: AiNotice[] } {
  const ctx = gradeContext(realText, genre);
  const taken: { start: number; end: number }[] = [];
  const out: (SpellOutItem & { readonly at: number })[] = [];
  for (const item of items) {
    const before = unmaskForStudentText(item.context.before, m);
    const at = findFree(realText, item.original, before, taken);
    if (at < 0) continue;
    taken.push({ start: at, end: at + item.original.length });
    const kind = item.kind;
    const severity = gradeSeverity(
      { kind, original: item.original, start: at, severity: item.severity, intent: item.intent },
      ctx,
    );
    out.push({
      at,
      original: item.original,
      suggestion: item.suggestion,
      reason: item.reason,
      kind,
      context: {
        before: [...realText.slice(0, at)].slice(-CONTEXT).join(''),
        after: [...realText.slice(at + item.original.length)].slice(0, CONTEXT).join(''),
      },
      severity,
      rule: ruleOf(resolveRule(kind, item.ruleId)),
    });
  }
  for (const w of m.words) {
    const at = findFree(realText, w.value, '', taken);
    if (at < 0) continue;
    taken.push({ start: at, end: at + w.value.length });
    out.push({
      at,
      original: w.value,
      suggestion: '',
      // 사용자 결정 U-26: 학생 글 속 비속어·위험 표현은 "쓰면 안 되는 표현"이라고 분명히 알린다(고쳐요 등급).
      reason: ko.student.aiSpellReasonKindWords,
      kind: '맞춤법',
      context: {
        before: [...realText.slice(0, at)].slice(-CONTEXT).join(''),
        after: [...realText.slice(at + w.value.length)].slice(0, CONTEXT).join(''),
      },
      severity: 'fix',
      rule: ruleOf('KIND'),
    });
  }
  const rank: Readonly<Record<SpellSeverity, number>> = { fix: 0, suggest: 1, keep: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.at - b.at);
  const items2 = out.map(({ at: _at, ...rest }) => rest);
  return { items: items2, ...(m.notices.length > 0 ? { notices: [...m.notices] } : {}) };
}

export function finalizeFeedback(r: FeedbackResult, m: Masking): FeedbackResult & { notices?: AiNotice[] } {
  const s = (t: string) => unmaskForSpeech(t, m);
  const improve = r.improve.map(s);
  return {
    praise: s(r.praise),
    improve,
    ...(r.factCheck ? { factCheck: s(r.factCheck) } : {}),
    ...(r.eraNote ? { eraNote: s(r.eraNote) } : {}),
    ...(r.softenNote ? { softenNote: s(r.softenNote) } : {}),
    ...(m.notices.length > 0 ? { notices: [...m.notices] } : {}),
  };
}

export function finalizeDirection(
  r: DirectionResult,
  m: Masking,
): DirectionResult & { notices?: AiNotice[] } {
  return {
    ideas: r.ideas.map(i => ({ ...i, text: unmaskForSpeech(i.text, m) })),
    ...(m.notices.length > 0 ? { notices: [...m.notices] } : {}),
  };
}

/** 낱말 끝에 붙은 조사·서술격 조사 꼴(사전 표제어로 다시 찾을 때 뗀다). 긴 것부터. */
const TRAILING = [
  '이에요',
  '이었다',
  '에서',
  '에게',
  '한테',
  '까지',
  '부터',
  '처럼',
  '보다',
  '이랑',
  '으로',
  '이야',
  '이다',
  '예요',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '에',
  '도',
  '만',
  '와',
  '과',
  '로',
  '의',
  '랑',
  '야',
];

function headwordCandidates(original: string): string[] {
  const w = original.trim();
  const out = [w];
  for (const t of TRAILING) {
    if (w.length > t.length + 1 && w.endsWith(t)) {
      out.push(w.slice(0, -t.length));
      break;
    }
  }
  return out;
}

/**
 * 사전 보정(U-25): 표준국어대사전이 비표준어("→ 표준어")라고 확인해 준 말은 대사 안이어도 표기 실수라 고쳐요로 확정한다.
 * 사전에 없거나 표준어로 실린 말은 바꾸지 않는다(문맥상 잘못 쓴 표준어·말투일 수 있어서). 조회가 실패하면 그대로 둔다.
 * 고쳐요가 아닌 맞춤법 항목만, 요청당 `DICT_MAX_PER_REQUEST`개까지 본다.
 */
export async function refineSpellWithDictionary(
  items: readonly SpellOutItem[],
  dict: DictionaryPort,
  maxLookups: number,
  signal: AbortSignal,
): Promise<SpellOutItem[]> {
  let budget = maxLookups;
  const checked = await Promise.all(
    items.map(async item => {
      if (item.kind !== '맞춤법' || item.severity === 'fix' || item.rule.id === 'KIND') return item;
      for (const word of headwordCandidates(item.original)) {
        if (budget <= 0 || signal.aborted) return item;
        budget -= 1;
        const v = await dict.lookup(word, signal);
        if (v.kind === 'nonstandard') return { ...item, severity: 'fix' as const, rule: ruleOf('DICT') };
        if (v.kind !== 'absent') return item;
      }
      return item;
    }),
  );
  const rank: Readonly<Record<SpellSeverity, number>> = { fix: 0, suggest: 1, keep: 2 };
  return checked
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank[a.item.severity] - rank[b.item.severity] || a.i - b.i)
    .map(x => x.item);
}
