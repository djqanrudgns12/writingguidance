import { ko } from './copy/ko.ts';

/**
 * 글 구조 머리말 문법·구조 버튼 삽입·장편 현재 장 추출·Suno 변환(PRD F-07·F-12, PRD 5장).
 * 화면 문구는 `copy/ko.ts`의 키로 연결하고, 문서 본문에 실제로 들어가는 머리말 기호(`[1절]` 등)만 문법 상수로 둔다.
 */

type StudentStringKey = {
  [K in keyof typeof ko.student]: (typeof ko.student)[K] extends string ? K : never;
}[keyof typeof ko.student];

export const STRUCTURE_BUTTON_IDS = ['verse1', 'chorus', 'verse2', 'bridge', 'cut', 'chapter'] as const;
export type StructureButtonId = (typeof STRUCTURE_BUTTON_IDS)[number];

export interface StructureButtonDef {
  readonly id: StructureButtonId;
  readonly labelKey: StudentStringKey;
}

export const STRUCTURE_BUTTONS: Readonly<Record<StructureButtonId, StructureButtonDef>> = {
  verse1: { id: 'verse1', labelKey: 'structureAddVerse1' },
  chorus: { id: 'chorus', labelKey: 'structureAddChorus' },
  verse2: { id: 'verse2', labelKey: 'structureAddVerse2' },
  bridge: { id: 'bridge', labelKey: 'structureAddBridge' },
  cut: { id: 'cut', labelKey: 'structureAddCut' },
  chapter: { id: 'chapter', labelKey: 'structureAddChapter' },
};

export function getStructureButtonLabel(buttonId: StructureButtonId): string {
  return ko.student[STRUCTURE_BUTTONS[buttonId].labelKey];
}

// ── 머리말 문법 파싱 ───────────────────────────────────────────────

export type ParsedHeading =
  | { readonly kind: 'verse'; readonly number: number; readonly raw: string }
  | { readonly kind: 'chorus'; readonly raw: string }
  | { readonly kind: 'bridge'; readonly raw: string }
  | { readonly kind: 'intro'; readonly raw: string }
  | { readonly kind: 'interlude'; readonly raw: string }
  | { readonly kind: 'outro'; readonly raw: string }
  | { readonly kind: 'cut'; readonly number: number; readonly raw: string }
  | { readonly kind: 'chapter'; readonly number: number; readonly raw: string };

const VERSE_HEADING_RE = /^\[([1-9]\d*)절\]$/;
const CUT_HEADING_RE = /^\[([1-9]\d*)컷\]$/;
const CHAPTER_HEADING_RE = /^\[([1-9]\d*)장\]$/;

const WEBTOON_SCENE_PREFIX = '장면: ';
const WEBTOON_DIALOGUE_PREFIX = '대사: ';

/** 한 줄이 구조 머리말이면 종류와 번호를 돌려주고, 아니면 `null`을 돌려준다. */
export function parseStructureHeading(line: string): ParsedHeading | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;

  if (trimmed === '[후렴]') return { kind: 'chorus', raw: trimmed };
  if (trimmed === '[브릿지]') return { kind: 'bridge', raw: trimmed };
  if (trimmed === '[전주]') return { kind: 'intro', raw: trimmed };
  if (trimmed === '[간주]') return { kind: 'interlude', raw: trimmed };
  if (trimmed === '[마무리]') return { kind: 'outro', raw: trimmed };

  const verse = VERSE_HEADING_RE.exec(trimmed);
  if (verse?.[1] !== undefined) {
    return { kind: 'verse', number: Number(verse[1]), raw: trimmed };
  }

  const cut = CUT_HEADING_RE.exec(trimmed);
  if (cut?.[1] !== undefined) {
    return { kind: 'cut', number: Number(cut[1]), raw: trimmed };
  }

  const chapter = CHAPTER_HEADING_RE.exec(trimmed);
  if (chapter?.[1] !== undefined) {
    return { kind: 'chapter', number: Number(chapter[1]), raw: trimmed };
  }

  return null;
}

