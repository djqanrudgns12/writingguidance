import { describe, expect, it } from 'vitest';
import { errorCatalog, errorCodes } from '../errors.ts';
import { ko } from './ko.ts';

const STUDENT_JARGON_TERMS = ['서버', '동기화', '브라우저', '버전', '오류 코드', '에러'] as const;
const EMOJI_RE = /\p{Emoji_Presentation}|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/** 묶음 안의 문구를 `키.안쪽키` 경로와 함께 펼친다(근거 이름표처럼 안쪽 묶음이 있는 키). 문자열·묶음이 아닌 값은 그대로 둔다. */
function leaves(section: object, prefix = ''): [string, unknown][] {
  return Object.entries(section).flatMap(([key, value]): [string, unknown][] =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? leaves(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

describe('copy/ko 화면 문구 규칙', () => {
  it('common·student·teacher 묶음의 모든 문자열(안쪽 묶음 포함)은 비어 있지 않다', () => {
    for (const section of [ko.common, ko.student, ko.teacher] as const) {
      for (const [key, value] of leaves(section)) {
        expect(typeof value, key).toBe('string');
        expect(String(value).trim().length, `${key} 빈 문자열`).toBeGreaterThan(0);
      }
    }
  });

  it('errors 묶음은 silent 코드와 칸별 안내(E_INPUT)만 비워 두고 나머지는 문구를 둔다', () => {
    expect(Object.keys(ko.errors).sort()).toEqual([...errorCodes].sort());
    for (const code of errorCodes) {
      const msg = ko.errors[code];
      if (errorCatalog[code].silent || code === 'E_INPUT') {
        expect(msg, `${code}는 빈 문자열이어야 함`).toBe('');
      } else {
        expect(msg.trim().length, `${code}는 안내 문구가 있어야 함`).toBeGreaterThan(0);
      }
    }
  });

  it('학생에게 보일 수 있는 common·student·errors 문구에는 기술 용어가 없다', () => {
    for (const [sectionName, section] of [
      ['common', ko.common],
      ['student', ko.student],
      ['errors', ko.errors],
    ] as const) {
      for (const [key, value] of leaves(section)) {
        for (const jargon of STUDENT_JARGON_TERMS) {
          expect(
            String(value).includes(jargon),
            `ko.${sectionName}.${key}에 금지 용어 '${jargon}' 포함: ${String(value)}`,
          ).toBe(false);
        }
      }
    }
  });

  it('모든 문구 묶음에 이모지가 들어 있지 않다', () => {
    const collectStrings = (obj: unknown): string[] => {
      if (typeof obj === 'string') return [obj];
      if (Array.isArray(obj)) return obj.flatMap(collectStrings);
      if (obj !== null && typeof obj === 'object') {
        return Object.values(obj).flatMap(collectStrings);
      }
      return [];
    };

    for (const text of collectStrings(ko)) {
      expect(EMOJI_RE.test(text), `이모지 포함 문구: ${text}`).toBe(false);
    }
  });
});
