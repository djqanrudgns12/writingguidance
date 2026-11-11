/**
 * 맞춤법 조각 나누기(PLAN §8.2-6, PRD F-26): 글이 `AI_SPELL_CHUNK_CHARS`를 넘으면 **문단 경계**로 그 이하 조각으로 나눈다.
 * 한 문단이 조각보다 길면 그 안의 마지막 공백에서, 공백도 없으면 길이에서 자른다. 조각을 이으면 원래 글과 같다
 * (맞춤법 `original`을 원래 글에서 찾을 수 있게 글자를 바꾸지 않는다).
 */
export function chunkForSpell(text: string, max: number): string[] {
  if (text.length === 0) return [];
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let current = '';
  const push = () => {
    if (current.length > 0) chunks.push(current);
    current = '';
  };
  // 줄바꿈을 문단 끝에 붙인 채로 나눈다.
  for (const paragraph of text.split(/(?<=\n)/u)) {
    if (paragraph.length > max) {
      push();
      chunks.push(...splitLong(paragraph, max));
    } else if (current.length + paragraph.length > max) {
      push();
      current = paragraph;
    } else {
      current += paragraph;
    }
  }
  push();
  return chunks;
}

function splitLong(paragraph: string, max: number): string[] {
  const out: string[] = [];
  let rest = paragraph;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const space = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\t'));
    const cut = space > 0 ? space + 1 : max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

/**
 * 동시에 `parallel`개까지만 돌리며 순서대로 결과를 모은다. 하나라도 실패하면 그 실패로 끝내고,
 * 남은 항목은 새로 시작하지 않는다(돌고 있는 것은 부르는 쪽이 신호로 멈춘다).
 */
export async function mapLimited<T, R>(
  items: readonly T[],
  parallel: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, items.length)) }, worker));
  return results;
}
