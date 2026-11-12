import { CONFUSABLE_CONSONANTS, CONFUSABLE_VOWELS } from './lexicon-data/confusables.ts';

/**
 * 비속어 검사용 "보기" 만들기(docs/ai-harness.md 4절 정규화).
 *
 * 원문은 바꾸지 않는다. 보기의 칸마다 어디서 왔는지(원문 UTF-16 구간)를 기억해 두고,
 * 걸린 구간을 원문 구간으로 되돌린다. 보기 종류:
 * - 기본(base): NFKD(한글 음절·호환 자모 제외) → 보이지 않는 글자·결합 부호 제거 → 소문자. 공백 덩어리는 한 칸.
 * - 음절(syll): 기본 + 닮은 글자(한글과 섞인 덩어리 안에서만) + 자모 조립 + 늘임·반복 줄이기.
 * - 압축(comp): 음절 보기에서 한글이 아닌 칸(공백·기호·숫자·로마자)을 빼고 다시 조립.
 * - 초성(cho): 원문이 실제로 자음 자모만으로 쓰인 덩어리.
 * - 영타(eng): 로마자 덩어리를 두벌식으로 바꿔 온전한 음절이 될 때만.
 *
 * NFKC를 그대로 쓰지 않는 까닭(Node 24에서 실행해 확인): NFKC는 호환 자모를 첫소리 자모(U+1100대)로 바꾸고
 * 첫소리+가운뎃소리만 합친다. 예: "ㅅㅣㅂㅏㄹ" → "시바ᄅ"(받침 ㄹ이 첫소리 ᄅ로 남음), "ㅄ" → 옛 첫소리 "ᄡ".
 * 그래서 한글은 그대로 두고 나머지만 NFKD로 펼친 뒤 조립은 아래 조립기가 직접 한다.
 */

/** 같은 글자가 이만큼 이상 이어지면 하나로 줄인다("ㅋㅋㅋ", "개새새새끼"). 설정으로 바꿀 값이 아니라 검사기 내부 규칙이다. */
const REPEAT_RUN_MIN = 3;
/** "시이이발"처럼 앞 음절 홀소리를 늘인 ㅇ+홀소리 음절이 이만큼 이상 이어지면 뺀다. 1이면 "다시 이발소" 같은 말을 망친다. */
const ELONGATION_RUN_MIN = 2;

const S_BASE = 0xac00;
const S_LAST = 0xd7a3;
const J_FIRST = 0x3131;
const J_CONS_LAST = 0x314e;
const J_VOWEL_FIRST = 0x314f;
const J_LAST = 0x3163;
const SPACE = 0x20;

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
/** 0번은 "받침 없음" */
const JONG = '\0ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';

const JAMO_COUNT = J_LAST - J_FIRST + 1;
/** 호환 자모 → 첫소리 번호(없으면 -1) */
const CHO_OF = new Int8Array(JAMO_COUNT).fill(-1);
/** 호환 자모 → 가운뎃소리 번호(없으면 -1) */
const JUNG_OF = new Int8Array(JAMO_COUNT).fill(-1);
/** 호환 자모 → 받침 번호(받침이 될 수 없으면 0) */
const JONG_OF = new Int8Array(JAMO_COUNT);
for (let i = 0; i < CHO.length; i++) CHO_OF[CHO.charCodeAt(i) - J_FIRST] = i;
for (let i = 0; i < JUNG.length; i++) JUNG_OF[JUNG.charCodeAt(i) - J_FIRST] = i;
for (let i = 1; i < JONG.length; i++) JONG_OF[JONG.charCodeAt(i) - J_FIRST] = i;