/** 본문에 있는 `[N컷]` 머리말을 보고 다음에 넣을 컷 번호(없으면 1)를 계산한다(PRD F-07). */
export function nextCutNumber(text: string): number {
  let maxCut = 0;
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseStructureHeading(line);
    if (parsed?.kind === 'cut' && parsed.number > maxCut) {
      maxCut = parsed.number;
    }
  }
  return maxCut + 1;
}

/** 본문에 있는 `[N장]` 머리말을 보고 다음에 넣을 장 번호(없으면 1)를 계산한다(PRD F-07, ADR-023). */
export function nextChapterNumber(text: string): number {
  let maxChapter = 0;
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseStructureHeading(line);
    if (parsed?.kind === 'chapter' && parsed.number > maxChapter) {
      maxChapter = parsed.number;
    }
  }
  return maxChapter + 1;
}

// ── 구조 버튼 삽입 계산 ────────────────────────────────────────────

export interface StructureInsertion {
  /** 기존 `text`에서 삽입할 UTF-16 위치 (`Y.Text.insert(insertAt, insertText)`) */
  readonly insertAt: number;
  /** 삽입할 문자열(내용 없이 머리말 틀만) */
  readonly insertText: string;
  /** 삽입 반영 뒤 커서를 놓을 UTF-16 위치 */
  readonly nextCursor: number;
  /** 삽입 반영 뒤 전체 문자열 */
  readonly nextText: string;
  /** 삽입된 머리말 표시(예: `"[1절]"`, `"[2컷]"`, `"[1장]"`) */
  readonly heading: string;
}

/**
 * 글과 현재 커서 위치를 받아 구조 버튼이 넣을 위치·문자열·다음 커서 위치를 계산한다(PRD F-07).
 * - 커서가 있는 줄이 비어 있으면 그 자리에 바로 넣고, 줄에 글이 있으면 현재 줄 끝에서 줄을 바꾼 뒤 넣는다.
 * - 웹툰 `+컷`은 `[N컷]\n장면: \n대사: ` 세 줄을 넣고 커서를 `"장면: "` 바로 뒤에 놓는다.
 * - 나머지 머리말은 머리말 줄 뒤에 줄바꿈을 붙여 바로 아랫줄 맨 앞에 커서를 놓는다.
 */
export function insertStructureBlock(
  text: string,
  cursorOffset: number,
  buttonId: StructureButtonId,
): StructureInsertion {
  const pos = Number.isFinite(cursorOffset)
    ? Math.max(0, Math.min(text.length, Math.trunc(cursorOffset)))
    : text.length;

  const lineStart = pos === 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1;
  const nextLf = text.indexOf('\n', pos);
  const rawLineEnd = nextLf === -1 ? text.length : nextLf;
  const effectiveLineEnd =
    rawLineEnd > lineStart && text[rawLineEnd - 1] === '\r' ? rawLineEnd - 1 : rawLineEnd;

  const currentLine = text.slice(lineStart, effectiveLineEnd);
  const hasLineContent = currentLine.length > 0;
  const insertAt = hasLineContent ? effectiveLineEnd : lineStart;
  const leadingNewline = hasLineContent ? '\n' : '';

  if (buttonId === 'cut') {
    const heading = `[${nextCutNumber(text)}컷]`;
    const block = `${heading}\n${WEBTOON_SCENE_PREFIX}\n${WEBTOON_DIALOGUE_PREFIX}`;
    const insertText = `${leadingNewline}${block}`;
    const nextCursor = insertAt + leadingNewline.length + heading.length + 1 + WEBTOON_SCENE_PREFIX.length;
    const nextText = text.slice(0, insertAt) + insertText + text.slice(insertAt);
    return { insertAt, insertText, nextCursor, nextText, heading };
  }

  const heading =
    buttonId === 'verse1'
      ? '[1절]'
      : buttonId === 'chorus'
        ? '[후렴]'
        : buttonId === 'verse2'
          ? '[2절]'
          : buttonId === 'bridge'
            ? '[브릿지]'
            : `[${nextChapterNumber(text)}장]`;

  const insertText = `${leadingNewline}${heading}\n`;
  const nextCursor = insertAt + insertText.length;
  const nextText = text.slice(0, insertAt) + insertText + text.slice(insertAt);
  return { insertAt, insertText, nextCursor, nextText, heading };
}

