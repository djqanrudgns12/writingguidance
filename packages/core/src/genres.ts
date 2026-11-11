import { defaultConfig, type Config } from './config.ts';
import { ko } from './copy/ko.ts';
import type { StructureButtonId } from './structure.ts';

/**
 * 글 종류 카탈로그 한 곳(PRD F-05·F-07, PRD 5장, ADR-023).
 * 화면·AI 프롬프트·내려받기가 모두 이 데이터에서 읽고, 한국어 문장은 `copy/ko.ts`의 키로만 잇는다.
 */

export type StudentCopyKey = {
  [K in keyof typeof ko.student]: (typeof ko.student)[K] extends string ? K : never;
}[keyof typeof ko.student];

export type TeacherCopyKey = {
  [K in keyof typeof ko.teacher]: (typeof ko.teacher)[K] extends string ? K : never;
}[keyof typeof ko.teacher];

export type AiMinCharsKey = keyof Config['AI_MIN_CHARS'];

export const GENRE_IDS = ['story', 'poem', 'lyrics', 'news', 'essay', 'other'] as const;
export type GenreId = (typeof GENRE_IDS)[number];

export const SUBTYPE_IDS = [
  'short',
  'fairy-tale',
  'long',
  'children-poem',
  'free-verse',
  'newspaper',
  'extra',
  'broadcast',
  'essay',
  'diary',
  'review',
] as const;
export type SubtypeId = (typeof SUBTYPE_IDS)[number];

export const PURPOSE_IDS = ['poster', 'webtoon', 'promo', 'letter', 'speech', 'custom'] as const;
export type PurposeId = (typeof PURPOSE_IDS)[number];

export const GENRE_LENS_IDS = [
  'story-short',
  'story-long',
  'poem',
  'lyrics',
  'news',
  'essay-life',
  'essay-review',
  'other-poster',
  'other-webtoon',
  'other-general',
] as const;
export type GenreLensId = (typeof GENRE_LENS_IDS)[number];

/** PRD 5장 사실 처리 방식(PLAN §8.4 `<fact_mode>`). */
export type FactMode = 'creative' | 'question' | 'none';

/** 글 종류 고르기 화면(S4)에서 타일을 눌렀을 때 펼쳐지는 하위 선택 방식(PRD F-05). */
export type GenreExpandMode = 'none' | 'subtypes' | 'purposes';

/**
 * 도움 질문 ID(`domain/document.ts`의 `MEMO_KEY_PATTERN` 준수).
 * 이야기 단편·동화·장편, 생활글 수필·일기, 기타 홍보·편지·발표·직접 입력은 공통 질문 ID를 공유해
 * 하위 종류를 바꿔도 같은 질문의 메모가 그대로 다시 보이게 한다(PRD F-07).
 */
export const HELP_QUESTION_IDS = [
  'story_who',
  'story_when_where',
  'story_event',
  'story_ending',
  'story_chapter',
  'poem_subject',
  'poem_feeling',
  'poem_metaphor',
  'poem_wish',
  'lyrics_story',
  'lyrics_scene',
  'lyrics_hook',
  'news_when',
  'news_where',
  'news_who',
  'news_what',
  'news_why_how',
  'news_headline',
  'life_when_what',
  'life_saw_heard',
  'life_thought_feeling',
  'life_learned',
  'review_work',
  'review_scene',
  'review_why',
  'review_thought',
  'poster_target_topic',
  'poster_slogan',
  'poster_detail',
  'webtoon_cut_count',
  'webtoon_scene',
  'webtoon_dialogue',
  'other_reader',
  'other_message',
  'other_tone',
] as const;
export type HelpQuestionId = (typeof HELP_QUESTION_IDS)[number];

export interface HelpQuestionDef {
  readonly id: HelpQuestionId;
  readonly promptKey: StudentCopyKey;
}

