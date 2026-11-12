import { createHash } from 'node:crypto';
import { ko } from '@geulbang/core/copy';
import { maskStudentProfanity, scanText } from '../ai/guard/lexicon.ts';
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
  /** `risky`: 자해·위험 제조 표현(고운 말 권장 대상이 아님) */
  readonly words: readonly { readonly token: string; readonly value: string; readonly risky: boolean }[];
  readonly notices: readonly AiNotice[];
  /** 1인칭 위험 신호(R-01). 무엇이 걸렸는지는 남기지 않는다. */
  readonly care: boolean;
}

export interface MaskedInput {
  readonly text: string;
  readonly helpNotes: readonly { readonly question: string; readonly note: string }[];
  readonly masking: Masking;
}

function maskOne(text: string) {
  const p = maskPii(text);
  const w = maskStudentProfanity(p.text);
  const hits = scanText(p.text);
  const risky = (start: number, end: number) =>
    hits.some(h => h.start < end && h.end > start && (h.category === 'selfharm' || h.category === 'danger'));
  return {
    text: w.masked,
    pii: p.spans,
    words: w.spans.map(s => ({
      token: s.token,
      value: p.text.slice(s.start, s.end),
      risky: risky(s.start, s.end),
    })),
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
  const care = scanText(text).some(h => h.category === 'risk_signal');
  const notices: AiNotice[] = [];
  if (main.pii.length > 0) notices.push('PII_IN_TEXT');
  if (main.words.some(w => !w.risky)) notices.push('PROFANITY_IN_TEXT');
  return { text: main.text, helpNotes: notes, masking: { pii: main.pii, words: main.words, notices, care } };
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
    // 위험 표현(자해 방법·위험 제조)은 "고운 말"로 다룰 일이 아니라 가리기만 한다.
    if (w.risky) continue;
    const at = findFree(realText, w.value, '', taken);
    if (at < 0) continue;
    taken.push({ start: at, end: at + w.value.length });
    out.push({
      at,
      original: w.value,
      suggestion: '',
      reason: ko.student.aiSpellReasonKindWords,
      kind: '맞춤법',
      context: {
        before: [...realText.slice(0, at)].slice(-CONTEXT).join(''),
        after: [...realText.slice(at + w.value.length)].slice(0, CONTEXT).join(''),
      },
      severity: 'suggest',
      rule: ruleOf('KIND'),
    });
  }
  const rank: Readonly<Record<SpellSeverity, number>> = { fix: 0, suggest: 1, keep: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.at - b.at);
  const items2 = out.map(({ at: _at, ...rest }) => rest);
  return { items: items2, ...(m.notices.length > 0 ? { notices: [...m.notices] } : {}) };
}

/** 돌봄 문장이 이미 있는지(모델이 지시를 따랐는지) */
const CARE_WORDS = /선생님|보호자|어른/;

export function finalizeFeedback(r: FeedbackResult, m: Masking): FeedbackResult & { notices?: AiNotice[] } {
  const s = (t: string) => unmaskForSpeech(t, m);
  let improve = r.improve.map(s);
  // 1인칭 위험 신호가 있으면 돌봄 문장을 모델에만 맡기지 않고 서버가 보장한다(R-01). 마지막 고칠 점 자리에 넣는다.
  if (m.care && !improve.some(t => CARE_WORDS.test(t))) {
    improve = [...improve.slice(0, Math.max(0, improve.length - 1)), ko.student.aiCareLine];
  }
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
