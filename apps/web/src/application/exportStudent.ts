import {
  GENRE_CATALOG,
  compactDateKey,
  getGenreDisplayLabel,
  isGenreId,
  toSunoLyrics,
  toSunoStylePrompt,
} from '@geulbang/core';
import type { DownloadPort } from '../ports/download.ts';

/**
 * 학생 내보내기(PRD F-12): `글 복사`·`글 파일로 저장(.txt)`, 노래 가사면 `Suno 가사 복사`·`스타일 문구 복사`.
 * 파일 이름 정리와 텍스트 파일 바이트(UTF-8 + BOM, PLAN §6.7)는 교사 모두 내려받기(`exportAll.ts`)도 같이 쓴다.
 */

export const TEXT_FILE_MIME = 'text/plain;charset=utf-8';
export const TEXT_FILE_EXT = '.txt';

/**
 * 파일 이름 한 조각의 UTF-8 바이트 상한. 파일 이름 한 개 255바이트(APFS·ext4)에
 * 조각 두 개 + 구분자·날짜·`_N` 번호·확장자가 함께 들어가도록 잡은 값(설정값이 아니라 파일 시스템 한도에서 나온 값).
 */
const FILE_NAME_PART_MAX_BYTES = 120;

/** Windows·macOS·Android에서 파일 이름에 쓸 수 없는 글자. 밑줄로 바꾼다. */
const INVALID_FILE_NAME_CHARS = /[\\/:*?"<>|]/gu;
/** 제어 문자·서식 문자(방향 바꾸기 U+202E로 확장자를 속이는 것 포함). 지운다. */
const CONTROL_OR_FORMAT_CHARS = /[\p{Cc}\p{Cf}]/gu;
/** Windows 예약 이름(확장자가 붙어도 예약으로 본다). */
const WINDOWS_RESERVED_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

const utf8 = new TextEncoder();

/** UTF-8 바이트 수가 `maxBytes`를 넘지 않게 코드 포인트 단위로 자른다(한 글자를 반으로 자르지 않음). */
function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  let out = '';
  for (const ch of text) {
    const size = utf8.encode(ch).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += ch;
  }
  return out;
}

/** 앞뒤 공백·점 정리: 앞 점은 숨김 파일이 되고, 끝 점·공백은 Windows가 지워 이름이 바뀐다. */
function trimFileNameEdges(text: string): string {
  return text.replace(/^[.\s]+/u, '').replace(/[.\s]+$/u, '');
}

/**
 * 파일 이름 한 조각(제목·별명·글 종류·수업명 등)을 정리한다. 비면 빈 문자열을 돌려준다.
 * NFC로 맞추고(기기마다 한글 조합 방식이 달라도 같은 이름), 쓸 수 없는 글자는 `_`, 제어·서식 문자는 지우고,
 * 줄바꿈·탭을 포함한 공백은 한 칸으로 줄인 뒤 길이를 자른다.
 */
export function sanitizeFileNamePart(raw: string): string {
  const cleaned = raw
    .normalize('NFC')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(CONTROL_OR_FORMAT_CHARS, '')
    .replace(INVALID_FILE_NAME_CHARS, '_')
    .replace(/\s+/gu, ' ');
  return trimFileNameEdges(truncateUtf8(trimFileNameEdges(cleaned), FILE_NAME_PART_MAX_BYTES));
}

/**
 * 정리된 조각들을 `_`로 이어 파일 이름을 만든다(빈 조각은 뺀다). `ext`는 `.txt`처럼 점을 포함한다.
 * 첫 점 앞이 Windows 예약 이름(`CON` 등)이면 앞에 `_`를 붙인다.
 */
export function joinFileName(parts: readonly string[], ext: string): string {
  const stem = parts.filter(part => part.length > 0).join('_');
  const firstSegment = stem.split('.')[0] ?? '';
  const safeStem = WINDOWS_RESERVED_STEM.test(firstSegment) ? `_${stem}` : stem;
  return `${safeStem}${ext}`;
}

/**
 * 텍스트 파일 앞에 BOM(U+FEFF)을 붙인다(PLAN §6.7). Windows 메모장·한글 프로그램이 UTF-8 한글을 깨뜨리지 않게 한다.
 * 글이 이미 BOM으로 시작하면 하나만 남긴다.
 */