export const HELP_QUESTIONS: Readonly<Record<HelpQuestionId, HelpQuestionDef>> = {
  story_who: { id: 'story_who', promptKey: 'questionStoryWho' },
  story_when_where: { id: 'story_when_where', promptKey: 'questionStoryWhenWhere' },
  story_event: { id: 'story_event', promptKey: 'questionStoryEvent' },
  story_ending: { id: 'story_ending', promptKey: 'questionStoryEnding' },
  story_chapter: { id: 'story_chapter', promptKey: 'questionStoryChapter' },

  poem_subject: { id: 'poem_subject', promptKey: 'questionPoemSubject' },
  poem_feeling: { id: 'poem_feeling', promptKey: 'questionPoemFeeling' },
  poem_metaphor: { id: 'poem_metaphor', promptKey: 'questionPoemMetaphor' },
  poem_wish: { id: 'poem_wish', promptKey: 'questionPoemWish' },

  lyrics_story: { id: 'lyrics_story', promptKey: 'questionLyricsStory' },
  lyrics_scene: { id: 'lyrics_scene', promptKey: 'questionLyricsScene' },
  lyrics_hook: { id: 'lyrics_hook', promptKey: 'questionLyricsHook' },

  news_when: { id: 'news_when', promptKey: 'questionNewsWhen' },
  news_where: { id: 'news_where', promptKey: 'questionNewsWhere' },
  news_who: { id: 'news_who', promptKey: 'questionNewsWho' },
  news_what: { id: 'news_what', promptKey: 'questionNewsWhat' },
  news_why_how: { id: 'news_why_how', promptKey: 'questionNewsWhyHow' },
  news_headline: { id: 'news_headline', promptKey: 'questionNewsHeadline' },

  life_when_what: { id: 'life_when_what', promptKey: 'questionLifeWhenWhat' },
  life_saw_heard: { id: 'life_saw_heard', promptKey: 'questionLifeSawHeard' },
  life_thought_feeling: { id: 'life_thought_feeling', promptKey: 'questionLifeThoughtFeeling' },
  life_learned: { id: 'life_learned', promptKey: 'questionLifeLearned' },

  review_work: { id: 'review_work', promptKey: 'questionReviewWork' },
  review_scene: { id: 'review_scene', promptKey: 'questionReviewScene' },
  review_why: { id: 'review_why', promptKey: 'questionReviewWhy' },
  review_thought: { id: 'review_thought', promptKey: 'questionReviewThought' },

  poster_target_topic: { id: 'poster_target_topic', promptKey: 'questionPosterTargetTopic' },
  poster_slogan: { id: 'poster_slogan', promptKey: 'questionPosterSlogan' },
  poster_detail: { id: 'poster_detail', promptKey: 'questionPosterDetail' },

  webtoon_cut_count: { id: 'webtoon_cut_count', promptKey: 'questionWebtoonCutCount' },
  webtoon_scene: { id: 'webtoon_scene', promptKey: 'questionWebtoonScene' },
  webtoon_dialogue: { id: 'webtoon_dialogue', promptKey: 'questionWebtoonDialogue' },

  other_reader: { id: 'other_reader', promptKey: 'questionOtherReader' },
  other_message: { id: 'other_message', promptKey: 'questionOtherMessage' },
  other_tone: { id: 'other_tone', promptKey: 'questionOtherTone' },
};

export interface GenreLensDef {
  readonly id: GenreLensId;
  readonly feedbackFocusKey: TeacherCopyKey;
  readonly directionFocusKey: TeacherCopyKey;
  readonly polishFocusKey: TeacherCopyKey;
  readonly factMode: FactMode;
  /** 시대 메모 규칙 적용 여부(문학·창작 장르 공통, PRD 5장). */
  readonly eraRule: boolean;
  /** 장편 소설처럼 마지막 `[N장]` 단위로 다루는지 여부. */
  readonly currentChapterScoped: boolean;
  readonly minCharsKey: AiMinCharsKey;
  readonly questionIds: readonly HelpQuestionId[];
  readonly structureButtons: readonly StructureButtonId[];
}

