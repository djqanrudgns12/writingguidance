import { defaultConfig, MS_PER_MINUTE, MS_PER_SECOND, type TimerStatus } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';

/**
 * 알림 팝오버의 타이머 칸 모양(PRD F-19)과 순수 계산. 화면과 결합 쪽이 같이 쓴다.
 */

/** 서버가 보내는 타이머 상태를 화면에 필요한 만큼만 줄인 것. */
export interface TimerModel {
  readonly status: TimerStatus;
  /** 남은 초(서버 시각으로 보정한 값). 멈춤일 때는 멈춘 순간의 남은 초. */
  readonly remainingSec: number | null;
}

export type TimerPreset = number | 'custom';

export interface TimerAlertsDraft {
  readonly fiveMin: boolean;
  readonly oneMin: boolean;
  readonly end: boolean;
}

export interface TimerDraft {
  readonly preset: TimerPreset;
  /** `직접` 칸에 쓴 분(글자 그대로). */
  readonly customMinutes: string;
  readonly alerts: TimerAlertsDraft;
  readonly endText: string;
}

/**
 * 자동 알림이 울리는 남은 분(PRD F-19 "5분 전·1분 전"). PRD 12.3 설정 표에 없는 값이라 여기 한 곳에만 둔다.
 * (설정으로 옮기면 이 상수만 바꾼다.)
 */
export const TIMER_ALERT_MINUTES = { fiveMin: 5, oneMin: 1 } as const;

export function initialTimerDraft(presets: readonly number[] = defaultConfig.TIMER_PRESETS_MIN): TimerDraft {
  return {
    preset: presets[0] ?? 'custom',
    customMinutes: '',
    alerts: { fiveMin: true, oneMin: true, end: true },
    endText: ko.teacher.timerEndDefaultText,
  };
}

/** 고른 길이(분). `직접`이 비었거나 범위를 벗어나면 null. */
export function timerDraftMinutes(
  draft: TimerDraft,
  maxMinutes: number = defaultConfig.TIMER_MAX_MIN,
): number | null {
  if (draft.preset !== 'custom') return draft.preset;
  const n = Number.parseInt(draft.customMinutes, 10);
  if (!Number.isFinite(n) || n < 1 || n > maxMinutes) return null;
  return n;
}

/** 타이머 길이와 같거나 더 이른 알림은 꺼서 보여 준다(예: 5분 타이머의 `5분 전`). */
export function timerAlertAvailable(minutes: number | null, alertMinutes: number): boolean {
  return minutes !== null && alertMinutes < minutes;
}

/** `timer.start` 명령 인자(PLAN §4.4). `끝났을 때`를 끄면 끝 문구를 비워 보낸다. */
export function timerDraftToCommand(
  draft: TimerDraft,
  maxMinutes: number = defaultConfig.TIMER_MAX_MIN,
): { durationSec: number; alerts: number[]; endText: string } | null {
  const minutes = timerDraftMinutes(draft, maxMinutes);
  if (minutes === null) return null;
  const alerts: number[] = [];
  if (draft.alerts.fiveMin && timerAlertAvailable(minutes, TIMER_ALERT_MINUTES.fiveMin))
    alerts.push(TIMER_ALERT_MINUTES.fiveMin);
  if (draft.alerts.oneMin && timerAlertAvailable(minutes, TIMER_ALERT_MINUTES.oneMin))
    alerts.push(TIMER_ALERT_MINUTES.oneMin);
  return {
    durationSec: (minutes * MS_PER_MINUTE) / MS_PER_SECOND,
    alerts,
    endText: draft.alerts.end ? draft.endText.trim() : '',
  };
}
