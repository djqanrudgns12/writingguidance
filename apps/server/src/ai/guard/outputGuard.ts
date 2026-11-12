import { scanText, type LexHit } from './lexicon.ts';
import { findPiiLike } from './pii.ts';

/**
 * AI가 새로 만든 글 칸의 결정적 검사(docs/ai-harness.md 2절 G-01~G-09).
 * 학생 원문(`source`)에 이미 있던 것은 일부 규칙에서 허용한다(다듬은 글이 옮긴 말, 학생이 AI 이야기를 쓴 경우 등).
 * 걸리면 규칙 ID를 돌려준다. 고치지 않고 버리는 것이 원칙이다(0절 1).
 */
export type GuardRule = 'G01' | 'G02' | 'G03' | 'G04' | 'G05' | 'G06' | 'G07' | 'G09' | 'G10';

export interface GuardOptions {
  /** 학생 원문(자리표시자로 가린 뒤). 여기 있던 말은 일부 규칙에서 통과. */
  readonly source: string;
  /** 학생에게 건네는 말(칭찬·제안·이유·방향): 해요체 끝맺음과 기술 용어를 본다. 다듬은 글은 false. */
  readonly speech: boolean;
}

/** 역할 깨짐·지시 유출(G-04). 학생 글에 같은 말이 있으면 통과(AI가 나오는 이야기 등). */
const META_TERMS = [
  'ai',
  '인공지능',
  '언어 모델',
  '언어모델',
  'claude',
  '클로드',
  'anthropic',
  '앤트로픽',
  '챗봇',
  '시스템 프롬프트',
  '프롬프트',
  '지시사항',
  '지시문',
  '<request',
  '<text',
  '<lens',
  '<help_notes',
  'help_notes',
  '검토 자료',
  '검토할 자료',
];

/**
 * 자리표시자 꼴(G-10). 우리가 가린 자리(학생 글에 있는 것)만 되돌릴 수 있다. 모델이 스스로 만든 `[주소2]` 같은 꼴은
 * 되돌릴 수 없어 화면에 남으므로 버린다(2026-11-13 레드팀: 가리지 않은 집 주소를 모델이 `[주소2]`로 바꿈).
 */
const PLACEHOLDER_LIKE = /\[(?:전화번호|이메일|주민번호|주민등록번호|주소|이름|학교)\s?\d*\]|⟦[^⟧\n]{0,8}⟧/g;