export const GENRE_LENSES: Readonly<Record<GenreLensId, GenreLensDef>> = {
  'story-short': {
    id: 'story-short',
    feedbackFocusKey: 'lensStoryShortFeedback',
    directionFocusKey: 'lensStoryShortDirection',
    polishFocusKey: 'lensStoryShortPolish',
    factMode: 'creative',
    eraRule: true,
    currentChapterScoped: false,
    minCharsKey: 'default',
    questionIds: ['story_who', 'story_when_where', 'story_event', 'story_ending'],
    structureButtons: [],
  },
  'story-long': {
    id: 'story-long',
    feedbackFocusKey: 'lensStoryLongFeedback',
    directionFocusKey: 'lensStoryLongDirection',
    polishFocusKey: 'lensStoryLongPolish',
    factMode: 'creative',
    eraRule: true,
    currentChapterScoped: true,
    minCharsKey: 'default',
    questionIds: ['story_who', 'story_when_where', 'story_event', 'story_ending', 'story_chapter'],
    structureButtons: ['chapter'],
  },
  poem: {
    id: 'poem',
    feedbackFocusKey: 'lensPoemFeedback',
    directionFocusKey: 'lensPoemDirection',
    polishFocusKey: 'lensPoemPolish',
    factMode: 'creative',
    eraRule: true,
    currentChapterScoped: false,
    minCharsKey: 'poem',
    questionIds: ['poem_subject', 'poem_feeling', 'poem_metaphor', 'poem_wish'],
    structureButtons: [],
  },
  lyrics: {
    id: 'lyrics',
    feedbackFocusKey: 'lensLyricsFeedback',
    directionFocusKey: 'lensLyricsDirection',
    polishFocusKey: 'lensLyricsPolish',
    factMode: 'creative',
    eraRule: true,
    currentChapterScoped: false,
    minCharsKey: 'default',
    questionIds: ['lyrics_story', 'lyrics_scene', 'lyrics_hook'],
    structureButtons: ['verse1', 'chorus', 'verse2', 'bridge'],
  },
  news: {
    id: 'news',
    feedbackFocusKey: 'lensNewsFeedback',
    directionFocusKey: 'lensNewsDirection',
    polishFocusKey: 'lensNewsPolish',
    factMode: 'question',
    eraRule: false,
    currentChapterScoped: false,
    minCharsKey: 'default',
    questionIds: ['news_when', 'news_where', 'news_who', 'news_what', 'news_why_how', 'news_headline'],
    structureButtons: [],
  },
  'essay-life': {
    id: 'essay-life',
    feedbackFocusKey: 'lensEssayLifeFeedback',
    directionFocusKey: 'lensEssayLifeDirection',
    polishFocusKey: 'lensEssayLifePolish',
    factMode: 'none',
    eraRule: false,
    currentChapterScoped: false,
    minCharsKey: 'default',
    questionIds: ['life_when_what', 'life_saw_heard', 'life_thought_feeling', 'life_learned'],
    structureButtons: [],
  },
  'essay-review': {
    id: 'essay-review',
    feedbackFocusKey: 'lensEssayReviewFeedback',
    directionFocusKey: 'lensEssayReviewDirection',
    polishFocusKey: 'lensEssayReviewPolish',
    factMode: 'none',
    eraRule: false,
    currentChapterScoped: false,
    minCharsKey: 'default',
    questionIds: ['review_work', 'review_scene', 'review_why', 'review_thought'],
    structureButtons: [],
  },
  'other-poster': {
    id: 'other-poster',
    feedbackFocusKey: 'lensOtherPosterFeedback',
    directionFocusKey: 'lensOtherPosterDirection',
    polishFocusKey: 'lensOtherPosterPolish',
    factMode: 'none',
    eraRule: false,
    currentChapterScoped: false,
    minCharsKey: 'posterSlogan',
    questionIds: ['poster_target_topic', 'poster_slogan', 'poster_detail'],
    structureButtons: [],
  },
  'other-webtoon': {
    id: 'other-webtoon',
    feedbackFocusKey: 'lensOtherWebtoonFeedback',
    directionFocusKey: 'lensOtherWebtoonDirection',
    polishFocusKey: 'lensOtherWebtoonPolish',
    factMode: 'creative',
    eraRule: true,
    currentChapterScoped: false,
    minCharsKey: 'default',
    questionIds: ['webtoon_cut_count', 'webtoon_scene', 'webtoon_dialogue'],
    structureButtons: ['cut'],
  },
  'other-general': {
    id: 'other-general',
    feedbackFocusKey: 'lensOtherGeneralFeedback',
    directionFocusKey: 'lensOtherGeneralDirection',
    polishFocusKey: 'lensOtherGeneralPolish',
    factMode: 'none',
    eraRule: false,
    currentChapterScoped: false,
    minCharsKey: 'default',
    questionIds: ['other_reader', 'other_message', 'other_tone'],
    structureButtons: [],
  },
};

