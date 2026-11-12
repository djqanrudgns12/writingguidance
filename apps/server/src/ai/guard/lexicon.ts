import { LEXICON_SOURCES } from './lexicon-data/index.ts';
import {
  baseKey,
  isHangul,
  isConsonantJamo,
  syllableKey,
  toBaseView,
  toChosungView,
  toCompressedView,
  toDubeolsikView,
  toSyllableView,
  type BaseView,
  type CompressedView,
  type DerivedView,
} from './normalize.ts';

/**
 * 비속어·위험 표현 사전 검사(docs/ai-harness.md 4절, G-01·G-09·R-01·S-09).
 * 의존성 없음. 사전은 모듈을 처음 불러올 때 한 번만 만든다.
 */

export type LexGrade = 'A' | 'B' | 'C';
export type LexCategory = 'profanity' | 'sexual' | 'hate' | 'selfharm' | 'danger' | 'risk_signal';
export interface LexHit {
  readonly start: number; // 원문 기준, 포함
  readonly end: number; // 원문 기준, 제외
  readonly grade: LexGrade;
  readonly category: LexCategory;
}

/** 압축 보기에서 덩어리 가장자리를 걸칠 때 그 덩어리에서 최소 이만큼은 덮어야 한다("다시 발로"의 "시"+"발" 오탐 방지). */
const EDGE_MIN_COVER = 2;

/** 사전 낱말 종류 */
type Kind = 'main' | 'raw' | 'phrase' | 'cho';

interface Entry {
  readonly kind: Kind;
  readonly grade: LexGrade;
  readonly category: LexCategory;
  /** 앞이 한글이 아니어야 한다(낱말 첫머리) */
  readonly wordStart: boolean;
  /** 사전에 적힌 꼴이 열쇠와 같은가(자모로 쓴 꼴이 조립돼 같은 열쇠가 되면 false) */
  readonly canonical: boolean;
  readonly source: string;
}

/** 다중 패턴 찾기(Aho-Corasick). 키 글자는 작은 번호(알파벳 번호)로 바꿔 Map 열쇠를 작게 둔다. */
interface Automaton {
  readonly alpha: Map<number, number>;
  readonly alphaSize: number;
  readonly next: Map<number, number>;
  readonly fail: Int32Array;
  /** 노드마다 끝나는 패턴 번호들(실패 고리를 따라 모은 것까지) */
  readonly out: readonly (readonly number[] | undefined)[];
  /** 패턴 번호 → 키 길이 */
  readonly lens: readonly number[];
  /** 패턴 번호 → 값(사전 낱말 번호 또는 허용어 표시) */
  readonly payload: readonly number[];
}

/** 허용어 표시(payload가 음수면 허용어: -(번호+1)) */
const isAllowPayload = (p: number) => p < 0;

class AutomatonBuilder {
  private readonly keys: string[] = [];
  private readonly payloads: number[] = [];
  private readonly seen = new Map<string, number>();

  /** 같은 (키, 값)은 한 번만 넣는다. 키가 같아도 값(낱말·허용어)이 다르면 둘 다 넣는다. */
  add(key: string, payload: number): void {
    if (key.length === 0) return;
    const dupKey = `${key}\u0000${payload}`;
    if (this.seen.has(dupKey)) return;
    this.seen.set(dupKey, this.keys.length);
    this.keys.push(key);
    this.payloads.push(payload);
  }