const pairKey = (a: number, b: number) => a * 64 + b;
/** 겹홀소리: (앞, 뒤) 가운뎃소리 번호 → 합친 번호 */
const VOWEL_PAIR = new Map<number, number>();
for (const [a, b, c] of [
  ['ㅗ', 'ㅏ', 'ㅘ'],
  ['ㅗ', 'ㅐ', 'ㅙ'],
  ['ㅗ', 'ㅣ', 'ㅚ'],
  ['ㅜ', 'ㅓ', 'ㅝ'],
  ['ㅜ', 'ㅔ', 'ㅞ'],
  ['ㅜ', 'ㅣ', 'ㅟ'],
  ['ㅡ', 'ㅣ', 'ㅢ'],
] as const) {
  VOWEL_PAIR.set(pairKey(JUNG.indexOf(a), JUNG.indexOf(b)), JUNG.indexOf(c));
}
/** 겹받침: (앞 받침 번호, 뒤 자모 받침 번호) → 합친 받침 번호. 뒤 소리가 홀소리 앞에서 다음 음절로 넘어갈 때 쪼갠다. */
const FINAL_PAIR = new Map<number, number>();
/** 겹받침 번호 → [남는 받침 번호, 넘어가는 첫소리 번호] */
const FINAL_SPLIT = new Map<number, readonly [number, number]>();
for (const [a, b, c] of [
  ['ㄱ', 'ㅅ', 'ㄳ'],
  ['ㄴ', 'ㅈ', 'ㄵ'],
  ['ㄴ', 'ㅎ', 'ㄶ'],
  ['ㄹ', 'ㄱ', 'ㄺ'],
  ['ㄹ', 'ㅁ', 'ㄻ'],
  ['ㄹ', 'ㅂ', 'ㄼ'],
  ['ㄹ', 'ㅅ', 'ㄽ'],
  ['ㄹ', 'ㅌ', 'ㄾ'],
  ['ㄹ', 'ㅍ', 'ㄿ'],
  ['ㄹ', 'ㅎ', 'ㅀ'],
  ['ㅂ', 'ㅅ', 'ㅄ'],
] as const) {
  const ja = JONG.indexOf(a);
  const jb = JONG.indexOf(b);
  const jc = JONG.indexOf(c);
  FINAL_PAIR.set(pairKey(ja, jb), jc);
  FINAL_SPLIT.set(jc, [ja, CHO.indexOf(b)]);
}
/** 받침 번호 → 첫소리 번호(홀소리 앞에서 다음 음절로 넘어갈 때). 첫소리가 될 수 없는 겹받침은 -1 */
const JONG_TO_CHO = new Int8Array(JONG.length).fill(-1);
for (let t = 1; t < JONG.length; t++) JONG_TO_CHO[t] = CHO.indexOf(JONG.charAt(t));
/** 같은 자음 둘 + 홀소리 → 된소리 첫소리("ㅅㅅㅣ" → "씨") */
const DOUBLE_CHO = new Map<number, number>([
  [CHO.indexOf('ㄱ'), CHO.indexOf('ㄲ')],
  [CHO.indexOf('ㄷ'), CHO.indexOf('ㄸ')],
  [CHO.indexOf('ㅂ'), CHO.indexOf('ㅃ')],
  [CHO.indexOf('ㅅ'), CHO.indexOf('ㅆ')],
  [CHO.indexOf('ㅈ'), CHO.indexOf('ㅉ')],
]);

/** 두벌식 자판: 로마자 → 호환 자모. 대문자는 Shift 자리(ㅃㅉㄸㄲㅆㅒㅖ)만 따로 있고 나머지는 소문자와 같다. */
const DUBEOLSIK_LOWER = 'ㅁㅠㅊㅇㄷㄹㅎㅗㅑㅓㅏㅣㅡㅜㅐㅔㅂㄱㄴㅅㅕㅍㅈㅌㅛㅋ';
const DUBEOLSIK_SHIFT: Readonly<Record<string, string>> = {
  q: 'ㅃ',
  w: 'ㅉ',
  e: 'ㄸ',
  r: 'ㄲ',
  t: 'ㅆ',
  o: 'ㅒ',
  p: 'ㅖ',
};

