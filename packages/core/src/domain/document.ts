/**
 * 글 문서 규칙(PLAN §4.2). Y.Doc 안의 정해진 키와 글자 수 세는 법.
 * 이 파일은 순수 함수만 둔다(Yjs를 가져오지 않는다). Yjs를 다루는 쪽이 이 이름과 규칙을 쓴다.
 */

/** `doc:*` Y.Doc의 최상위 키. 이 밖의 키가 생기면 서버가 그 편집을 받지 않는다(PLAN §4.7 대응 9). */
export const DOC_KEYS = {
  body: 'body',
  title: 'title',
  meta: 'meta',
  memo: 'memo',
} as const;

export const DOC_ROOT_KEYS: readonly string[] = Object.values(DOC_KEYS);

/** 메모 칸 키(도움 질문 ID) 모양. 질문 목록 자체는 `genres.ts`(P3-1)가 정한다. */
export const MEMO_KEY_PATTERN = /^[a-z0-9_-]{1,32}$/;

export function isValidMemoKey(key: string): boolean {
  return MEMO_KEY_PATTERN.test(key);
}

/** `doc:*` Y.Doc 안 `meta` 맵의 정해진 키(PLAN §4.2). */
export const DOC_META_KEYS = {
  subtype: 'subtype',
  purpose: 'purpose',
  purposeCustom: 'purposeCustom',
  mood: 'mood',
  moodCustom: 'moodCustom',
  tempo: 'tempo',
  cutCount: 'cutCount',
} as const;

/**
 * 화면에 보이는 "글자 수": 줄바꿈을 뺀 코드 포인트 수. 한글 한 음절은 1자, 이모지 같은 짝 문자도 1자.
 */
export function countChars(text: string): number {
  let n = 0;
  for (const ch of text) if (ch !== '\n' && ch !== '\r') n++;
  return n;
}