export interface SubtypeDef {
  readonly id: SubtypeId;
  readonly labelKey: StudentCopyKey;
  readonly lensId: GenreLensId;
}

export interface PurposeDef {
  readonly id: PurposeId;
  readonly labelKey: StudentCopyKey;
  readonly allowsCustomText: boolean;
  readonly lensId: GenreLensId;
}

export interface GenreDef {
  readonly id: GenreId;
  readonly labelKey: StudentCopyKey;
  readonly subtitleKey: StudentCopyKey;
  readonly expandsOnPick: GenreExpandMode;
  readonly defaultSubtype: SubtypeId | null;
  readonly subtypes: readonly SubtypeDef[];
  readonly defaultPurpose: PurposeId | null;
  readonly purposes: readonly PurposeDef[];
  readonly defaultLensId: GenreLensId;
  readonly hasSongChips: boolean;
  readonly supportsSunoExport: boolean;
}

export const GENRE_CATALOG: Readonly<Record<GenreId, GenreDef>> = {
  story: {
    id: 'story',
    labelKey: 'genreStoryLabel',
    subtitleKey: 'genreStorySubtitle',
    expandsOnPick: 'subtypes',
    defaultSubtype: 'short',
    subtypes: [
      { id: 'short', labelKey: 'subtypeShortStory', lensId: 'story-short' },
      { id: 'fairy-tale', labelKey: 'subtypeFairyTale', lensId: 'story-short' },
      { id: 'long', labelKey: 'subtypeLongStory', lensId: 'story-long' },
    ],
    defaultPurpose: null,
    purposes: [],
    defaultLensId: 'story-short',
    hasSongChips: false,
    supportsSunoExport: false,
  },
  poem: {
    id: 'poem',
    labelKey: 'genrePoemLabel',
    subtitleKey: 'genrePoemSubtitle',
    expandsOnPick: 'none',
    defaultSubtype: 'children-poem',
    subtypes: [
      { id: 'children-poem', labelKey: 'subtypeChildrenPoem', lensId: 'poem' },
      { id: 'free-verse', labelKey: 'subtypeFreeVerse', lensId: 'poem' },
    ],
    defaultPurpose: null,
    purposes: [],
    defaultLensId: 'poem',
    hasSongChips: false,
    supportsSunoExport: false,
  },
  lyrics: {
    id: 'lyrics',
    labelKey: 'genreLyricsLabel',
    subtitleKey: 'genreLyricsSubtitle',
    expandsOnPick: 'none',
    defaultSubtype: null,
    subtypes: [],
    defaultPurpose: null,
    purposes: [],
    defaultLensId: 'lyrics',
    hasSongChips: true,
    supportsSunoExport: true,
  },
  news: {
    id: 'news',
    labelKey: 'genreNewsLabel',
    subtitleKey: 'genreNewsSubtitle',
    expandsOnPick: 'none',
    defaultSubtype: 'newspaper',
    subtypes: [
      { id: 'newspaper', labelKey: 'subtypeNewspaper', lensId: 'news' },
      { id: 'extra', labelKey: 'subtypeExtraNews', lensId: 'news' },
      { id: 'broadcast', labelKey: 'subtypeBroadcastNews', lensId: 'news' },
    ],
    defaultPurpose: null,
    purposes: [],
    defaultLensId: 'news',
    hasSongChips: false,
    supportsSunoExport: false,
  },
  essay: {
    id: 'essay',
    labelKey: 'genreEssayLabel',
    subtitleKey: 'genreEssaySubtitle',
    expandsOnPick: 'subtypes',
    defaultSubtype: 'essay',
    subtypes: [
      { id: 'essay', labelKey: 'subtypeEssay', lensId: 'essay-life' },
      { id: 'diary', labelKey: 'subtypeDiary', lensId: 'essay-life' },
      { id: 'review', labelKey: 'subtypeReview', lensId: 'essay-review' },
    ],
    defaultPurpose: null,
    purposes: [],
    defaultLensId: 'essay-life',
    hasSongChips: false,
    supportsSunoExport: false,
  },
  other: {
    id: 'other',
    labelKey: 'genreOtherLabel',
    subtitleKey: 'genreOtherSubtitle',
    expandsOnPick: 'purposes',
    defaultSubtype: null,
    subtypes: [],
    defaultPurpose: 'poster',
    purposes: [
      { id: 'poster', labelKey: 'purposePoster', allowsCustomText: false, lensId: 'other-poster' },
      { id: 'webtoon', labelKey: 'purposeWebtoon', allowsCustomText: false, lensId: 'other-webtoon' },
      { id: 'promo', labelKey: 'purposePromo', allowsCustomText: false, lensId: 'other-general' },
      { id: 'letter', labelKey: 'purposeLetter', allowsCustomText: false, lensId: 'other-general' },
      { id: 'speech', labelKey: 'purposeSpeech', allowsCustomText: false, lensId: 'other-general' },
      { id: 'custom', labelKey: 'purposeCustom', allowsCustomText: true, lensId: 'other-general' },
    ],
    defaultLensId: 'other-poster',
    hasSongChips: false,
    supportsSunoExport: false,
  },
};

