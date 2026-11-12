import { ko } from '@geulbang/core/copy';
import { dialogueRanges, inside, type Range } from './dialogue.ts';

/**
 * 맞춤법 항목 규칙(docs/ai-harness.md 2절 S-03·S-04·S-06·S-07, 5절).
 * - 근거 표: 조항은 국립국어원 원문으로 확인한 것만(2026-11-13 조사). LLM은 `ruleId`만 고르고 이름·주소는 여기서 붙인다.
 * - 등급: LLM 판단 위에 서버가 기계적으로 보정한다(대사 안·시 장르·확정 오류 목록).
 */
export const SPELL_SEVERITIES = ['fix', 'suggest', 'keep'] as const;
export type SpellSeverity = (typeof SPELL_SEVERITIES)[number];

export const SPELL_INTENTS = [
  'none',
  'dialect',
  'colloquial',
  'onomatopoeia',
  'poetic',
  'character_voice',
  'neologism',
  'loanword',
] as const;
export type SpellIntent = (typeof SPELL_INTENTS)[number];

const MATCHUM = 'https://korean.go.kr/kornorms/regltn/regltnView.do?regltn_code=0001';
const PYOJUN = 'https://korean.go.kr/kornorms/regltn/regltnView.do?regltn_code=0002';
const OERAE = 'https://korean.go.kr/kornorms/regltn/regltnView.do?regltn_code=0003';
const BUHO = 'https://www.korean.go.kr/front/etcData/etcDataView.do?mn_id=46&etc_seq=431';
const SAJEON = 'https://stdict.korean.go.kr/';

/** 근거 표. `source`는 교사·평가용 정식 이름(학생 화면은 `ko.student.aiSpellRuleLabel`의 쉬운 이름). */
export const SPELL_RULES = {
  HM_35: { source: '한글 맞춤법 제35항 [붙임 2]', url: MATCHUM },
  HM_39: { source: '한글 맞춤법 제39항', url: MATCHUM },
  HM_27: { source: '한글 맞춤법 제27항 [붙임 2]', url: MATCHUM },
  HM_57: { source: '한글 맞춤법 제57항', url: MATCHUM },
  HM_56: { source: '한글 맞춤법 제56항', url: MATCHUM },
  HM_42: { source: '한글 맞춤법 제42항', url: MATCHUM },
  HM_43: { source: '한글 맞춤법 제43항', url: MATCHUM },
  HM_47: { source: '한글 맞춤법 제47항', url: MATCHUM },
  HM_30: { source: '한글 맞춤법 제30항', url: MATCHUM },
  HM_10: { source: '한글 맞춤법 제10~12항', url: MATCHUM },
  HM_53: { source: '한글 맞춤법 제53항', url: MATCHUM },
  HM_41: { source: '한글 맞춤법 제41항', url: MATCHUM },
  HM_2: { source: '한글 맞춤법 제2항', url: MATCHUM },
  LOAN: { source: '외래어 표기법', url: OERAE },
  STD: { source: '표준어 규정', url: PYOJUN },
  PUNCT: { source: '문장 부호(2015)', url: BUHO },
  DICT: { source: '표준국어대사전', url: SAJEON },
  WEN: { source: '표준국어대사전(웬·왠지)', url: SAJEON },
  KIND: { source: '쓰면 안 되는 표현(사용자 결정 U-26)', url: SAJEON },
} as const;
export type SpellRuleId = keyof typeof SPELL_RULES;
/** 모델이 고를 수 있는 값(`KIND`는 서버만 붙인다). */
export const MODEL_RULE_IDS = [
  'HM_35',
  'HM_39',
  'HM_27',
  'HM_57',
  'HM_56',
  'HM_42',
  'HM_43',
  'HM_47',
  'HM_30',
  'HM_10',
  'HM_53',
  'HM_41',
  'HM_2',
  'LOAN',
  'STD',
  'PUNCT',
  'DICT',
  'WEN',
  'NONE',
] as const;
export type ModelRuleId = (typeof MODEL_RULE_IDS)[number];

export function ruleOf(id: SpellRuleId): { id: SpellRuleId; label: string; url: string } {
  const labels: Readonly<Record<string, string>> = ko.student.aiSpellRuleLabel;
  return { id, label: labels[id] ?? labels['DICT'] ?? '', url: SPELL_RULES[id].url };
}

/**
 * 확정 오류 목록(5절 서버 보정 3): 대사 안이어도 표기 실수라 언제나 고쳐요.
 * 발음을 흉내 낸 말투가 아니라 어린이가 자주 틀리는 철자다(국립국어원 온라인가나다 자주 묻는 질문).
 */