export const isSyllable = (c: number) => c >= S_BASE && c <= S_LAST;
export const isJamo = (c: number) => c >= J_FIRST && c <= J_LAST;
export const isConsonantJamo = (c: number) => c >= J_FIRST && c <= J_CONS_LAST;
export const isVowelJamo = (c: number) => c >= J_VOWEL_FIRST && c <= J_LAST;
export const isHangul = (c: number) => isSyllable(c) || isJamo(c);

const INVISIBLE = /[\p{Cf}\p{M}\u115f\u1160\u3164\uffa0]/u;
/** 닮은 글자 후보(기본 보기 글자 코드). 없으면 음절 보기를 빨리 끝낸다. */
const CONFUSABLE_CODES = new Set<number>(
  [...Object.keys(CONFUSABLE_CONSONANTS), ...Object.keys(CONFUSABLE_VOWELS)].map(k => k.charCodeAt(0)),
);
const WHITESPACE = /[\s\p{Cc}\p{Z}]/u;

/** 기본 보기. 칸 하나 = UTF-16 한 단위(BMP). */
export interface BaseView {
  /** 소문자로 바꾼 보기 글 */
  readonly text: string;
  /** 대소문자를 살린 같은 길이 글(영타 보기용) */
  readonly cased: string;
  /** 칸마다 원문 시작(포함) UTF-16 위치 */
  readonly origStart: Int32Array;
  /** 칸마다 원문 끝(제외) UTF-16 위치 */
  readonly origEnd: Int32Array;
  /** 자모나 닮은 글자 후보가 있는가(없으면 음절 보기가 기본 보기와 같아 빨리 끝난다) */
  readonly needsAssembly: boolean;
}

/** 기본 보기에서 다시 만든 보기. 칸마다 기본 보기 구간 [srcStart, srcEnd)를 가진다. */
export interface DerivedView {
  readonly text: string;
  readonly srcStart: Int32Array;
  readonly srcEnd: Int32Array;
}

/** 압축 보기. 모서리 규칙(lexicon.ts)을 위해 기본 보기 칸마다 그 칸이 든 한글 덩어리의 시작·끝을 가진다. */
export interface CompressedView extends DerivedView {
  readonly pieceStart: Int32Array;
  readonly pieceEnd: Int32Array;
}

/** 넓혀 가며 쓰는 칸 버퍼(보기마다 한 번 만들고 마지막에 잘라 쓴다). */
class Units {
  codes: number[] = [];
  starts: number[] = [];
  ends: number[] = [];
  push(code: number, start: number, end: number): void {
    this.codes.push(code);
    this.starts.push(start);
    this.ends.push(end);
  }
  get length(): number {
    return this.codes.length;
  }
}

function toText(codes: readonly number[]): string {
  // 긴 글에서 String.fromCharCode(...codes) 인자 수 한도를 넘지 않도록 나눠 붙인다.
  let out = '';
  for (let i = 0; i < codes.length; i += 4096) out += String.fromCharCode(...codes.slice(i, i + 4096));
  return out;
}

const lowerUnit = (u: number): number => {
  if (u < 0x80) return u >= 0x41 && u <= 0x5a ? u + 32 : u;
  const l = String.fromCharCode(u).toLowerCase();
  return l.length === 1 ? l.charCodeAt(0) : u;
};

/** 첫소리·가운뎃소리·끝소리 조합형(U+1100대) 한 글자 → 호환 자모. 옛 자모는 -1. */
function conjoiningToCompat(c: number): number {
  if (c >= 0x1100 && c <= 0x1112) return CHO.charCodeAt(c - 0x1100);
  if (c >= 0x1161 && c <= 0x1175) return JUNG.charCodeAt(c - 0x1161);
  if (c >= 0x11a8 && c <= 0x11c2) return JONG.charCodeAt(c - 0x11a8 + 1);
  return -1;
}