function withBom(text: string): string {
  return text.startsWith('\uFEFF') ? text : `\uFEFF${text}`;
}

/** 텍스트 파일 바이트: UTF-8 + BOM. */
export function encodeTextFile(text: string): Uint8Array<ArrayBuffer> {
  return utf8.encode(withBom(text));
}

export function textFileBlob(text: string, mime: string = TEXT_FILE_MIME): Blob {
  return new Blob([encodeTextFile(text)], { type: mime });
}

export interface GenreLabelInput {
  readonly genre: string;
  readonly subtype?: string | null | undefined;
  readonly purpose?: string | null | undefined;
  readonly purposeCustom?: string | null | undefined;
}

/** 파일 이름·전체 모음에 쓸 글 종류 이름(`genres.ts` 카탈로그). 카탈로그에 없는 종류는 받은 값 그대로. */
export function genreLabelOf(input: GenreLabelInput): string {
  if (!isGenreId(input.genre)) return input.genre;
  return getGenreDisplayLabel({
    genre: input.genre,
    subtype: input.subtype,
    purpose: input.purpose,
    purposeCustom: input.purposeCustom,
  });
}

/** 내보낼 글자: 제목 한 줄 + 빈 줄 + 본문. 제목이 비면 본문만. 줄바꿈은 `\n`으로 맞춘다. */
export function composePlainText(title: string, body: string): string {
  const cleanTitle = title.replace(/\r?\n/gu, ' ').trim();
  const cleanBody = body.replaceAll('\r\n', '\n');
  return [cleanTitle, cleanBody].filter(part => part.length > 0).join('\n\n');
}

export interface StudentExportInput extends GenreLabelInput {
  readonly title: string;
  readonly body: string;
  /** 노래 가사 분위기·빠르기 칩(`meta.mood`·`meta.moodCustom`·`meta.tempo`, PLAN §4.2) */
  readonly mood?: string | null | undefined;
  readonly moodCustom?: string | null | undefined;
  readonly tempo?: string | null | undefined;
}

export interface StudentExportOptions {
  readonly now: number;
  /** 설정 `TIMEZONE`(파일 이름 날짜의 하루 경계) */
  readonly timeZone: string;
}

export interface SunoExport {
  /** `Suno 가사 복사`: 머리말을 Suno 태그로 바꾼 본문(제목은 Suno 제목 칸에 따로 넣으므로 뺀다) */
  readonly lyrics: string;
  /** `스타일 문구 복사`: 분위기·빠르기 영어 문구. 칩을 고르지 않았으면 빈 문자열 */
  readonly style: string;
}

export interface StudentExport {
  /** `글 복사`와 `.txt` 파일 내용(같은 글자) */
  readonly text: string;
  /** `{제목 또는 글 종류}_{YYYYMMDD}.txt` */
  readonly fileName: string;
  /** 노래 가사만. 다른 글 종류는 `null`(메뉴에 Suno 항목을 보이지 않는다) */
  readonly suno: SunoExport | null;
}

/** 학생 글 하나를 내보낼 글자로 만든다(PRD F-12). */
export function buildStudentExport(input: StudentExportInput, options: StudentExportOptions): StudentExport {
  const titlePart = sanitizeFileNamePart(input.title);
  const namePart = titlePart.length > 0 ? titlePart : sanitizeFileNamePart(genreLabelOf(input));
  const fileName = joinFileName([namePart, compactDateKey(options.now, options.timeZone)], TEXT_FILE_EXT);

  const supportsSuno = isGenreId(input.genre) && GENRE_CATALOG[input.genre].supportsSunoExport;
  const suno: SunoExport | null = supportsSuno
    ? {
        lyrics: toSunoLyrics(input.body),
        style: toSunoStylePrompt({ mood: input.mood, moodCustom: input.moodCustom, tempo: input.tempo }),
      }
    : null;

  return { text: composePlainText(input.title, input.body), fileName, suno };
}

/** `글 파일로 저장(.txt)`: UTF-8 + BOM 파일로 내려받게 한다. */
export function saveStudentTextFile(download: DownloadPort, exported: StudentExport): void {
  download.save({ name: exported.fileName, blob: textFileBlob(exported.text) });
}
