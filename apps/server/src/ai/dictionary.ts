import type { Config } from '@geulbang/core/config';

/**
 * 표준국어대사전 Open API(https://stdict.korean.go.kr/api/search.do, CC BY-SA 2.0 KR) 조회기(U-25, docs/ai-harness.md 5절).
 * - 학생 글 전체가 아니라 **낱말 하나**만 보낸다. 결과는 판정 근거로만 쓰고 사전 내용을 화면에 옮기지 않는다.
 * - 응답 모양(2026-11-13 실제 응답으로 확인): 비표준어는 모든 뜻풀이가 "→ 표준어."로 시작한다(몇일 → 며칠).
 *   사전에 없는 말은 빈 본문이 온다. 오류는 `{"error":{"error_code","message"}}`.
 * - 느리거나 막혀도 맞춤법 결과는 그대로 나가야 하므로, 모든 실패는 `unknown`(보정 없음)으로 끝낸다.
 */
export type DictVerdict =
  | { readonly kind: 'nonstandard'; readonly to: string }
  | { readonly kind: 'standard' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unknown' };

export interface DictionaryPort {
  lookup(word: string, signal: AbortSignal): Promise<DictVerdict>;
}

type DictConfig = Pick<Config, 'DICT_TIMEOUT_MS' | 'DICT_LOOKUPS_PER_DAY' | 'DICT_CACHE_SIZE' | 'TIMEZONE'>;

export interface StdictDeps {
  readonly key: string;
  readonly config: DictConfig;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** 실패 종류만 남긴다(낱말·키 없음) */
  readonly onError?: (code: string) => void;
}

const ENDPOINT = 'https://stdict.korean.go.kr/api/search.do';
const HANGUL_WORD = /^[가-힣]{1,20}$/;

interface Sense {
  readonly definition?: unknown;
}

/** 응답 본문 → 판정. 테스트에서 쓰려고 내보낸다. */
export function parseStdict(body: string): DictVerdict {
  if (body.trim().length === 0) return { kind: 'absent' };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { kind: 'unknown' };
  }
  if (typeof json !== 'object' || json === null) return { kind: 'unknown' };
  if ('error' in json) return { kind: 'unknown' };
  const channel = (json as { channel?: { item?: unknown } }).channel;
  const items = Array.isArray(channel?.item) ? channel.item : channel?.item ? [channel.item] : [];
  if (items.length === 0) return { kind: 'absent' };
  const definitions: string[] = [];
  for (const item of items as { sense?: Sense | Sense[] }[]) {
    const senses = Array.isArray(item.sense) ? item.sense : item.sense ? [item.sense] : [];
    for (const s of senses) if (typeof s.definition === 'string') definitions.push(s.definition.trim());
  }
  if (definitions.length === 0) return { kind: 'unknown' };
  const arrows = definitions.filter(d => d.startsWith('→'));
  if (arrows.length === definitions.length) {
    const to = (arrows[0] ?? '')
      .replace(/^→\s*/, '')
      .replace(/[.。]\s*$/, '')
      .trim();
    return to.length > 0 ? { kind: 'nonstandard', to } : { kind: 'unknown' };
  }
  return { kind: 'standard' };
}

export function createStdictDictionary(deps: StdictDeps): DictionaryPort {
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const now = deps.now ?? Date.now;
  const cache = new Map<string, DictVerdict>();
  let day = '';
  let used = 0;

  const remember = (word: string, v: DictVerdict) => {
    if (v.kind === 'unknown') return; // 일시 실패는 기억하지 않는다
    cache.delete(word);
    cache.set(word, v);
    while (cache.size > deps.config.DICT_CACHE_SIZE) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  return {
    async lookup(word, signal) {
      if (!HANGUL_WORD.test(word)) return { kind: 'unknown' };
      const hit = cache.get(word);
      if (hit) {
        cache.delete(word);
        cache.set(word, hit);
        return hit;
      }
      const today = new Date(now()).toLocaleDateString('sv-SE', { timeZone: deps.config.TIMEZONE });
      if (today !== day) {
        day = today;
        used = 0;
      }
      if (used >= deps.config.DICT_LOOKUPS_PER_DAY) return { kind: 'unknown' };
      used += 1;
      const url = new URL(ENDPOINT);
      url.search = new URLSearchParams({ key: deps.key, q: word, req_type: 'json', num: '10' }).toString();
      try {
        const res = await doFetch(url, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(deps.config.DICT_TIMEOUT_MS)]),
        });
        if (!res.ok) {
          deps.onError?.(`http_${res.status}`);
          return { kind: 'unknown' };
        }
        const verdict = parseStdict(await res.text());
        if (verdict.kind === 'unknown') deps.onError?.('parse');
        remember(word, verdict);
        return verdict;
      } catch (error) {
        deps.onError?.(error instanceof Error ? error.name : 'fetch');
        return { kind: 'unknown' };
      }
    },
  };
}
