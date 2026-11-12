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

/** 같은 값은 같은 자리표시자를 쓴다(다듬은 글에서 되돌릴 때 순서가 바뀌어도 맞게). */
export function maskPii(text: string): PiiMasked {
  const spans: PiiSpan[] = [];
  const counters: Record<PiiKind, number> = { phone: 0, email: 0, rrn: 0, url: 0 };
  let out = text;
  for (const { kind, re } of PATTERNS) {
    out = out.replace(re, value => {
      const seen = spans.find(s => s.kind === kind && s.value === value);
      if (seen) return seen.token;
      counters[kind] += 1;
      const token = tokenOf(kind, counters[kind]);
      spans.push({ kind, token, value });
      return token;
    });
  }
  return { text: out, spans };
}

/** 응답에서 자리표시자를 원래 값으로 되돌린다(다듬은 글: 학생 자신의 글이므로). */
export function restorePii(text: string, spans: readonly PiiSpan[]): string {
  let out = text;
  for (const s of spans) out = out.split(s.token).join(s.value);
  return out;
}

/** 응답에서 자리표시자를 종류 이름으로 바꾼다(한마디·방향: 학생 개인정보를 AI 말로 되풀이하지 않게). */
export function namePii(
  text: string,
  spans: readonly PiiSpan[],
  names: Readonly<Record<PiiKind, string>>,
): string {
  let out = text;
  for (const s of spans) out = out.split(s.token).join(names[s.kind]);
  return out;
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