export interface GenreSelection {
  readonly genre: GenreId;
  readonly subtype?: string | null | undefined;
  readonly purpose?: string | null | undefined;
  readonly purposeCustom?: string | null | undefined;
}

export interface ResolvedHelpQuestion {
  readonly id: HelpQuestionId;
  readonly promptKey: StudentCopyKey;
  readonly prompt: string;
}

export interface ResolvedGenreLens {
  readonly id: GenreLensId;
  readonly feedbackFocus: string;
  readonly directionFocus: string;
  readonly polishFocus: string;
  readonly factMode: FactMode;
  readonly eraRule: boolean;
  readonly currentChapterScoped: boolean;
}

export interface ResolvedGenreVariant {
  readonly genre: GenreId;
  readonly subtype: SubtypeId | null;
  readonly purpose: PurposeId | null;
  readonly lensId: GenreLensId;
  readonly lens: ResolvedGenreLens;
  readonly minCharsKey: AiMinCharsKey;
  readonly minChars: number;
  readonly questions: readonly ResolvedHelpQuestion[];
  readonly structureButtons: readonly StructureButtonId[];
  readonly hasSongChips: boolean;
  readonly supportsSunoExport: boolean;
}

export function isGenreId(value: unknown): value is GenreId {
  return typeof value === 'string' && Object.hasOwn(GENRE_CATALOG, value);
}

/**
 * `doc.create` 등 외부 입력의 장르·하위 종류·용도 조합이 카탈로그에 맞는지 검사한다.
 * 생략된 `subtype`·`purpose`는 기본값 사용으로 허용하되, 주어진 값이 다른 장르의 것이면 거부한다.
 */
export function isValidGenreSelection(input: {
  readonly genre: string;
  readonly subtype?: string | null | undefined;
  readonly purpose?: string | null | undefined;
  readonly purposeCustom?: string | null | undefined;
}): boolean {
  if (!isGenreId(input.genre)) return false;
  const def = GENRE_CATALOG[input.genre];

  if (input.subtype !== undefined && input.subtype !== null) {
    if (!def.subtypes.some(s => s.id === input.subtype)) return false;
  }

  if (input.purpose !== undefined && input.purpose !== null) {
    const matchedPurpose = def.purposes.find(p => p.id === input.purpose);
    if (!matchedPurpose) return false;
    if (
      !matchedPurpose.allowsCustomText &&
      input.purposeCustom !== undefined &&
      input.purposeCustom !== null
    ) {
      return false;
    }
  } else if (input.purposeCustom !== undefined && input.purposeCustom !== null) {
    return false;
  }

  return true;
}

