import type { Config } from '@geulbang/core/config';
import { GENRE_CATALOG, isGenreId, isSongMoodId, isSongTempoId, SUBTYPE_IDS } from '@geulbang/core';

/**
 * 글 문서 `meta` 맵의 키와 값 규칙(PLAN §4.2). 학생이 고칠 수 있는 값이라 서버가 적용 전에 검사하고(precheck),
 * 이미 저장된 값을 요약·hello에 실을 때도 여기서 걸러 낸다(하나가 틀려 기기가 메시지 전체를 버리지 않게).
 */
export const META_KEYS = ['subtype', 'purposeCustom', 'mood', 'moodCustom', 'tempo', 'cutCount'] as const;
export type MetaKey = (typeof META_KEYS)[number];

const META_KEY_SET: ReadonlySet<string> = new Set(META_KEYS);

/** 그 글 종류의 하위 종류인가. 종류를 모르는 글(개발용 등)은 카탈로그 전체에서 찾는다. */
export function isSubtypeOf(genre: string | undefined, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (genre !== undefined && isGenreId(genre)) {
    return GENRE_CATALOG[genre].subtypes.some(s => s.id === value);
  }
  return (SUBTYPE_IDS as readonly string[]).includes(value);
}

/** hello·요약에 실을 하위 종류. 카탈로그에 없는 값은 null(받는 쪽 규약을 깨지 않게). */
export function knownSubtype(genre: string | undefined, value: unknown): string | null {
  return isSubtypeOf(genre, value) ? value : null;
}

/** 한 키의 값이 규칙에 맞는가. 지우기(null)는 늘 허용한다. */
export function isValidMetaEntry(
  key: string,
  value: unknown,
  genre: string | undefined,
  config: Pick<Config, 'DOC_TITLE_MAX_CHARS' | 'DOC_MAX_CHARS'>,
): boolean {
  if (!META_KEY_SET.has(key)) return false;
  if (value === null) return true;
  switch (key as MetaKey) {
    case 'subtype':
      return isSubtypeOf(genre, value);
    case 'mood':
      return isSongMoodId(value);
    case 'tempo':
      return isSongTempoId(value);
    case 'purposeCustom':
    case 'moodCustom':
      return typeof value === 'string' && value.length <= config.DOC_TITLE_MAX_CHARS && !/[\r\n]/.test(value);
    case 'cutCount':
      // 컷 하나에 머리말 한 줄은 있어야 하므로 본문 한도보다 클 수 없다.
      return (
        Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= config.DOC_MAX_CHARS
      );
  }
}
