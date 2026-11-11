import { polishLineSchema, type PolishLine } from '@geulbang/core/api';

/**
 * 다듬은 글 스트림 읽기(PLAN §8.6). NDJSON 줄을 읽어 하나씩 돌려준다. 모르는 줄·깨진 줄은 건너뛴다.
 * 중간에 끊기면 그때까지 받은 줄만 돌려주고 끝난다(화면: 받은 데까지 보이고 `다시 받기`).
 */
export async function* readPolishLines(body: ReadableStream<Uint8Array>): AsyncGenerator<PolishLine> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        const parsed = parseLine(line);
        if (parsed) yield parsed;
        nl = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    const last = parseLine(buffer.trim());
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

function parseLine(line: string): PolishLine | null {
  if (!line) return null;
  try {
    const r = polishLineSchema.safeParse(JSON.parse(line));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** 줄들을 화면에 보일 글 하나로 접는다(`reset`이면 처음부터). */
export function foldPolish(lines: readonly PolishLine[]): {
  text: string;
  stop: 'end' | 'limit' | null;
  error: string | null;
} {
  let text = '';
  let stop: 'end' | 'limit' | null = null;
  let error: string | null = null;
  for (const l of lines) {
    if (l.t === 'text') text += l.d;
    else if (l.t === 'reset') text = '';
    else if (l.t === 'done') stop = l.stop;
    else error = l.code;
  }
  return { text, stop, error };
}