// ── 장편 '지금 장' 추출 ────────────────────────────────────────────

export interface ChapterSlice {
  readonly chapterNumber: number | null;
  readonly heading: string | null;
  readonly headingStart: number;
  readonly bodyStart: number;
  readonly end: number;
  /** 머리말 줄을 포함한 지금 장 텍스트 */
  readonly text: string;
  /** 머리말 줄 아래 본문만 */
  readonly body: string;
}

/**
 * 이야기(장편)에서 마지막 `[N장]` 머리말 기준 "지금 장" 범위를 뽑는다(PRD F-07, PRD 5장).
 * `[N장]` 머리말이 아직 없으면 글 전체를 돌려준다.
 */
export function extractCurrentChapter(text: string): ChapterSlice {
  let lastChapterNumber: number | null = null;
  let lastHeading: string | null = null;
  let lastHeadingStart = 0;
  let lastBodyStart = 0;

  let cursor = 0;
  while (cursor <= text.length) {
    const nextLf = text.indexOf('\n', cursor);
    const lineEnd = nextLf === -1 ? text.length : nextLf;
    const cleanEnd = lineEnd > cursor && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
    const line = text.slice(cursor, cleanEnd);
    const parsed = parseStructureHeading(line);

    if (parsed?.kind === 'chapter') {
      lastChapterNumber = parsed.number;
      lastHeading = parsed.raw;
      lastHeadingStart = cursor;
      lastBodyStart = nextLf === -1 ? text.length : nextLf + 1;
    }

    if (nextLf === -1) break;
    cursor = nextLf + 1;
  }

  if (lastChapterNumber === null) {
    return {
      chapterNumber: null,
      heading: null,
      headingStart: 0,
      bodyStart: 0,
      end: text.length,
      text,
      body: text,
    };
  }

  return {
    chapterNumber: lastChapterNumber,
    heading: lastHeading,
    headingStart: lastHeadingStart,
    bodyStart: lastBodyStart,
    end: text.length,
    text: text.slice(lastHeadingStart),
    body: text.slice(lastBodyStart),
  };
}

// ── 노래 가사 Suno 태그·스타일 문구 변환 (PRD F-07·F-12) ───────────

export const SONG_MOOD_IDS = [
  'lyrical-gugak',
  'energetic-march',
  'calm-ballad',
  'exciting-dance',
  'custom',
] as const;
export type SongMoodId = (typeof SONG_MOOD_IDS)[number];

export const SONG_TEMPO_IDS = ['slow', 'medium', 'fast'] as const;
export type SongTempoId = (typeof SONG_TEMPO_IDS)[number];

export interface SongMoodDef {
  readonly id: SongMoodId;
  readonly labelKey: StudentStringKey;
  readonly allowsCustomText: boolean;
  /** Suno용 짧은 영어 분위기 문구(실존 가수·곡 이름 금지, `custom`은 사용자 입력 그대로). */
  readonly sunoPrompt: string | null;
}

export interface SongTempoDef {
  readonly id: SongTempoId;
  readonly labelKey: StudentStringKey;
  readonly sunoPrompt: string;
}

export const SONG_MOODS: Readonly<Record<SongMoodId, SongMoodDef>> = {
  'lyrical-gugak': {
    id: 'lyrical-gugak',
    labelKey: 'songMoodLyricalGugak',
    allowsCustomText: false,
    sunoPrompt: 'Korean traditional, gugak, lyrical',
  },
  'energetic-march': {
    id: 'energetic-march',
    labelKey: 'songMoodEnergeticMarch',
    allowsCustomText: false,
    sunoPrompt: 'energetic march, brass, uplifting, rhythmic',
  },
  'calm-ballad': {
    id: 'calm-ballad',
    labelKey: 'songMoodCalmBallad',
    allowsCustomText: false,
    sunoPrompt: 'calm acoustic ballad, warm piano, gentle, melodic',
  },
  'exciting-dance': {
    id: 'exciting-dance',
    labelKey: 'songMoodExcitingDance',
    allowsCustomText: false,
    sunoPrompt: 'upbeat dance pop, bright synth, cheerful, energetic',
  },
  custom: {
    id: 'custom',
    labelKey: 'songMoodCustom',
    allowsCustomText: true,
    sunoPrompt: null,
  },
};