/** 원문 → 기본 보기 */
export function toBaseView(text: string): BaseView {
  const cased: number[] = [];
  const lower: number[] = [];
  const os: number[] = [];
  const oe: number[] = [];
  let needsAssembly = false;
  const push = (u: number, s: number, e: number) => {
    // 공백 덩어리는 한 칸으로(허용어 "자살 예방"이 "자살  예방"에도 맞게)
    if (u === SPACE && lower.length > 0 && lower[lower.length - 1] === SPACE) {
      oe[oe.length - 1] = e;
      return;
    }
    const l = lowerUnit(u);
    cased.push(u);
    lower.push(l);
    os.push(s);
    oe.push(e);
    if (isJamo(l) || CONFUSABLE_CODES.has(l)) needsAssembly = true;
  };

  const n = text.length;
  let i = 0;
  while (i < n) {
    const cp = text.codePointAt(i) ?? 0;
    const w = cp > 0xffff ? 2 : 1;
    const s = i;
    i += w;
    if (cp < 0x80) {
      if (cp === SPACE || (cp >= 0x09 && cp <= 0x0d)) push(SPACE, s, i);
      else if (cp < 0x20 || cp === 0x7f) push(SPACE, s, i);
      else push(cp, s, i);
      continue;
    }
    if (isSyllable(cp) || isJamo(cp)) {
      push(cp, s, i);
      continue;
    }
    // 풀어 쓴 한글(NFD, 예: macOS 파일 이름에서 옮긴 글): 첫소리+가운뎃소리(+끝소리)를 한 음절로 묶는다.
    // 따로 두면 "갑시"의 받침 ㅂ과 다음 첫소리 ㅅ이 붙어 초성 "ㅂㅅ"처럼 보인다.
    if (cp >= 0x1100 && cp <= 0x1112) {
      const v = text.charCodeAt(i);
      if (v >= 0x1161 && v <= 0x1175) {
        let code = S_BASE + ((cp - 0x1100) * 21 + (v - 0x1161)) * 28;
        i += 1;
        const t = text.charCodeAt(i);
        if (t >= 0x11a8 && t <= 0x11c2) {
          code += t - 0x11a7;
          i += 1;
        }
        push(code, s, i);
        continue;
      }
    }
    const ch = String.fromCodePoint(cp);
    if (INVISIBLE.test(ch)) continue;
    if (WHITESPACE.test(ch)) {
      push(SPACE, s, i);
      continue;
    }
    const d = ch.normalize('NFKD');
    for (let k = 0; k < d.length; k++) {
      const u = d.charCodeAt(k);
      if (u >= 0xd800 && u <= 0xdfff) {
        // 이모지 등 BMP 밖 글자는 구분 칸(공백)으로 본다. 압축 보기에서는 빠진다.
        push(SPACE, s, i);
        break;
      }
      const uc = String.fromCharCode(u);
      if (INVISIBLE.test(uc)) continue;
      const compat = conjoiningToCompat(u);
      if (compat >= 0) push(compat, s, i);
      else if (WHITESPACE.test(uc)) push(SPACE, s, i);
      else push(u, s, i);
    }
  }
  return {
    text: toText(lower),
    cased: toText(cased),
    origStart: Int32Array.from(os),
    origEnd: Int32Array.from(oe),
    needsAssembly,
  };
}

/**
 * 닮은 글자 바꾸기. 한글이 하나라도 든 덩어리(공백 사이) 안에서만, 그리고 자모와 맞물릴 때만 바꾼다.
 * - 자음 꼴(^, 人, 己, 0 …): 바로 뒤가(자음 꼴을 건너뛰고) 홀소리 자모나 홀소리 꼴일 때.
 * - 홀소리 꼴(1, l, |, r …): 바로 앞(바꾼 뒤)이 자음 자모일 때.
 * 그래서 "1학년", "AI가", "좋아요^^"의 숫자·기호는 그대로다.
 */
