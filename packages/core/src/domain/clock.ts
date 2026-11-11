/**
 * 시간 규칙(ADR-021): 저장은 UTC 밀리초, "하루"의 경계는 설정의 시간대(`TIMEZONE`, 한국 시각)로 센다.
 */

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dayFormatters.get(timeZone);
  if (!f) {
    // en-CA는 YYYY-MM-DD 모양을 준다.
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(timeZone, f);
  }
  return f;
}

/** 그 시각이 속한 날(`YYYY-MM-DD`, 주어진 시간대 기준). AI 하루 한도·속도 칸·삭제 예정일 키로 쓴다. */
export function dayKey(nowMs: number, timeZone: string): string {
  return dayFormatter(timeZone).format(nowMs);
}

/** 그 시각이 속한 날의 연·월·일 숫자(주어진 시간대 기준). 화면 날짜 조합에 쓴다. */
export function dateParts(nowMs: number, timeZone: string): DateParts {
  const key = dayKey(nowMs, timeZone);
  const [y, m, d] = key.split('-');
  return {
    year: Number(y),
    month: Number(m),
    day: Number(d),
  };
}

/** 파일 이름용 날짜 문자열(`YYYYMMDD`, PRD F-12·F-21). */
export function compactDateKey(nowMs: number, timeZone: string): string {
  return dayKey(nowMs, timeZone).replaceAll('-', '');
}