/** 장르·하위 종류·용도 선택을 카탈로그 규칙에 따라 해석한다(비어 있으면 기본 하위 종류·용도 적용). */
export function resolveGenreVariant(
  selection: GenreSelection,
  config: Pick<Config, 'AI_MIN_CHARS'> = defaultConfig,
): ResolvedGenreVariant {
  const def = GENRE_CATALOG[selection.genre];

  const matchedSubtype =
    selection.subtype !== undefined && selection.subtype !== null
      ? def.subtypes.find(s => s.id === selection.subtype)
      : undefined;
  const effectiveSubtypeDef =
    matchedSubtype ??
    (def.defaultSubtype !== null ? def.subtypes.find(s => s.id === def.defaultSubtype) : undefined);

  const matchedPurpose =
    selection.purpose !== undefined && selection.purpose !== null
      ? def.purposes.find(p => p.id === selection.purpose)
      : undefined;
  const effectivePurposeDef =
    matchedPurpose ??
    (def.defaultPurpose !== null ? def.purposes.find(p => p.id === def.defaultPurpose) : undefined);

  const lensId = effectiveSubtypeDef?.lensId ?? effectivePurposeDef?.lensId ?? def.defaultLensId;
  const lensDef = GENRE_LENSES[lensId];

  const questions: ResolvedHelpQuestion[] = lensDef.questionIds.map(qid => {
    const q = HELP_QUESTIONS[qid];
    return {
      id: q.id,
      promptKey: q.promptKey,
      prompt: ko.student[q.promptKey],
    };
  });

  return {
    genre: def.id,
    subtype: effectiveSubtypeDef?.id ?? null,
    purpose: effectivePurposeDef?.id ?? null,
    lensId,
    lens: {
      id: lensDef.id,
      feedbackFocus: ko.teacher[lensDef.feedbackFocusKey],
      directionFocus: ko.teacher[lensDef.directionFocusKey],
      polishFocus: ko.teacher[lensDef.polishFocusKey],
      factMode: lensDef.factMode,
      eraRule: lensDef.eraRule,
      currentChapterScoped: lensDef.currentChapterScoped,
    },
    minCharsKey: lensDef.minCharsKey,
    minChars: config.AI_MIN_CHARS[lensDef.minCharsKey],
    questions,
    structureButtons: lensDef.structureButtons,
    hasSongChips: def.hasSongChips,
    supportsSunoExport: def.supportsSunoExport,
  };
}

/** 해당 글 종류에서 AI 버튼을 켜는 최소 글자 수를 돌려준다(PRD F-08, PRD 5장, PRD 12.3). */
export function getMinCharsForAi(
  selection: GenreSelection,
  config: Pick<Config, 'AI_MIN_CHARS'> = defaultConfig,
): number {
  return resolveGenreVariant(selection, config).minChars;
}

/**
 * 대시보드 타일·상단 칩·내려받기 파일 이름에 쓸 글 종류 표시 이름(예: `기사`, `포스터·표어`).
 * `other` 장르는 고른 용도(직접 입력이면 쓴 이름 우선)를 돌려준다.
 */
export function getGenreDisplayLabel(selection: GenreSelection): string {
  const def = GENRE_CATALOG[selection.genre];
  if (selection.genre === 'other') {
    const resolved = resolveGenreVariant(selection);
    if (resolved.purpose === 'custom') {
      const custom = selection.purposeCustom?.trim() ?? '';
      if (custom.length > 0) return custom;
    }
    if (resolved.purpose !== null) {
      const purposeDef = def.purposes.find(p => p.id === resolved.purpose);
      if (purposeDef) return ko.student[purposeDef.labelKey];
    }
  }
  return ko.student[def.labelKey];
}