  build(): Automaton {
    const alpha = new Map<number, number>();
    for (const k of this.keys) {
      for (let i = 0; i < k.length; i++) {
        const c = k.charCodeAt(i);
        if (!alpha.has(c)) alpha.set(c, alpha.size + 1);
      }
    }
    const alphaSize = alpha.size + 1;
    const next = new Map<number, number>();
    const ownOut: number[][] = [[]];
    let nodes = 1;
    this.keys.forEach((k, id) => {
      let st = 0;
      for (let i = 0; i < k.length; i++) {
        const a = alpha.get(k.charCodeAt(i)) ?? 0;
        const key = st * alphaSize + a;
        let nx = next.get(key);
        if (nx === undefined) {
          nx = nodes++;
          next.set(key, nx);
          ownOut.push([]);
        }
        st = nx;
      }
      ownOut[st]?.push(id);
    });
    // 너비 우선으로 실패 고리를 만든다. 자식 목록을 노드별로 모아 둔다.
    const children: number[][] = Array.from({ length: nodes }, () => []);
    const childAlpha: number[][] = Array.from({ length: nodes }, () => []);
    for (const [key, child] of next) {
      const parent = Math.floor(key / alphaSize);
      children[parent]?.push(child);
      childAlpha[parent]?.push(key % alphaSize);
    }
    const fail = new Int32Array(nodes);
    const out: (number[] | undefined)[] = new Array<number[] | undefined>(nodes);
    const queue: number[] = [];
    for (const c of children[0] ?? []) {
      fail[c] = 0;
      queue.push(c);
    }
    out[0] = undefined;
    for (let qi = 0; qi < queue.length; qi++) {
      const node = queue[qi] ?? 0;
      const own = ownOut[node] ?? [];
      const inherited = out[fail[node] ?? 0];
      const merged = inherited ? own.concat(inherited) : own;
      out[node] = merged.length > 0 ? merged : undefined;
      const kids = children[node] ?? [];
      const kidAlpha = childAlpha[node] ?? [];
      for (let x = 0; x < kids.length; x++) {
        const child = kids[x] ?? 0;
        const a = kidAlpha[x] ?? 0;
        let f = fail[node] ?? 0;
        let target = next.get(f * alphaSize + a);
        while (target === undefined && f !== 0) {
          f = fail[f] ?? 0;
          target = next.get(f * alphaSize + a);
        }
        fail[child] = target !== undefined && target !== child ? target : 0;
        queue.push(child);
      }
    }
    return {
      alpha,
      alphaSize,
      next,
      fail,
      out,
      lens: this.keys.map(k => k.length),
      payload: this.payloads,
    };
  }
}

/** 보기 글에서 모든 일치를 찾아 [시작, 끝, payload]로 넘긴다. */
function runAutomaton(
  ac: Automaton,
  text: string,
  report: (start: number, end: number, payload: number) => void,
) {
  let st = 0;
  for (let j = 0; j < text.length; j++) {
    const a = ac.alpha.get(text.charCodeAt(j));
    if (a === undefined) {
      st = 0;
      continue;
    }
    let nx = ac.next.get(st * ac.alphaSize + a);
    while (nx === undefined && st !== 0) {
      st = ac.fail[st] ?? 0;
      nx = ac.next.get(st * ac.alphaSize + a);
    }
    st = nx ?? 0;
    const outs = ac.out[st];
    if (outs) {
      for (const id of outs) report(j + 1 - (ac.lens[id] ?? 0), j + 1, ac.payload[id] ?? 0);
    }
  }
}

const SEVERITY: Readonly<Record<LexGrade, number>> = { A: 3, C: 2, B: 1 };
/** 같은 구간·같은 등급이면 이 순서로 앞선 분류를 남긴다(R-01·G-09가 더 쓸모 있는 신호). */
const CATEGORY_ORDER: readonly LexCategory[] = [
  'selfharm',
  'danger',
  'risk_signal',
  'sexual',
  'hate',
  'profanity',
];

interface Dictionary {
  readonly entries: readonly Entry[];
  /** 음절·영타 보기: main 낱말 + 허용어(공백 그대로) */
  readonly syll: Automaton;
  /** 압축 보기: main 낱말 + 구절(공백 뺀 것) + 허용어(공백 뺀 것) */
  readonly comp: Automaton;
  /** 기본 보기: 로마자·숫자가 든 낱말 */
  readonly raw: Automaton;
  /** 초성 보기: 자음 자모만인 낱말 + 초성 허용어 */
  readonly cho: Automaton;
}

const isChosungOnly = (s: string) => s.length > 0 && [...s].every(ch => isConsonantJamo(ch.charCodeAt(0)));
const RAW_CHARS = /[a-z0-9]/;