export const SONG_TEMPOS: Readonly<Record<SongTempoId, SongTempoDef>> = {
  slow: { id: 'slow', labelKey: 'songTempoSlow', sunoPrompt: 'slow tempo' },
  medium: { id: 'medium', labelKey: 'songTempoMedium', sunoPrompt: 'medium tempo' },
  fast: { id: 'fast', labelKey: 'songTempoFast', sunoPrompt: 'fast tempo' },
};

export function isSongMoodId(value: unknown): value is SongMoodId {
  return typeof value === 'string' && Object.hasOwn(SONG_MOODS, value);
}

export function isSongTempoId(value: unknown): value is SongTempoId {
  return typeof value === 'string' && Object.hasOwn(SONG_TEMPOS, value);
}

function replaceLeadingLyricsHeading(line: string): string {
  const trimmed = line.trim();
  const full = parseStructureHeading(trimmed);
  if (full !== null) {
    if (full.kind === 'verse') return `[Verse ${full.number}]`;
    if (full.kind === 'chorus') return '[Chorus]';
    if (full.kind === 'bridge') return '[Bridge]';
    if (full.kind === 'intro') return '[Intro]';
    if (full.kind === 'interlude') return '[Interlude]';
    if (full.kind === 'outro') return '[Outro]';
  }

  return line
    .replace(/^(\s*)\[([1-9]\d*)절\](?=\s)/, '$1[Verse $2]')
    .replace(/^(\s*)\[후렴\](?=\s)/, '$1[Chorus]')
    .replace(/^(\s*)\[브릿지\](?=\s)/, '$1[Bridge]')
    .replace(/^(\s*)\[전주\](?=\s)/, '$1[Intro]')
    .replace(/^(\s*)\[간주\](?=\s)/, '$1[Interlude]')
    .replace(/^(\s*)\[마무리\](?=\s)/, '$1[Outro]');
}

/**
 * 한국어 노래 가사 머리말을 Suno 태그로 바꾼다(PRD F-12).
 * `[N절]`→`[Verse N]`, `[후렴]`→`[Chorus]`, `[브릿지]`→`[Bridge]`,
 * 직접 쓴 `[전주]`→`[Intro]`, `[간주]`→`[Interlude]`, `[마무리]`→`[Outro]`.
 */
export function toSunoLyrics(text: string): string {
  return text.replaceAll('\r\n', '\n').split('\n').map(replaceLeadingLyricsHeading).join('\n');
}

export interface SongStyleInput {
  readonly mood?: SongMoodId | string | null | undefined;
  readonly moodCustom?: string | null | undefined;
  readonly tempo?: SongTempoId | string | null | undefined;
}

/**
 * 노래 가사 분위기·빠르기 선택을 Suno 스타일 문구로 바꾼다(PRD F-12).
 * `직접 입력`(`custom`) 분위기는 사용자가 적은 문자열을 그대로 쓴다.
 */
export function toSunoStylePrompt(input: SongStyleInput): string {
  const parts: string[] = [];

  if (input.mood !== undefined && input.mood !== null && isSongMoodId(input.mood)) {
    const moodDef = SONG_MOODS[input.mood];
    if (moodDef.allowsCustomText) {
      const custom = input.moodCustom?.trim() ?? '';
      if (custom.length > 0) parts.push(custom);
    } else if (moodDef.sunoPrompt !== null) {
      parts.push(moodDef.sunoPrompt);
    }
  }

  if (input.tempo !== undefined && input.tempo !== null && isSongTempoId(input.tempo)) {
    parts.push(SONG_TEMPOS[input.tempo].sunoPrompt);
  }

  return parts.join(', ');
}
