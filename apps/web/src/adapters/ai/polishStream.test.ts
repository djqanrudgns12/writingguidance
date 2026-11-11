import { describe, expect, it } from 'vitest';
import { foldPolish, readPolishLines } from './polishStream.ts';

const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
      c.close();
    },
  });

describe('다듬은 글 스트림', () => {
  it('조각난 줄을 이어 읽고 깨진 줄은 건너뛴다', async () => {
    const lines = [];
    for await (const l of readPolishLines(
      streamOf(
        '{"t":"text","d":"안',
        '녕"}\n{"t":"res',
        'et"}\nnot json\n{"t":"text","d":"하세요"}\n{"t":"done","stop":"end"}',
      ),
    ))
      lines.push(l);
    expect(lines.map(l => l.t)).toEqual(['text', 'reset', 'text', 'done']);
    expect(foldPolish(lines)).toEqual({ text: '하세요', stop: 'end', error: null });
  });
});