/** 사전 만들기(모듈을 불러올 때 한 번). 같은 열쇠가 여러 출처에 있으면 더 무거운 등급을 남긴다. */
function buildDictionary(): Dictionary {
  const entries: Entry[] = [];
  /** 종류+열쇠 → entries 번호 */
  const byKey = new Map<string, number>();
  const put = (kind: Kind, key: string, e: Entry) => {
    const id = `${kind}:${key}`;
    const prev = byKey.get(id);
    if (prev === undefined) {
      byKey.set(id, entries.length);
      entries.push(e);
      return;
    }
    // 사전에 적힌 꼴 그대로인 낱말이 자모로 쓴 꼴보다 앞선다("ㅅㅐ끼"(A)가 "새끼"(B)를 덮지 않게).
    const old = entries[prev];
    if (!old) return;
    if (old.canonical !== e.canonical) {
      if (e.canonical) entries[prev] = e;
      return;
    }
    if (SEVERITY[e.grade] > SEVERITY[old.grade]) entries[prev] = e;
  };
  const allowSyll: string[] = [];
  const allowComp: string[] = [];
  const allowCho: string[] = [];

  for (const src of LEXICON_SOURCES) {
    for (const group of src.groups) {
      for (const body of group.terms) {
        const base = {
          grade: group.grade,
          category: group.category,
          wordStart: group.wordStart === true,
          source: src.name,
        };
        if (/\s/.test(body)) {
          const key = syllableKey(body).replace(/ /g, '');
          // 구절은 압축 보기에서 띄어쓰기를 무시하고 찾으므로 첫머리를 고정한다("혼자 살 방법" 안의 "자살 방법" 오탐 방지).
          put('phrase', key, {
            ...base,
            wordStart: true,
            kind: 'phrase',
            canonical: key === body.replace(/\s/g, ''),
          });
        } else if (isChosungOnly(body)) {
          put('cho', body, { ...base, kind: 'cho', canonical: true });
        } else if (RAW_CHARS.test(baseKey(body))) {
          const key = baseKey(body);
          put('raw', key, { ...base, kind: 'raw', canonical: key === body });
        } else {
          const key = syllableKey(body);
          // 여러 글자로 적은 낱말이 한 음절로 줄면(예: 자모 "ㅆㅣ" → "씨") 일상 음절을 막게 되므로 넣지 않는다.
          if ([...key].length < 2 && [...body].length >= 2) continue;
          put('main', key, { ...base, kind: 'main', canonical: key === body });
        }
      }
    }
    for (const word of src.allow) {
      if (isChosungOnly(word)) {
        allowCho.push(word);
        continue;
      }
      const k = syllableKey(word);
      allowSyll.push(k);
      allowComp.push(k.replace(/ /g, ''));
    }
  }

  const syll = new AutomatonBuilder();
  const comp = new AutomatonBuilder();
  const raw = new AutomatonBuilder();
  const cho = new AutomatonBuilder();
  for (const [id, idx] of byKey) {
    const colon = id.indexOf(':');
    const kind = id.slice(0, colon) as Kind;
    const key = id.slice(colon + 1);
    if (kind === 'main') {
      syll.add(key, idx);
      comp.add(key, idx);
    } else if (kind === 'phrase') {
      comp.add(key, idx);
    } else if (kind === 'raw') {
      raw.add(key, idx);
    } else {
      cho.add(key, idx);
    }
  }
  // 허용어는 어느 것이 맞았는지 몰라도 되므로 열쇠마다 하나만 넣는다.
  [...new Set(allowSyll)].forEach((k, i) => syll.add(k, -(i + 1)));
  [...new Set(allowComp)].forEach((k, i) => comp.add(k, -(i + 1)));
  [...new Set(allowCho)].forEach((k, i) => cho.add(k, -(i + 1)));
  return { entries, syll: syll.build(), comp: comp.build(), raw: raw.build(), cho: cho.build() };
}

const DICT = buildDictionary();

/** 기본 보기 좌표 기준 일치 */
interface RawHit {
  readonly bs: number;
  readonly be: number;
  readonly entry: Entry;
  /** 압축 보기에서만 생긴 일치(여러 덩어리에 걸침) */
  readonly fromComp: boolean;
}
interface AllowSpan {
  readonly bs: number;
  readonly be: number;
  /**
   * 압축 보기에서만 생긴 일치도 취소할 수 있는가: 음절 보기에서 글자 그대로(띄어쓰기까지) 맞았거나,
   * 압축 보기에서 맞았어도 원문 한 어절 안(공백을 건너지 않음)일 때. 압축으로 이어 붙여 생긴 허용어로는 취소하지 않는다.
   */
  readonly coversComp: boolean;
}

const SPACE = 0x20;
const isAsciiAlnum = (c: number) => (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a);

function boundaryOk(base: BaseView, bs: number, e: Entry): boolean {
  return !(e.wordStart && bs > 0 && isHangul(base.text.charCodeAt(bs - 1)));
}

/**
 * 압축 보기 일치의 모서리 규칙: 덩어리(공백·기호로 나뉜 한글 묶음) 가운데에서 시작하거나 끝나면
 * 그 덩어리에서 EDGE_MIN_COVER칸 이상 덮어야 한다. "시 발"·"개 새끼야"는 잡고 "다시 발로"·"몇 시 발표"는 놓아준다.
 * 한 덩어리 안에서 끝나는 일치는 음절 보기가 이미 봤으므로 버린다(null).
 */
