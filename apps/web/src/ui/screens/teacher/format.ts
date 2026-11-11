import {
  defaultConfig,
  GENRE_CATALOG,
  GENRE_IDS,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  type AiButton,
  type GenreId,
  type SnapshotReason,
  type StudentCopyKey,
} from '@geulbang/core';
import { ko } from '@geulbang/core/copy';

/**
 * 교사 화면이 함께 쓰는 표시용 순수 함수(화면 배치 P3-9t).
 * 문구는 `ko`에서만, 시간대는 설정(`TIMEZONE`)에서만 가져온다. 화면은 숫자(ms)를 받고 여기서 글자로 바꾼다.
 */

const clockFormatters = new Map<string, Intl.DateTimeFormat>();
const monthDayFormatters = new Map<string, Intl.DateTimeFormat>();

function clockFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = clockFormatters.get(timeZone);
  if (!f) {
    // en-GB 24시간제는 `10:31` 모양을 준다(타일의 제출 시각, PRD F-17).
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    clockFormatters.set(timeZone, f);
  }
  return f;
}

function monthDayFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = monthDayFormatters.get(timeZone);
  if (!f) {
    // 삭제 예정일은 "11월 30일"처럼 보인다. 글자는 기기 언어 자료가 만든다(화면 파일에 한국어를 쓰지 않으려고).
    f = new Intl.DateTimeFormat('ko-KR', { timeZone, month: 'long', day: 'numeric' });
    monthDayFormatters.set(timeZone, f);
  }
  return f;
}

/** "방금", "12초 전", "4분 전", "2시간 전", "3일 전" (PRD F-17 타일 마지막 입력). */
export function formatAgo(atMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - atMs);
  if (diff < MS_PER_SECOND) return ko.common.timeJustNow;
  if (diff < MS_PER_MINUTE) return `${Math.floor(diff / MS_PER_SECOND)}${ko.common.timeSecondsAgoSuffix}`;
  if (diff < MS_PER_HOUR) return `${Math.floor(diff / MS_PER_MINUTE)}${ko.common.timeMinutesAgoSuffix}`;
  if (diff < MS_PER_DAY) return `${Math.floor(diff / MS_PER_HOUR)}${ko.common.timeHoursAgoSuffix}`;
  return `${Math.floor(diff / MS_PER_DAY)}${ko.common.timeDaysAgoSuffix}`;
}

/** `10:31` (설정 시간대 기준). */
export function formatClock(atMs: number, timeZone: string = defaultConfig.TIMEZONE): string {
  return clockFormatter(timeZone).format(atMs);
}

/** "11월 30일" (설정 시간대 기준, 삭제 예정일). */
export function formatMonthDay(atMs: number, timeZone: string = defaultConfig.TIMEZONE): string {
  return monthDayFormatter(timeZone).format(atMs);
}

/** 연결 점검 왕복 시간 "0.03초"(PRD F-16). */
export function formatSeconds(ms: number): string {
  // 소수 둘째 자리까지: 학교 와이파이 왕복은 보통 수십 ms라 0.0x초로 보인다.
  return `${(Math.max(0, ms) / MS_PER_SECOND).toFixed(2)}${ko.common.delaySecondsSuffix}`;
}

/** "18/21" 같은 개수 표시. */
export function formatRatio(part: number, whole: number): string {
  return `${part}/${whole}`;
}

/** "5분" 같은 분 표시(타이머 프리셋 칩). */
export function formatMinutes(minutes: number): string {
  return `${minutes}${ko.common.minutesUnit}`;
}

export function isGenreId(value: string): value is GenreId {
  return (GENRE_IDS as readonly string[]).includes(value);
}

function studentCopy(key: StudentCopyKey): string {
  return ko.student[key];
}

/** 글 종류 이름(타일·서랍). 모르는 종류는 빈 글자. */
export function genreLabel(genre: string | null): string {
  if (genre === null || !isGenreId(genre)) return '';
  return studentCopy(GENRE_CATALOG[genre].labelKey);
}

/** 글 종류 고르기 타일의 작은 글씨(T1·설정의 글 종류 체크 설명). */
export function genreSubtitle(genre: GenreId): string {
  return studentCopy(GENRE_CATALOG[genre].subtitleKey);
}

/**
 * 타일에 보일 글 종류(PRD F-17 그림: "기사", "포스터", "웹툰 대사").
 * 기타 문구는 용도 이름을, 나머지는 큰 글 종류 이름을 쓴다.
 */
export function docKindLabel(genre: string | null, purpose?: string | null): string {
  if (genre === null || !isGenreId(genre)) return '';
  const def = GENRE_CATALOG[genre];
  if (purpose) {
    const found = def.purposes.find(p => p.id === purpose);
    if (found) return studentCopy(found.labelKey);
  }
  return studentCopy(def.labelKey);
}

const AI_BUTTON_LABEL: Readonly<Record<AiButton, StudentCopyKey>> = {
  SPELL: 'aiSpellLabel',
  FEEDBACK: 'aiFeedbackLabel',
  DIRECTION: 'aiDirectionLabel',
  POLISH: 'aiPolishLabel',
};

export function aiButtonLabel(button: AiButton): string {
  return studentCopy(AI_BUTTON_LABEL[button]);
}

const SNAPSHOT_REASON_LABEL: Readonly<Record<SnapshotReason, string>> = {
  AUTO: ko.common.rewindReasonAuto,
  SUBMIT: ko.common.rewindReasonSubmit,
  AI: ko.common.rewindReasonAi,
  TEACHER: ko.common.rewindReasonTeacher,
  RESTORE: ko.common.rewindReasonRestore,
};

/** 시간 되감기 이유 글자("제출할 때"). */
export function snapshotReasonLabel(reason: SnapshotReason): string {
  return SNAPSHOT_REASON_LABEL[reason];
}

/** 두 글자를 " · "로 잇는다(빈 글자는 뺀다). */
export function joinDot(...parts: readonly string[]): string {
  return parts.filter(Boolean).join(' · ');
}
