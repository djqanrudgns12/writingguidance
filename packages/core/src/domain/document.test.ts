import { describe, expect, it } from 'vitest';
import { countChars, DOC_KEYS, DOC_META_KEYS, DOC_ROOT_KEYS, isValidMemoKey } from './document.ts';

describe('document keys & memo keys', () => {
  it('최상위 Y.Doc 키 네 종류와 메타 키 일곱 종류를 고정한다', () => {
    expect(DOC_ROOT_KEYS).toEqual(['body', 'title', 'meta', 'memo']);
    expect(Object.keys(DOC_KEYS)).toHaveLength(4);
    expect(Object.values(DOC_META_KEYS)).toEqual([
      'subtype',
      'purpose',
      'purposeCustom',
      'mood',
      'moodCustom',
      'tempo',
      'cutCount',
    ]);
  });

  it('메모 키는 영문 소문자·숫자·밑줄·붙임표 1~32자만 허용한다', () => {
    expect(isValidMemoKey('a')).toBe(true);
    expect(isValidMemoKey('story_when_where-1')).toBe(true);
    expect(isValidMemoKey('a'.repeat(32))).toBe(true);

    expect(isValidMemoKey('')).toBe(false);
    expect(isValidMemoKey('a'.repeat(33))).toBe(false);
    expect(isValidMemoKey('Story_Who')).toBe(false);
    expect(isValidMemoKey('한글키')).toBe(false);
    expect(isValidMemoKey('story.who')).toBe(false);
  });
});

describe('countChars', () => {
  it('줄바꿈(\\n, \\r\\n)은 빼고 한글 음절과 서로게이트 쌍 문자를 각각 1자로 센다', () => {
    expect(countChars('')).toBe(0);
    expect(countChars('\n\r\n')).toBe(0);
    expect(countChars('가나다\n라마\r\n바')).toBe(6);
    // U+1F433(고래, 서로게이트 쌍 2 UTF-16 코드 유닛)도 코드 포인트 1자로 계산한다.
    expect(countChars('하늘\u{1F433}')).toBe(3);
  });
});