/** 학생 문구 기술 용어(G-06, AGENTS.md 3절). */
const TECH_TERMS = ['서버', '동기화', '브라우저', '버전', '오류 코드', '에러'];

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u;
const MARKDOWN = /\*\*|__|```|^\s{0,3}#{1,6}\s|^\s{0,3}[-*+]\s+\S|^\s{0,3}\d+\.\s+\S/m;
const HTML_TAG = /<\/?[a-zA-Z][^>]{0,40}>/;
const HAN_KANA = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
const LETTER = /\p{L}/gu;
const HANGUL = /[가-힣ㄱ-ㆎᄀ-ᇿ]/u;

/** 해요체 끝맺음(G-07). 문장부호·닫는 따옴표·괄호 뒤는 무시. */
const HAEYO_END = /(?:요|죠|니다|세요|까요|래요|게요|네요|군요|대요)[.!?…~]*["'”’)\]]*$/;

/** 인용(따옴표 안)은 학생 말·대사라 말투 검사에서 뺀다. */
const QUOTED = /“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'|「[^」]*」|『[^』]*』/g;

/**
 * 학생에게 건네는 말이 해요체인지(G-07). 마지막 문장만이 아니라 **모든 문장**이 해요체로 끝나야 한다
 * (2026-11-13 레드팀: "지금 많이 힘들었구나. …소중해요."처럼 앞 문장 반말을 놓쳤다). 따옴표 안 인용은 뺀다.
 */
export function endsPolitely(text: string): boolean {
  const t = text.replace(QUOTED, '○').trim();
  const sentences = t
    .split(/(?<=[.!?])\s+/)
    .map(x => x.trim())
    .filter(x => x.length > 0);
  return sentences.length > 0 && sentences.every(x => HAEYO_END.test(x));
}

/**
 * 한글이 아닌 글자 비율(G-03 다른 언어로 답함). 학생 원문에 있던 라틴 낱말(노랫말 속 영어, 이름 등)은 세지 않는다.
 */
function foreignRatio(s: string, source: string): number {
  const letters = s.match(LETTER) ?? [];
  if (letters.length === 0) return 0;
  const known = new Set((source.match(/[A-Za-z]+/g) ?? []).map(w => w.toLowerCase()));
  const knownLatin = (s.match(/[A-Za-z]+/g) ?? [])
    .filter(w => known.has(w.toLowerCase()))
    .reduce((n, w) => n + w.length, 0);
  const foreign = letters.filter(ch => !HANGUL.test(ch)).length - knownLatin;
  return Math.max(0, foreign) / letters.length;
}

const lower = (s: string) => s.toLowerCase();

function hasRepetition(text: string, source: string): boolean {
  const run = /(\S)\1{5,}/u.exec(text);
  if (run && !source.includes(run[0])) return true;
  const words = text.split(/\s+/).filter(Boolean);
  let same = 1;
  for (let i = 1; i < words.length; i++) {
    same = words[i] === words[i - 1] ? same + 1 : 1;
    // 학생 글에 같은 반복이 있으면(노랫말 "달려라 달려라 …") 옮긴 것으로 본다.
    if (same >= 4 && !source.includes(words.slice(i - 3, i + 1).join(' '))) return true;
  }
  const sentences = text
    .split(/(?<=[.!?\n])/)
    .map(s => s.trim())
    .filter(s => [...s].length >= 10);
  const count = new Map<string, number>();
  for (const s of sentences) {
    const n = (count.get(s) ?? 0) + 1;
    if (n >= 3 && !source.includes(s)) return true;
    count.set(s, n);
  }
  return false;
}

function lexiconViolation(text: string, source: string): GuardRule | null {
  const hits = scanText(text);
  if (hits.length === 0) return null;
  let sourceHits: LexHit[] | null = null;
  for (const hit of hits) {
    if (hit.grade === 'A' || hit.grade === 'C') {
      return hit.category === 'selfharm' || hit.category === 'danger' ? 'G09' : 'G01';
    }
    // B(문맥 필요): 학생 원문에 같은 분류의 말이 있으면 옮긴 것으로 보고 통과(전쟁 이야기의 "죽였다" 등).
    sourceHits ??= scanText(source);
    if (!sourceHits.some(s => s.category === hit.category)) {
      return hit.category === 'selfharm' || hit.category === 'danger' ? 'G09' : 'G01';
    }
  }
  return null;
}

/** 한 칸 검사. 통과면 null. */
export function checkGenerated(text: string, opts: GuardOptions): GuardRule | null {
  const t = text.trim();
  if (t.length === 0) return null;
  const src = opts.source;
  const lex = lexiconViolation(t, src);
  if (lex) return lex;
  if (findPiiLike(t)) return 'G02';
  for (const m of t.match(PLACEHOLDER_LIKE) ?? []) if (!src.includes(m)) return 'G10';
  if (EMOJI.test(t)) return 'G03';
  if (HTML_TAG.test(t) && !HTML_TAG.test(src)) return 'G03';
  if (MARKDOWN.test(t) && !MARKDOWN.test(src)) return 'G03';
  if (HAN_KANA.test(t) && !HAN_KANA.test(src)) return 'G03';
  if (foreignRatio(t, src) > 0.3) return 'G03';
  const lt = lower(t);
  const ls = lower(src);
  for (const term of META_TERMS) {
    if (term === 'ai') {
      if (/(?<![a-z])ai(?![a-z])/i.test(t) && !/(?<![a-z])ai(?![a-z])/i.test(src)) return 'G04';
      continue;
    }
    if (lt.includes(term) && !ls.includes(term)) return 'G04';
  }
  if (hasRepetition(t, src)) return 'G05';
  if (opts.speech) {
    for (const term of TECH_TERMS) if (t.includes(term) && !src.includes(term)) return 'G06';
    if (!endsPolitely(t)) return 'G07';
  }
  return null;
}
