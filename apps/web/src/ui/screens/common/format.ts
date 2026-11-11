import { ko } from '@geulbang/core/copy';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * 받은 시각·마지막 사용을 "방금", "3분 전"처럼 쓴다(PRD F-08 결과 패널 아래, F-10 되감기 시각).
 * 1분 안은 모두 "방금"이다. 기기 시계가 앞서 미래 시각이 오면 "방금"으로 둔다.
 */
export function formatAgo(now: number, at: number): string {
  const diff = Math.max(0, now - at);
  if (diff < MINUTE_MS) return ko.common.timeJustNow;
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}${ko.common.timeMinutesAgoSuffix}`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}${ko.common.timeHoursAgoSuffix}`;
  return `${Math.floor(diff / DAY_MS)}${ko.common.timeDaysAgoSuffix}`;
}

const monthDayFormat = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' });

/** 삭제 예정일 같은 날짜를 "12월 11일"로 쓴다(PRD F-24, 13.1). 글자는 `Intl`이 만든다. */
export function formatMonthDay(at: number): string {
  return monthDayFormat.format(new Date(at));
}
