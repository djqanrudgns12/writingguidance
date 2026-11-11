import { ko } from '@geulbang/core/copy';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { StatusBadge, type StudentStatusKind } from './StatusBadge.tsx';
import styles from './StudentTile.module.css';

export interface StudentTileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  readonly nickname: string;
  readonly status: StudentStatusKind;
  readonly statusLabel?: string | undefined;
  readonly genreLabel: string;
  /** 글자 수(숫자면 뒤에 `charCountSuffix`를 붙이고, 문자열이면 그대로 표시). */
  readonly charCount: number | string;
  readonly charCountSuffix?: string | undefined;
  /** 마지막 입력·제출 시각 문자열(예: "12초 전", "10:31 제출"). */
  readonly timeText: string;
  readonly selected?: boolean | undefined;
  /** 컨테이너 질의와 별개로 좁은 폭(배지를 아래 줄로 내림) 배치를 강제할 때 전달한다. */
  readonly compact?: boolean | undefined;
}

/**
 * 교사 대시보드 학생 타일 부품(PRD F-17, 8.4, PLAN §9.2).
 * - 손그림 선·그림·캐릭터 장식 없이 12px 모서리(`--r-sm`), 옅은 선 1px(`--stroke-thin`), 왼쪽 4px 상태 띠만 둔다.
 * - 글자 수와 시각은 고정폭 숫자(`tabular-nums`)로 정렬한다.
 * - 약 150px 좁은 칸(360px 폭 2열 격자)에서는 컨테이너 질의로 상태 배지를 아래 줄로 내려 별명이 잘리지 않게 한다.
 */
export const StudentTile = forwardRef<HTMLButtonElement, StudentTileProps>(function StudentTile(
  {
    nickname,
    status,
    statusLabel,
    genreLabel,
    charCount,
    charCountSuffix = ko.common.charCountSuffix,
    timeText,
    selected = false,
    compact = false,
    type = 'button',
    className,
    ...rest
  },
  ref,
) {
  const statusStripeClass =
    status === 'writing-flow' ? styles.stripe_writingFlow : styles[`stripe_${status}`];
  const classes = [
    styles.tile,
    statusStripeClass,
    selected ? styles.selected : '',
    compact ? styles.compact : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const formattedChars = typeof charCount === 'number' ? `${charCount}${charCountSuffix}` : charCount;

  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      data-status={status}
      data-selected={selected ? 'true' : 'false'}
      data-compact={compact ? 'true' : undefined}
      className={classes}
      {...rest}
    >
      <div className={styles.header}>
        <span className={styles.nickname}>{nickname}</span>
        <StatusBadge status={status} label={statusLabel} className={styles.badge ?? ''} />
      </div>
      <span className={styles.genre}>{genreLabel}</span>
      <div className={styles.metaRow}>
        <span className={styles.charCount} data-testid="student-tile-chars">
          {formattedChars}
        </span>
        <span className={styles.timeText} data-testid="student-tile-time">
          {timeText}
        </span>
      </div>
    </button>
  );
});
