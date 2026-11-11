import { ko } from '@geulbang/core/copy';
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type MouseEvent, type Ref } from 'react';
import { Icon } from '../icons/Icon.tsx';
import styles from './TimerPill.module.css';

export type TimerPillState = 'running' | 'paused' | 'urgent' | 'ended';

export interface TimerPillProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick'> {
  /** 남은 시간(초). 고정폭 `MM:SS`로 표시한다. */
  readonly remainingSeconds: number;
  readonly state?: TimerPillState | undefined;
  readonly statusLabel?: string | undefined;
  /** `onClick`이 없어도 `<button>`으로 그려 메뉴·팝오버 트리거(`render={<TimerPill asButton ... />}`)로 쓸 수 있게 한다. */
  readonly asButton?: boolean | undefined;
  /** 교사 화면에서 눌러 멈춤·취소 메뉴를 열 때 전달한다. */
  readonly onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
}

export function formatTimerSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 수업 타이머 알약 부품(PRD F-06, F-17, F-19, PLAN §9.2).
 * 색만으로 구분하지 않도록 아이콘 + 고정폭 시간(`08:12`) + 상태 글자를 함께 표시한다.
 */
export const TimerPill = forwardRef<HTMLElement, TimerPillProps>(function TimerPill(
  { remainingSeconds, state, statusLabel, asButton = false, onClick, className, ...rest },
  ref,
) {
  const resolvedState: TimerPillState =
    state ?? (remainingSeconds <= 0 ? 'ended' : remainingSeconds <= 60 ? 'urgent' : 'running');

  const resolvedLabel =
    statusLabel ??
    (resolvedState === 'paused'
      ? ko.common.timerPaused
      : resolvedState === 'ended'
        ? ko.common.timerEnded
        : ko.common.timerRunning);

  const timeText = formatTimerSeconds(remainingSeconds);
  const iconName = resolvedState === 'paused' ? 'clock' : 'timer';
  const isButton = Boolean(asButton || onClick);
  const classes = [styles.pill, styles[resolvedState], isButton ? styles.interactive : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <Icon name={iconName} size={16} className={styles.icon ?? ''} />
      <span className={styles.time}>{timeText}</span>
      <span className={styles.status}>{resolvedLabel}</span>
    </>
  );

  if (isButton) {
    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        type="button"
        data-state={resolvedState}
        className={classes}
        onClick={onClick}
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      ref={ref as Ref<HTMLSpanElement>}
      role="timer"
      data-state={resolvedState}
      className={classes}
      {...rest}
    >
      {content}
    </span>
  );
});