function mapConfusables(base: BaseView): number[] {
  const t = base.text;
  const n = t.length;
  const out: number[] = new Array<number>(n);
  for (let k = 0; k < n; k++) out[k] = t.charCodeAt(k);
  if (!base.needsAssembly) return out;
  let runStart = 0;
  while (runStart < n) {
    let runEnd = runStart;
    let hasHangul = false;
    while (runEnd < n && out[runEnd] !== SPACE) {
      if (isHangul(out[runEnd] ?? 0)) hasHangul = true;
      runEnd++;
    }
    if (hasHangul) {
      for (let k = runStart; k < runEnd; k++) {
        const ch = t.charAt(k);
        const cons = CONFUSABLE_CONSONANTS[ch];
        if (cons !== undefined) {
          let j = k + 1;
          while (j < runEnd && CONFUSABLE_CONSONANTS[t.charAt(j)] !== undefined) j++;
          const nextCode = j < runEnd ? t.charCodeAt(j) : 0;
          if (isVowelJamo(nextCode) || CONFUSABLE_VOWELS[t.charAt(j)] !== undefined)
            out[k] = cons.charCodeAt(0);
          continue;
        }
        const vowel = CONFUSABLE_VOWELS[ch];
        if (vowel !== undefined && k > runStart && isConsonantJamo(out[k - 1] ?? 0))
          out[k] = vowel.charCodeAt(0);
      }
    }
    runStart = runEnd + 1;
  }
  return out;
}

/**
 * 자모 조립기(두벌식 입력기와 같은 규칙). 받침 없는 완성 음절은 뒤 자음을 받침으로 받을 수 있게 풀어서 이어 조립한다
 * ("시바ㄹ" → "시발", "벼ㅇ신" → "병신"). 한글이 아닌 칸은 그대로 지나간다.
 * 이미 받침이 있는 완성 음절은 겹받침을 만들지 않는다("발ㅅㅂ"이 "밠ㅂ"이 되면 "발"을 놓친다).
 * `pieceOf`(압축 보기)가 있으면 완성 음절은 다른 덩어리의 자모와 잇지 않는다("시 발 ㅅㅂ").
 */
