import { AiCallError } from '../port.ts';
import { scanText } from './lexicon.ts';
import { checkGenerated } from './outputGuard.ts';

/**
 * 다듬은 글 스트림의 문장 단위 지연 공개(docs/ai-harness.md PO-01·PO-03·PO-05).
 * - 문장 끝(마침표·물음표·느낌표·줄바꿈)까지 모은 뒤, 앞 문장 끝 일부를 겹쳐 검사해 통과한 부분만 내보낸다.
 * - 끝나면 남은 조각과 전문을 한 번 더 검사한다(문장 경계에 걸친 표현).
 * - 원문 글자 수의 1.6배(+여유)를 넘으면 끝없는 글로 보고 끊는다.
 * 걸리면 `AiCallError('unsafe', 규칙)`를 던진다. 부른 쪽(`runPolish`)이 지우기(`reset`)와 재시도를 맡는다.
 */
const BOUNDARY = /[.!?。\n](?=[^.!?。\n]*$)/;
const OVERLAP = 20;
const MAX_RATIO = 1.6;
const MAX_SLACK = 80;

export class PolishGate {
  private pending = '';
  private sent = '';
  private readonly maxChars: number;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
    this.maxChars = Math.ceil([...source].length * MAX_RATIO) + MAX_SLACK;
  }

  /** 조각을 받아 지금 내보내도 되는 앞부분(없으면 빈 문자열)을 돌려준다. */
  push(piece: string): string {
    this.pending += piece;
    if ([...this.sent].length + [...this.pending].length > this.maxChars) {
      throw new AiCallError('unsafe', 'PO03');
    }
    const m = BOUNDARY.exec(this.pending);
    if (!m) return '';
    const cut = m.index + 1;
    const ready = this.pending.slice(0, cut);
    this.check(ready);
    this.pending = this.pending.slice(cut);
    this.sent += ready;
    return ready;
  }

  /** 스트림이 끝났을 때: 남은 조각을 검사해 돌려주고, 전문을 한 번 더 본다. */
  finish(): string {
    const rest = this.pending;
    if (rest.length > 0) this.check(rest);
    this.pending = '';
    const full = this.sent + rest;
    // 전문 사전 검사(문장 경계에 걸쳐 나뉜 표현). 학생 원문에 같은 분류가 있던 B 등급은 checkGenerated가 이미 허용했다.
    const rule = checkGenerated(full, { source: this.source, speech: false });
    if (rule) throw new AiCallError('unsafe', rule);
    this.sent = full;
    return rest;
  }

  private check(chunk: string): void {
    const tail = [...this.sent].slice(-OVERLAP).join('');
    const rule = checkGenerated(chunk, { source: this.source, speech: false });
    if (rule) throw new AiCallError('unsafe', rule);
    // 겹친 부분: 앞 문장 끝과 이어 붙였을 때만 생기는 사전 일치(경계에 걸친 비속어).
    if (tail.length > 0) {
      const joined = tail + chunk;
      const hits = scanText(joined).filter(h => h.start < tail.length && h.end > tail.length);
      if (hits.some(h => h.grade !== 'B')) throw new AiCallError('unsafe', 'G01');
    }
  }
}