function compEdgeOk(view: CompressedView, bs: number, be: number): boolean | null {
  const ps = view.pieceStart[bs] ?? -1;
  const pe = view.pieceEnd[bs] ?? -1;
  if (ps < 0) return false;
  if (pe >= be) return null;
  if (ps < bs && pe - bs < EDGE_MIN_COVER) return false;
  const qs = view.pieceStart[be - 1] ?? -1;
  const qe = view.pieceEnd[be - 1] ?? -1;
  if (qs < 0) return false;
  if (qe > be && be - qs < EDGE_MIN_COVER) return false;
  return true;
}

function collect(
  ac: Automaton,
  view: DerivedView,
  onHit: (bs: number, be: number, entryIdx: number) => void,
  onAllow: (bs: number, be: number) => void,
) {
  runAutomaton(ac, view.text, (s, e, payload) => {
    const bs = view.srcStart[s] ?? 0;
    const be = view.srcEnd[e - 1] ?? 0;
    if (isAllowPayload(payload)) onAllow(bs, be);
    else onHit(bs, be, payload);
  });
}

/** 보기에서 기본 보기 구간 [bs, be)에 든 칸 수 */
function countUnits(view: DerivedView, bs: number, be: number): number {
  let n = 0;
  for (let k = 0; k < view.srcStart.length; k++) {
    if ((view.srcStart[k] ?? 0) >= bs && (view.srcEnd[k] ?? 0) <= be) n++;
  }
  return n;
}

function hasSpace(base: BaseView, bs: number, be: number): boolean {
  for (let k = bs; k < be; k++) if (base.text.charCodeAt(k) === SPACE) return true;
  return false;
}

/** 원문 전체 검사. 같은 구간 중복은 합친다. 허용 목록(구간 포함 방식) 적용 뒤 결과. */
export function scanText(text: string): LexHit[] {
  if (text.length === 0) return [];
  const base = toBaseView(text);
  const hits: RawHit[] = [];
  const allows: AllowSpan[] = [];
  const entryAt = (idx: number) => DICT.entries[idx];
  const addLiteralAllow = (bs: number, be: number) => allows.push({ bs, be, coversComp: true });
  const addCompAllow = (bs: number, be: number) =>
    allows.push({ bs, be, coversComp: !hasSpace(base, bs, be) });

  // 음절 보기(원문 그대로인 글도 여기서 본다)
  const syll = toSyllableView(base);
  collect(
    DICT.syll,
    syll,
    (bs, be, idx) => {
      const e = entryAt(idx);
      if (e && boundaryOk(base, bs, e)) hits.push({ bs, be, entry: e, fromComp: false });
    },
    addLiteralAllow,
  );

  // 압축 보기: B(문맥 필요) 낱말은 원문·음절 보기에서만 본다(4절 등급 B). 구절은 압축 보기에서만 찾는다.
  const comp = toCompressedView(base);
  collect(
    DICT.comp,
    comp,
    (bs, be, idx) => {
      const e = entryAt(idx);
      if (!e || !boundaryOk(base, bs, e)) return;
      if (e.kind === 'phrase') {
        hits.push({ bs, be, entry: e, fromComp: false });
        return;
      }
      if (e.grade === 'B') return;
      if (compEdgeOk(comp, bs, be) === true) hits.push({ bs, be, entry: e, fromComp: true });
    },
    addCompAllow,
  );

  // 기본 보기: 로마자·숫자 낱말. 더 긴 로마자·숫자 낱말 안이면 버린다("isexcluded" 안의 "sex", "2018놈").
  runAutomaton(DICT.raw, base.text, (bs, be, payload) => {
    const e = entryAt(payload);
    if (!e || !boundaryOk(base, bs, e)) return;
    const t = base.text;
    if (isAsciiAlnum(t.charCodeAt(bs)) && bs > 0 && isAsciiAlnum(t.charCodeAt(bs - 1))) return;
    if (isAsciiAlnum(t.charCodeAt(be - 1)) && be < t.length && isAsciiAlnum(t.charCodeAt(be))) return;
    hits.push({ bs, be, entry: e, fromComp: false });
  });

  // 초성 보기
  const cho = toChosungView(base);
  collect(
    DICT.cho,
    cho,
    (bs, be, idx) => {
      const e = entryAt(idx);
      if (e && e.grade !== 'B') hits.push({ bs, be, entry: e, fromComp: false });
    },
    addLiteralAllow,
  );

  // 영타 보기
  const eng = toDubeolsikView(base);
  if (eng) {
    collect(
      DICT.syll,
      eng,
      (bs, be, idx) => {
        const e = entryAt(idx);
        // 영어 낱말이 우연히 만드는 일치를 줄인다: 한 음절 낱말은 보지 않고("wheel" → "졷디"),
        // 로마자 덩어리 첫머리에서 시작할 때만("amatorial" 가운데의 "tori" → "새갸").
        if (!e || e.grade === 'B' || !boundaryOk(base, bs, e)) return;
        if (bs > 0 && isAsciiAlnum(base.text.charCodeAt(bs - 1))) return;
        if (countUnits(eng, bs, be) < 2) return;
        hits.push({ bs, be, entry: e, fromComp: false });
      },
      () => undefined,
    );
  }

  if (hits.length === 0) return [];
  // 허용어(구간 포함 방식): 허용어 구간 안에 완전히 들 때만 취소. 압축 보기에서만 생긴 일치는 coversComp인 허용어만.
  const kept = hits.filter(
    h => !allows.some(a => a.bs <= h.bs && h.be <= a.be && (!h.fromComp || a.coversComp)),
  );
  return mergeHits(
    kept.map(h => ({
      start: base.origStart[h.bs] ?? 0,
      end: base.origEnd[h.be - 1] ?? 0,
      grade: h.entry.grade,
      category: h.entry.category,
    })),
  );
}