function assemble(
  codes: readonly number[],
  starts: readonly number[],
  ends: readonly number[],
  pieceOf?: readonly number[],
): Units {
  const out = new Units();
  const len = codes.length;
  // 만드는 중인 음절: L 첫소리, V 가운뎃소리, T 받침(번호, 0=없음)
  let L = -1;
  let V = -1;
  let T = 0;
  let s0 = 0;
  let e0 = 0;
  /** 받침의 마지막 자모 칸 구간(홀소리가 오면 다음 음절로 넘어간다) */
  let tS = 0;
  let tE = 0;
  /** 마지막 받침 자모를 넣기 전 끝 */
  let eBeforeT = 0;
  /** 지금 음절이 완성 음절에서 시작했는가, 그 덩어리 번호 */
  let fromSyllable = false;
  let statePiece = -1;

  const flush = () => {
    if (L >= 0 && V >= 0) out.push(S_BASE + (L * 21 + V) * 28 + T, s0, e0);
    else if (L >= 0) out.push(CHO.charCodeAt(L), s0, e0);
    L = -1;
    V = -1;
    T = 0;
    fromSyllable = false;
  };

  for (let k = 0; k < len; k++) {
    const c = codes[k] ?? 0;
    const s = starts[k] ?? 0;
    const e = ends[k] ?? 0;
    if (isSyllable(c)) {
      flush();
      fromSyllable = true;
      statePiece = pieceOf?.[k] ?? -1;
      const idx = c - S_BASE;
      L = Math.floor(idx / 588);
      V = Math.floor((idx % 588) / 28);
      T = idx % 28;
      s0 = s;
      e0 = e;
      tS = s;
      tE = e;
      eBeforeT = e;
      continue;
    }
    if (!isJamo(c)) {
      flush();
      out.push(c, s, e);
      continue;
    }
    if (fromSyllable && pieceOf !== undefined && pieceOf[k] !== statePiece) flush();
    const j = c - J_FIRST;
    const vowel = JUNG_OF[j] ?? -1;
    if (vowel >= 0) {
      if (L >= 0 && V < 0) {
        V = vowel;
        e0 = e;
      } else if (L >= 0 && T === 0) {
        const pair = VOWEL_PAIR.get(pairKey(V, vowel));
        if (pair !== undefined) {
          V = pair;
          e0 = e;
        } else {
          flush();
          out.push(c, s, e);
        }
      } else if (L >= 0 && T > 0) {
        // 받침이 홀소리 앞에서 다음 음절 첫소리로 넘어간다(겹받침이면 뒤 소리만).
        const split = FINAL_SPLIT.get(T);
        let movedCho: number;
        if (split) {
          T = split[0];
          movedCho = split[1];
        } else {
          movedCho = JONG_TO_CHO[T] ?? -1;
          T = 0;
        }
        if (movedCho < 0) {
          flush();
          out.push(c, s, e);
          continue;
        }
        const ns = tS;
        e0 = eBeforeT;
        flush();
        statePiece = pieceOf?.[k] ?? -1;
        L = movedCho;
        V = vowel;
        s0 = ns;
        e0 = Math.max(tE, e);
      } else {
        flush();
        out.push(c, s, e);
      }
      continue;
    }
    // 자음
    const cho = CHO_OF[j] ?? -1;
    const jong = JONG_OF[j] ?? 0;
    if (L >= 0 && V < 0) {
      // 같은 자음 둘 + 홀소리 → 된소리
      const dbl = cho === L ? DOUBLE_CHO.get(L) : undefined;
      if (dbl !== undefined && isVowelJamo(codes[k + 1] ?? 0)) {
        L = dbl;
        e0 = e;
        continue;
      }
      flush();
    } else if (L >= 0 && V >= 0 && T === 0 && jong > 0) {
      T = jong;
      eBeforeT = e0;
      tS = s;
      tE = e;
      e0 = e;
      continue;
    } else if (L >= 0 && V >= 0 && T > 0) {
      const pair = jong > 0 && !fromSyllable ? FINAL_PAIR.get(pairKey(T, jong)) : undefined;
      if (pair !== undefined) {
        T = pair;
        eBeforeT = e0;
        tS = s;
        tE = e;
        e0 = e;
        continue;
      }
      flush();
    } else {
      flush();
    }
    if (cho >= 0) {
      L = cho;
      V = -1;
      T = 0;
      s0 = s;
      e0 = e;
      fromSyllable = false;
    } else {
      // 첫소리가 될 수 없는 겹자음(ㄳ, ㅄ …)은 그대로 둔다.
      out.push(c, s, e);
    }
  }
  flush();
  return out;
}

const vowelOf = (c: number) => (isSyllable(c) ? Math.floor(((c - S_BASE) % 588) / 28) : -1);
const finalOf = (c: number) => (isSyllable(c) ? (c - S_BASE) % 28 : -1);
const choOf = (c: number) => (isSyllable(c) ? Math.floor((c - S_BASE) / 588) : -1);
const IEUNG = CHO.indexOf('ㅇ');

/**
 * 늘임·반복 줄이기.
 * - 같은 글자가 REPEAT_RUN_MIN번 이상 이어지면 하나로.
 * - 앞 음절과 같은 홀소리 자모(받침 없는 음절 뒤 "ㅣ")는 뺀다("시ㅣㅣ발").
 * - 앞 음절과 같은 홀소리의 "ㅇ+홀소리" 음절이 ELONGATION_RUN_MIN번 이상이면 빼고,
 *   바로 뒤가 같은 홀소리+받침이면 받침을 앞 음절로 옮긴다("조오오온나" → "존나").
 */
