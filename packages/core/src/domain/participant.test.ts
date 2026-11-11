import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareNicknames,
  containsForbiddenNickname,
  isValidNickname,
  nicknameKey,
  normalizeNickname,
  normalizeSchoolName,
  validateNickname,
} from './participant.ts';

describe('participant 별명 정규화·길이·금지어·비교 키', () => {
  it('앞뒤 공백·연속 공백·전각 문자·분해 한글 자모(NFD)를 하나로 정규화한다', () => {
    // '하늘'의 NFD 분해형 + 전각 공백(\u3000) + 전각 영숫자
    const nfdHaneul = '하늘'.normalize('NFD');
    expect(normalizeNickname(`  ${nfdHaneul}\u3000\tＡＢ１２  `)).toBe('하늘 AB12');
    expect(nicknameKey(`  ${nfdHaneul}\u3000\tＡＢ１２  `)).toBe('하늘 ab12');
  });

  it('별명 코드 포인트 길이 경계(0, 1, 12, 13자 및 서로게이트 쌍)를 검사한다', () => {
    expect(validateNickname('')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(validateNickname('   \u3000 ')).toEqual({ ok: false, reason: 'EMPTY' });

    const oneChar = validateNickname('별');
    expect(oneChar).toEqual({ ok: true, nickname: '별', nicknameKey: '별', length: 1 });

    const twelveChars = '가나다라마바사아자차카타';
    expect(validateNickname(twelveChars)).toEqual({
      ok: true,
      nickname: twelveChars,
      nicknameKey: twelveChars,
      length: 12,
    });

    expect(validateNickname(`${twelveChars}파`)).toEqual({ ok: false, reason: 'TOO_LONG' });

    // 서로게이트 쌍(U+1F433, UTF-16 길이 2이지만 코드 포인트 1자) 12개는 통과, 13개는 거절
    const whale = '\u{1F433}';
    expect(isValidNickname(whale.repeat(12))).toBe(true);
    expect(validateNickname(whale.repeat(13))).toEqual({ ok: false, reason: 'TOO_LONG' });

    // 설정값을 바꾸면 그 길이를 따른다.
    expect(isValidNickname('다섯글자별명', { NICKNAME_MAX_LENGTH: 5 })).toBe(false);
    expect(isValidNickname('다섯글자별', { NICKNAME_MAX_LENGTH: 5 })).toBe(true);
  });

  it('줄바꿈·탭·제로폭 문자 등 제어·서식 문자가 섞인 별명을 거부한다', () => {
    expect(validateNickname('하늘\n고래')).toEqual({ ok: false, reason: 'CONTROL_CHAR' });
    expect(validateNickname('하늘\t고래')).toEqual({ ok: false, reason: 'CONTROL_CHAR' });
    expect(validateNickname('하늘\u200B고래')).toEqual({ ok: false, reason: 'CONTROL_CHAR' });
    expect(validateNickname('하늘\u202E고래')).toEqual({ ok: false, reason: 'CONTROL_CHAR' });
  });

  it('욕설·자모 초성·영문 비속어 및 기호 끼워 넣기 우회를 막고 일상 어절 오탐은 피한다', () => {
    for (const bad of ['씨발', '시.발', 'ㅅ ㅂ', 'ㅂ_ㅅ', '개새끼', 'FuCk', 'f.u.c.k', '보지', 'sex']) {
      expect(containsForbiddenNickname(bad)).toBe(true);
      expect(validateNickname(bad)).toEqual({ ok: false, reason: 'FORBIDDEN' });
    }

    for (const good of ['하늘고래', '바보지킴이', '감자지짐', 'Essex', '시발점아닌출발점'.slice(4)]) {
      expect(containsForbiddenNickname(good)).toBe(false);
      expect(isValidNickname(good)).toBe(true);
    }
  });

  it('개인 모드 학교 이름은 공백을 빼고 초·초교 약칭을 초등학교로 통일한다', () => {
    const expected = '서울하늘초등학교';
    expect(normalizeSchoolName('서울 하늘 초등학교')).toBe(expected);
    expect(normalizeSchoolName('  서울하늘초교 ')).toBe(expected);
    expect(normalizeSchoolName('서울하늘초')).toBe(expected);
    // 학교 이름 자체가 없이 '초' 한 글자만 적힌 경우는 바꾸지 않는다.
    expect(normalizeSchoolName('초')).toBe('초');
  });

  it('별명 정렬은 한국어 가나다순을 따르고 동률도 결정적으로 가른다', () => {
    const list = ['하늘고래', '구름토끼', '나무늘보', '가람별'];
    expect([...list].sort(compareNicknames)).toEqual(['가람별', '구름토끼', '나무늘보', '하늘고래']);
    expect(compareNicknames('하늘', '하늘')).toBe(0);
  });

  it('[성질] normalizeNickname과 nicknameKey는 임의 유니코드 문자열에 대해 멱등이다', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 40 }), raw => {
        const once = normalizeNickname(raw);
        const twice = normalizeNickname(once);
        expect(twice).toBe(once);

        const keyOnce = nicknameKey(raw);
        const keyTwice = nicknameKey(keyOnce);
        expect(keyTwice).toBe(keyOnce);
      }),
      { numRuns: 200 },
    );
  });

  it('소문자로 바꾸면 합쳐지는 글자도 대소문자와 상관없이 같은 키다(GitHub 시험 반례)', () => {
    // 'H' + U+0331(아래 줄): 대문자는 미리 합친 글자가 없고 소문자는 U+1E96 하나로 합쳐진다.
    expect(nicknameKey('H\u0331')).toBe(nicknameKey('h\u0331'));
    expect(nicknameKey('H\u0331')).toBe('\u1e96');
  });

  it('[성질] 앞뒤 공백 추가와 영문(ASCII) 대소문자 변경은 nicknameKey를 바꾸지 않는다', () => {
    const asciiUpper = (s: string): string => s.replace(/[a-z]/g, ch => ch.toUpperCase());
    const asciiLower = (s: string): string => s.replace(/[A-Z]/g, ch => ch.toLowerCase());

    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 24 }), raw => {
        const baseKey = nicknameKey(raw);
        expect(nicknameKey(`   ${raw}  `)).toBe(baseKey);
        expect(nicknameKey(asciiUpper(raw))).toBe(nicknameKey(asciiLower(raw)));
      }),
      { numRuns: 150 },
    );
  });
});