const rank = (h: LexHit) =>
  SEVERITY[h.grade] * 10 + (CATEGORY_ORDER.length - CATEGORY_ORDER.indexOf(h.category));

/**
 * 겹친 일치 정리: 같은 구간은 가장 무거운 것 하나, 더 무겁거나 같은 일치 안에 든 것은 버림,
 * 같은 등급·분류끼리 겹치면(맞닿기만 한 것은 따로) 합친다. 시작 위치 순서.
 */
function mergeHits(list: LexHit[]): LexHit[] {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end || rank(b) - rank(a));
  const unique: LexHit[] = [];
  for (const h of sorted) {
    const covered = unique.some(
      u => u.start <= h.start && h.end <= u.end && SEVERITY[u.grade] >= SEVERITY[h.grade],
    );
    if (!covered) unique.push(h);
  }
  // 나중에 온 더 무거운 일치가 앞의 가벼운 일치를 덮는 경우도 버린다.
  const filtered = unique.filter(
    h =>
      !unique.some(
        u => u !== h && u.start <= h.start && h.end <= u.end && SEVERITY[u.grade] > SEVERITY[h.grade],
      ),
  );
  const merged: LexHit[] = [];
  for (const h of filtered) {
    const last = merged.findLast(m => m.grade === h.grade && m.category === h.category && m.end > h.start);
    if (last) {
      const idx = merged.indexOf(last);
      merged[idx] = { ...last, end: Math.max(last.end, h.end) };
    } else {
      merged.push(h);
    }
  }
  return merged.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** 학생 원문의 A·C 등급 구간을 ⟦가림N⟧으로 바꾼다(N은 1부터). 대응은 요청 안에서만 쓴다. */
export function maskStudentProfanity(text: string): {
  masked: string;
  spans: { token: string; start: number; end: number }[];
} {
  const hits = scanText(text).filter(h => h.grade === 'A' || h.grade === 'C');
  if (hits.length === 0) return { masked: text, spans: [] };
  // 겹치는 구간은 하나로 가린다(등급·분류가 달라도).
  const ranges: { start: number; end: number }[] = [];
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    const last = ranges[ranges.length - 1];
    if (last && h.start < last.end) last.end = Math.max(last.end, h.end);
    else ranges.push({ start: h.start, end: h.end });
  }
  let masked = '';
  let cursor = 0;
  const spans = ranges.map((r, i) => {
    const token = `⟦가림${i + 1}⟧`;
    masked += text.slice(cursor, r.start) + token;
    cursor = r.end;
    return { token, start: r.start, end: r.end };
  });
  masked += text.slice(cursor);
  return { masked, spans };
}

/** 시험·보고용: 출처별 등급·분류 낱말 수(중복을 합친 뒤). */
export function lexiconStats(): {
  source: string;
  kind: string;
  grade: LexGrade;
  category: LexCategory;
  count: number;
}[] {
  const counts = new Map<string, number>();
  for (const e of DICT.entries) {
    const k = `${e.source}|${e.kind}|${e.grade}|${e.category}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, count]) => {
    const [source = '', kind = '', grade = 'A', category = 'profanity'] = k.split('|');
    return { source, kind, grade: grade as LexGrade, category: category as LexCategory, count };
  });
}