function squeeze(u: Units): Units {
  const out = new Units();
  const n = u.length;
  let k = 0;
  while (k < n) {
    const c = u.codes[k] ?? 0;
    let run = k + 1;
    while (run < n && u.codes[run] === c) run++;
    const prevIdx = out.length - 1;
    const prev = prevIdx >= 0 ? (out.codes[prevIdx] ?? 0) : 0;
    const pv = vowelOf(prev);
    if (pv >= 0 && finalOf(prev) === 0) {
      // 앞 음절과 같은 홀소리 자모
      if (isVowelJamo(c) && JUNG_OF[c - J_FIRST] === pv) {
        out.ends[prevIdx] = u.ends[run - 1] ?? 0;
        k = run;
        continue;
      }
      // ㅇ+같은 홀소리(받침 없음) 늘임
      let m = k;
      while (m < n) {
        const x = u.codes[m] ?? 0;
        if (!(choOf(x) === IEUNG && vowelOf(x) === pv && finalOf(x) === 0)) break;
        m++;
      }
      if (m - k >= ELONGATION_RUN_MIN) {
        let end = u.ends[m - 1] ?? 0;
        const after = u.codes[m] ?? 0;
        if (m < n && choOf(after) === IEUNG && vowelOf(after) === pv && finalOf(after) > 0) {
          out.codes[prevIdx] = prev + finalOf(after);
          end = u.ends[m] ?? 0;
          m++;
        }
        out.ends[prevIdx] = end;
        k = m;
        continue;
      }
    }
    if (run - k >= REPEAT_RUN_MIN) {
      out.push(c, u.starts[k] ?? 0, u.ends[run - 1] ?? 0);
      k = run;
      continue;
    }
    out.push(c, u.starts[k] ?? 0, u.ends[k] ?? 0);
    k++;
  }
  return out;
}

function toDerived(u: Units): DerivedView {
  return { text: toText(u.codes), srcStart: Int32Array.from(u.starts), srcEnd: Int32Array.from(u.ends) };
}

const identityIndex = (n: number) => {
  const s: number[] = new Array<number>(n);
  const e: number[] = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    s[k] = k;
    e[k] = k + 1;
  }
  return { s, e };
};

/** 음절 보기: 닮은 글자 + 자모 조립 + 늘임·반복 줄이기 */
export function toSyllableView(base: BaseView): DerivedView {
  const codes = mapConfusables(base);
  const { s, e } = identityIndex(codes.length);
  if (!base.needsAssembly) {
    const u = new Units();
    u.codes = codes;
    u.starts = s;
    u.ends = e;
    return toDerived(squeeze(u));
  }
  return toDerived(squeeze(assemble(codes, s, e)));
}

/** 압축 보기: 한글 칸만 남기고(공백·기호·숫자·로마자를 빼고) 다시 조립 */
export function toCompressedView(base: BaseView): CompressedView {
  const codes = mapConfusables(base);
  const n = codes.length;
  const kc: number[] = [];
  const ks: number[] = [];
  const ke: number[] = [];
  const pieceStart = new Int32Array(n).fill(-1);
  const pieceEnd = new Int32Array(n).fill(-1);
  let k = 0;
  while (k < n) {
    if (!isHangul(codes[k] ?? 0)) {
      k++;
      continue;
    }
    let m = k;
    while (m < n && isHangul(codes[m] ?? 0)) {
      kc.push(codes[m] ?? 0);
      ks.push(m);
      ke.push(m + 1);
      m++;
    }
    for (let x = k; x < m; x++) {
      pieceStart[x] = k;
      pieceEnd[x] = m;
    }
    k = m;
  }
  const kp = ks.map(x => pieceStart[x] ?? -1);
  const u = squeeze(assemble(kc, ks, ke, kp));
  return { ...toDerived(u), pieceStart, pieceEnd };
}

