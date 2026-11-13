/**
 * 개인정보 가림(docs/ai-harness.md L0 P-01).
 * 형식이 정해진 식별자(전화·주민번호 꼴·이메일·웹 주소)만 자리표시자로 바꿔 AI에 보낸다. 이름·학교·주소 문장은
 * 정규식으로 확실히 잡지 못해 가리지 않는다(잘못 가리면 학생 글이 망가진다). 대응표는 요청 하나에서만 쓰고 저장하지 않는다.
 */
export type PiiKind = 'phone' | 'email' | 'rrn' | 'url';

export interface PiiSpan {
  readonly kind: PiiKind;
  readonly token: string;
  readonly value: string;
}

const LABEL: Readonly<Record<PiiKind, string>> = {
  phone: '전화번호',
  email: '이메일',
  rrn: '주민번호',
  url: '주소',
};

// 순서가 중요하다: 주민번호 꼴(13자리)을 전화번호보다 먼저 본다. 숫자 사이 하이픈·점·공백 한 칸을 허용한다.
const PATTERNS: readonly { readonly kind: PiiKind; readonly re: RegExp }[] = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'url', re: /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi },
  { kind: 'rrn', re: /(?<!\d)\d{6}\s?[-–]\s?[1-8]\d{6}(?!\d)/g },
  { kind: 'phone', re: /(?<!\d)(?:01[016789]|0[2-6][0-9]?)[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g },
];

/** `[전화번호1]` 꼴. 학생 글에 같은 꼴이 이미 있으면(드묾) 그것도 자리표시자로 보일 수 있어 괄호 모양을 특이하게 둔다. */
const tokenOf = (kind: PiiKind, n: number) => `[${LABEL[kind]}${n}]`;

export interface PiiMasked {
  readonly text: string;
  readonly spans: readonly PiiSpan[];
}

/**
 * 같은 값은 같은 자리표시자를 쓴다(다듬은 글에서 되돌릴 때 순서가 바뀌어도 맞게).
 * `prior`: 같은 요청의 앞서 가린 대응표(본문 → 도움 메모). 번호를 이어 매겨 한 요청 안에서 토큰이 겹치지 않게 한다.
 */
export function maskPii(text: string, prior: readonly PiiSpan[] = []): PiiMasked {
  const spans: PiiSpan[] = [...prior];
  const counters: Record<PiiKind, number> = { phone: 0, email: 0, rrn: 0, url: 0 };
  for (const s of prior) counters[s.kind] += 1;
  // 원문에서 모든 꼴을 찾은 뒤 겹치지 않게 고른다(앞선 것, 같은 자리면 긴 것). 차례로 바꾸면 주소 안의 이메일처럼
  // 토큰이 다른 토큰 값 안에 들어가 되돌릴 때 풀리지 않는다(2026-11-13 Codex 재검토 2).
  const found: { kind: PiiKind; start: number; end: number; rank: number }[] = [];
  PATTERNS.forEach(({ kind, re }, rank) => {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) found.push({ kind, start: m.index, end: m.index + m[0].length, rank });
  });
  found.sort((a, b) => a.start - b.start || b.end - a.end || a.rank - b.rank);
  let out = '';
  let at = 0;
  for (const f of found) {
    if (f.start < at) continue;
    const value = text.slice(f.start, f.end);
    let span = spans.find(s => s.kind === f.kind && s.value === value);
    if (!span) {
      counters[f.kind] += 1;
      span = { kind: f.kind, token: tokenOf(f.kind, counters[f.kind]), value };
      spans.push(span);
    }
    out += text.slice(at, f.start) + span.token;
    at = f.end;
  }
  return { text: out + text.slice(at), spans };
}

/** 우리 개인정보 자리표시자 꼴(`[전화번호1]`). 학생이 같은 꼴을 직접 썼으면 보내기 전에 괄호를 바꿔 둔다. */
export const PII_TOKEN_LIKE = /\[(전화번호|이메일|주민번호|주소)(\d+)\]/g;

/** 자리표시자를 한 번에 바꾼다(되돌린 값 안에 또 토큰 꼴이 있어도 다시 바꾸지 않게). */
function replaceTokens(text: string, spans: readonly PiiSpan[], to: (s: PiiSpan) => string): string {
  if (spans.length === 0) return text;
  const byToken = new Map(spans.map(s => [s.token, s]));
  const re = new RegExp(
    [...byToken.keys()].map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g',
  );
  return text.replace(re, t => {
    const s = byToken.get(t);
    return s ? to(s) : t;
  });
}

/** 응답에서 자리표시자를 원래 값으로 되돌린다(다듬은 글: 학생 자신의 글이므로). */
export function restorePii(text: string, spans: readonly PiiSpan[]): string {
  return replaceTokens(text, spans, s => s.value);
}

/** 응답에서 자리표시자를 종류 이름으로 바꾼다(한마디·방향: 학생 개인정보를 AI 말로 되풀이하지 않게). */
export function namePii(
  text: string,
  spans: readonly PiiSpan[],
  names: Readonly<Record<PiiKind, string>>,
): string {
  return replaceTokens(text, spans, s => names[s.kind]);
}

export const hasToken = (text: string, spans: readonly { readonly token: string }[]): boolean =>
  spans.some(s => text.includes(s.token));

/** 응답에 새로 생긴 개인정보 꼴(G-02). 자리표시자는 해당 없음. */
export function findPiiLike(text: string): PiiKind | null {
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) {
      re.lastIndex = 0;
      return kind;
    }
  }
  return null;
}
