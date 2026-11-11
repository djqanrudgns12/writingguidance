import { describe, expect, it } from 'vitest';
import { defaultConfig } from './config.ts';
import { isValidMemoKey } from './domain/document.ts';
import {
  GENRE_CATALOG,
  GENRE_IDS,
  GENRE_LENS_IDS,
  GENRE_LENSES,
  getGenreDisplayLabel,
  getMinCharsForAi,
  HELP_QUESTION_IDS,
  HELP_QUESTIONS,
  isGenreId,
  isValidGenreSelection,
  PURPOSE_IDS,
  resolveGenreVariant,
  SUBTYPE_IDS,
} from './genres.ts';

const SLUG_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

describe('genres 카탈로그 및 선택 해석', () => {
  it('모든 장르·하위 종류·용도·관점 ID는 프로토콜 슬러그 규칙을 지키고 질문 ID는 MEMO_KEY_PATTERN을 지킨다', () => {
    for (const id of [...GENRE_IDS, ...SUBTYPE_IDS, ...PURPOSE_IDS, ...GENRE_LENS_IDS]) {
      expect(SLUG_ID_RE.test(id)).toBe(true);
    }

    for (const qid of HELP_QUESTION_IDS) {
      expect(isValidMemoKey(qid)).toBe(true);
    }
  });

  it('모든 관점과 질문이 비어 있지 않은 한국어 문구와 연결되어 있다', () => {
    for (const genreId of GENRE_IDS) {
      const def = GENRE_CATALOG[genreId];
      const base = resolveGenreVariant({ genre: genreId });
      expect(base.questions.length).toBeGreaterThanOrEqual(3);
      for (const q of base.questions) {
        expect(q.prompt.trim().length).toBeGreaterThan(0);
      }
      expect(base.lens.feedbackFocus.length).toBeGreaterThan(0);
      expect(base.lens.directionFocus.length).toBeGreaterThan(0);
      expect(base.lens.polishFocus.length).toBeGreaterThan(0);

      for (const sub of def.subtypes) {
        const resolved = resolveGenreVariant({ genre: genreId, subtype: sub.id });
        expect(resolved.subtype).toBe(sub.id);
        expect(resolved.lensId).toBe(sub.lensId);
      }

      for (const purp of def.purposes) {
        const resolved = resolveGenreVariant({ genre: genreId, purpose: purp.id });
        expect(resolved.purpose).toBe(purp.id);
        expect(resolved.lensId).toBe(purp.lensId);
      }
    }

    expect(Object.keys(HELP_QUESTIONS)).toHaveLength(HELP_QUESTION_IDS.length);
    expect(Object.keys(GENRE_LENSES)).toHaveLength(GENRE_LENS_IDS.length);
  });

  it('하위 종류를 바꿔도 같은 계열 질문 ID를 공유해 작성한 메모가 유지된다', () => {
    const shortQ = resolveGenreVariant({ genre: 'story', subtype: 'short' }).questions.map(q => q.id);
    const fairyQ = resolveGenreVariant({ genre: 'story', subtype: 'fairy-tale' }).questions.map(q => q.id);
    const longQ = resolveGenreVariant({ genre: 'story', subtype: 'long' }).questions.map(q => q.id);

    expect(shortQ).toEqual(fairyQ);
    expect(longQ.slice(0, 4)).toEqual(shortQ);
    expect(longQ[4]).toBe('story_chapter');

    const essayQ = resolveGenreVariant({ genre: 'essay', subtype: 'essay' }).questions.map(q => q.id);
    const diaryQ = resolveGenreVariant({ genre: 'essay', subtype: 'diary' }).questions.map(q => q.id);
    expect(essayQ).toEqual(diaryQ);

    const promoQ = resolveGenreVariant({ genre: 'other', purpose: 'promo' }).questions.map(q => q.id);
    const letterQ = resolveGenreVariant({ genre: 'other', purpose: 'letter' }).questions.map(q => q.id);
    const speechQ = resolveGenreVariant({ genre: 'other', purpose: 'speech' }).questions.map(q => q.id);
    const customQ = resolveGenreVariant({ genre: 'other', purpose: 'custom' }).questions.map(q => q.id);
    expect(promoQ).toEqual(letterQ);
    expect(promoQ).toEqual(speechQ);
    expect(promoQ).toEqual(customQ);
  });

  it('PRD 5장 특수 동작(최소 글자 수·구조 버튼·사실 모드·시대 규칙·Suno 지원)이 정확히 매핑된다', () => {
    expect(getMinCharsForAi({ genre: 'story' })).toBe(defaultConfig.AI_MIN_CHARS.default);
    expect(getMinCharsForAi({ genre: 'poem' })).toBe(defaultConfig.AI_MIN_CHARS.poem);
    expect(getMinCharsForAi({ genre: 'other', purpose: 'poster' })).toBe(
      defaultConfig.AI_MIN_CHARS.posterSlogan,
    );
    expect(getMinCharsForAi({ genre: 'other', purpose: 'webtoon' })).toBe(defaultConfig.AI_MIN_CHARS.default);

    const customMin = { AI_MIN_CHARS: { default: 50, poem: 15, posterSlogan: 6 } };
    expect(getMinCharsForAi({ genre: 'poem' }, customMin)).toBe(15);
    expect(getMinCharsForAi({ genre: 'other', purpose: 'poster' }, customMin)).toBe(6);

    const longStory = resolveGenreVariant({ genre: 'story', subtype: 'long' });
    expect(longStory.lens.currentChapterScoped).toBe(true);
    expect(longStory.structureButtons).toEqual(['chapter']);

    const lyrics = resolveGenreVariant({ genre: 'lyrics' });
    expect(lyrics.hasSongChips).toBe(true);
    expect(lyrics.supportsSunoExport).toBe(true);
    expect(lyrics.structureButtons).toEqual(['verse1', 'chorus', 'verse2', 'bridge']);

    const news = resolveGenreVariant({ genre: 'news' });
    expect(news.lens.factMode).toBe('question');
    expect(news.lens.eraRule).toBe(false);

    const webtoon = resolveGenreVariant({ genre: 'other', purpose: 'webtoon' });
    expect(webtoon.structureButtons).toEqual(['cut']);
    expect(webtoon.lens.eraRule).toBe(true);
  });

  it('외부 장르·하위 종류·용도 조합의 유효성을 엄격히 가른다', () => {
    expect(isGenreId('story')).toBe(true);
    expect(isGenreId('unknown')).toBe(false);
    expect(isGenreId(123)).toBe(false);

    expect(isValidGenreSelection({ genre: 'story' })).toBe(true);
    expect(isValidGenreSelection({ genre: 'story', subtype: 'fairy-tale' })).toBe(true);
    expect(isValidGenreSelection({ genre: 'lyrics' })).toBe(true);
    expect(isValidGenreSelection({ genre: 'other', purpose: 'custom', purposeCustom: '학급 규칙' })).toBe(
      true,
    );

    // 다른 장르의 하위 종류나 용도를 섞으면 거절
    expect(isValidGenreSelection({ genre: 'unknown' })).toBe(false);
    expect(isValidGenreSelection({ genre: 'story', subtype: 'diary' })).toBe(false);
    expect(isValidGenreSelection({ genre: 'lyrics', subtype: 'short' })).toBe(false);
    expect(isValidGenreSelection({ genre: 'story', purpose: 'poster' })).toBe(false);
    expect(isValidGenreSelection({ genre: 'other', purpose: 'poster', purposeCustom: '허용 안 됨' })).toBe(
      false,
    );
    expect(isValidGenreSelection({ genre: 'other', purposeCustom: '용도 없음' })).toBe(false);
  });

  it('글 종류 표시 이름은 일반 장르·선택 용도·직접 입력 이름을 차례로 반영한다', () => {
    expect(getGenreDisplayLabel({ genre: 'news', subtype: 'extra' })).toBe('기사');
    expect(getGenreDisplayLabel({ genre: 'other', purpose: 'poster' })).toBe('포스터·표어');
    expect(getGenreDisplayLabel({ genre: 'other', purpose: 'webtoon' })).toBe('웹툰·만화 대사');
    expect(getGenreDisplayLabel({ genre: 'other', purpose: 'custom', purposeCustom: '학급 회의 안내' })).toBe(
      '학급 회의 안내',
    );
    expect(getGenreDisplayLabel({ genre: 'other', purpose: 'custom', purposeCustom: '   ' })).toBe(
      '직접 입력',
    );
  });
});