/**
 * 초성 보기: 자음 자모 덩어리만 남긴다. 덩어리 바로 앞뒤가 홀소리 자모면(자모로 풀어 친 음절) 버린다.
 * 덩어리 사이는 공백 한 칸. 공백·기호를 건너 이어 붙이지 않는다("ㄱ, ㄴ, ㄷ … ㅂ, ㅅ" 자음 공부 글 오탐 방지).
 */
export function toChosungView(base: BaseView): DerivedView {
  const t = base.text;
  const n = t.length;
  const u = new Units();
  let k = 0;
  while (k < n) {
    if (!isConsonantJamo(t.charCodeAt(k))) {
      k++;
      continue;
    }
    let m = k;
    while (m < n && isConsonantJamo(t.charCodeAt(m))) m++;
    const before = k > 0 ? t.charCodeAt(k - 1) : 0;
    const after = m < n ? t.charCodeAt(m) : 0;
    if (!isVowelJamo(before) && !isVowelJamo(after)) {
      if (u.length > 0) u.push(SPACE, k, k);
      for (let x = k; x < m; x++) u.push(t.charCodeAt(x), x, x + 1);
    }
    k = m;
  }
  return toDerived(squeeze(u));
}

/** 로마자 한 글자(대소문자 그대로) → 두벌식 호환 자모. 로마자가 아니면 -1 */
function dubeolsik(ch: string): number {
  const lowerCh = ch.toLowerCase();
  const idx = lowerCh.charCodeAt(0) - 0x61;
  if (idx < 0 || idx > 25 || lowerCh.length !== 1) return -1;
  if (ch !== lowerCh) {
    const shifted = DUBEOLSIK_SHIFT[lowerCh];
    if (shifted !== undefined) return shifted.charCodeAt(0);
  }
  return DUBEOLSIK_LOWER.charCodeAt(idx);
}

/**
 * 영타 보기: 두 글자 이상 로마자 덩어리를 두벌식으로 바꿔 남는 자모 없이 온전한 음절이 될 때만 바꾼다
 * ("tlqkf" → "시발", "hello"는 자모가 남아 그대로). 바뀐 덩어리가 없으면 null.
 */
export function toDubeolsikView(base: BaseView): DerivedView | null {
  const t = base.text;
  const cased = base.cased;
  const n = t.length;
  const out = new Units();
  let changed = false;
  let k = 0;
  const isLatin = (c: number) => c >= 0x61 && c <= 0x7a;
  while (k < n) {
    if (!isLatin(t.charCodeAt(k))) {
      out.push(t.charCodeAt(k), k, k + 1);
      k++;
      continue;
    }
    let m = k;
    while (m < n && isLatin(t.charCodeAt(m))) m++;
    let converted: Units | null = null;
    if (m - k >= 2) {
      const jc: number[] = [];
      const js: number[] = [];
      const je: number[] = [];
      for (let x = k; x < m; x++) {
        jc.push(dubeolsik(cased.charAt(x)));
        js.push(x);
        je.push(x + 1);
      }
      const asm = assemble(jc, js, je);
      if (asm.codes.every(isSyllable)) converted = asm;
    }
    if (converted) {
      changed = true;
      for (let x = 0; x < converted.length; x++) {
        out.push(converted.codes[x] ?? 0, converted.starts[x] ?? 0, converted.ends[x] ?? 0);
      }
    } else {
      for (let x = k; x < m; x++) out.push(t.charCodeAt(x), x, x + 1);
    }
    k = m;
  }
  return changed ? toDerived(squeeze(out)) : null;
}

/** 사전 낱말을 음절 보기와 같은 규칙으로 바꾼 열쇠(공백은 한 칸으로 남는다). */
export function syllableKey(word: string): string {
  return toSyllableView(toBaseView(word)).text.trim();
}

/** 사전 낱말을 기본 보기 규칙으로만 바꾼 열쇠(로마자·숫자 낱말용, 닮은 글자·조립 없음). */
export function baseKey(word: string): string {
  return toBaseView(word).text.trim();
}