const CONFIRMED = [
  /됬/,
  /몇\s?일/,
  /왠만/,
  /어떻해/,
  /[할줄갈올볼게할]께(?:요)?$/,
  /금새/,
  /오랫만/,
  /희안/,
  /설겆이/,
  /웬지/,
  /안되요|되요$/,
  /역활/,
  /으례/,
];

export const isConfirmedError = (original: string): boolean => CONFIRMED.some(re => re.test(original));

const SPACE = /\s+/g;
const PUNCT_CHARS = /[.,!?;:·…~'"“”‘’()[\]{}<>「」『』《》〈〉\-–—]/g;
const strip = (s: string, re: RegExp) => s.replace(re, '');

export type SpellKindLabel = '맞춤법' | '띄어쓰기' | '문장부호';

/** S-03: 실제 변화로 종류를 다시 정한다. 아무것도 안 바뀌었으면 null(뺄 항목). */
export function actualKind(original: string, suggestion: string): SpellKindLabel | null {
  if (original === suggestion) return null;
  if (strip(original, SPACE) === strip(suggestion, SPACE)) return '띄어쓰기';
  const letters = (s: string) => strip(strip(s, SPACE), PUNCT_CHARS);
  if (letters(original) === letters(suggestion)) {
    return strip(original, PUNCT_CHARS) === strip(suggestion, PUNCT_CHARS) ? '문장부호' : '띄어쓰기';
  }
  return '맞춤법';
}

/** 공백·부호를 뺀 글자 편집 거리(레벤슈타인). */
function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      const sub = (prev[j - 1] ?? 0) + (x[i - 1] === y[j - 1] ? 0 : 1);
      cur.push(Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, sub));
    }
    prev = cur;
  }
  return prev[y.length] ?? 0;
}

/** S-04: 문장을 새로 쓰는 수준의 바꿈이면 false. */
export function withinEditBudget(original: string, suggestion: string): boolean {
  const core = (s: string) => strip(strip(s, SPACE), PUNCT_CHARS);
  const a = core(original);
  const b = core(suggestion);
  const budget = Math.max(2, Math.ceil([...a].length * 0.6));
  return editDistance(a, b) <= budget;
}

export interface GradeInput {
  readonly kind: SpellKindLabel;
  readonly original: string;
  readonly start: number;
  readonly severity?: SpellSeverity | undefined;
  readonly intent?: SpellIntent | undefined;
}

export interface GradeContext {
  readonly genre: string;
  readonly dialogue: readonly Range[];
}

export const gradeContext = (text: string, genre: string): GradeContext => ({
  genre,
  dialogue: dialogueRanges(text),
});

const VOICE_INTENTS: ReadonlySet<SpellIntent> = new Set([
  'dialect',
  'colloquial',
  'onomatopoeia',
  'character_voice',
  'neologism',
  'poetic',
]);
const VERSE = new Set(['poem', 'lyrics']);

/** S-06: 서버 보정이 LLM 판단보다 앞선다. LLM이 등급을 안 주면 확신 없음으로 보고 권장. */
export function gradeSeverity(item: GradeInput, ctx: GradeContext): SpellSeverity {
  if (isConfirmedError(item.original)) return 'fix';
  let s: SpellSeverity = item.severity ?? 'suggest';
  const intent = item.intent ?? 'none';
  const inDialogue = inside(ctx.dialogue, item.start, item.start + item.original.length);
  if (inDialogue && item.kind === '맞춤법') {
    if (VOICE_INTENTS.has(intent)) s = 'keep';
    else if (s === 'fix') s = 'suggest';
  }
  if (!inDialogue && VOICE_INTENTS.has(intent) && s === 'fix') s = 'suggest';
  if (intent === 'loanword' && s === 'fix') s = 'suggest';
  if (VERSE.has(ctx.genre) && item.kind !== '맞춤법' && s === 'fix') s = 'suggest';
  if (VERSE.has(ctx.genre) && intent === 'poetic') s = 'keep';
  return s;
}

/** S-07: 모델 값이 목록 밖이거나 없으면 종류로 정한다. */
export function resolveRule(kind: SpellKindLabel, modelRule: string | undefined): SpellRuleId {
  if (modelRule && modelRule !== 'NONE' && modelRule in SPELL_RULES && modelRule !== 'KIND') {
    return modelRule as SpellRuleId;
  }
  return kind === '띄어쓰기' ? 'HM_2' : kind === '문장부호' ? 'PUNCT' : 'DICT';
}

/** 종류별 기본 이유(모델 이유가 G 규칙을 어기면 이것으로 바꾼다). */
export function fallbackReason(kind: SpellKindLabel): string {
  return kind === '띄어쓰기'
    ? ko.student.aiSpellReasonSpacing
    : kind === '문장부호'
      ? ko.student.aiSpellReasonPunctuation
      : ko.student.aiSpellReasonSpelling;
}
