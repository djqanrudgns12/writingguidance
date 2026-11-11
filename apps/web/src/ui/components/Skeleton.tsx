import { ko } from '@geulbang/core/copy';
import { useEffect, useState, type HTMLAttributes } from 'react';
import styles from './Skeleton.module.css';

export type SkeletonVariant = 'card' | 'tile' | 'line';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  readonly variant?: SkeletonVariant | undefined;
  readonly lines?: number | undefined;
  readonly label?: string | undefined;
  /** 안내 글자(`준비하고 있어요`)를 바로 보여 줄지 여부. `false`면 `delayMs`(기본 1000ms, PRD 7.2) 뒤에 보인다. */
  readonly showLabelImmediately?: boolean | undefined;
  readonly delayMs?: number | undefined;
}

/**
 * 불러오는 중 종이 카드 자리표시 부품(PRD 7.2, PLAN §9.2).
 * 1초가 넘으면 "준비하고 있어요" 안내 글자를 함께 표시한다.
 */
export function Skeleton({
  variant = 'card',
  lines = 3,
  label = ko.common.loading,
  showLabelImmediately = false,
  delayMs = 1000,
  className,
  ...rest
}: SkeletonProps) {
  const [labelVisible, setLabelVisible] = useState(showLabelImmediately || delayMs <= 0);

  useEffect(() => {
    if (showLabelImmediately || delayMs <= 0) {
      setLabelVisible(true);
      return;
    }
    setLabelVisible(false);
    const timer = window.setTimeout(() => {
      setLabelVisible(true);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [showLabelImmediately, delayMs]);

  const safeLines = Math.max(1, lines);
  const classes = [styles.skeleton, styles[variant], className ?? ''].filter(Boolean).join(' ');

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={label}
      data-variant={variant}
      className={classes}
      {...rest}
    >
      <div className={styles.bars} aria-hidden="true">
        {Array.from({ length: safeLines }, (_, idx) => (
          <span
            key={idx}
            className={`${styles.bar} ${idx === safeLines - 1 && safeLines > 1 ? styles.shortBar : ''}`}
          />
        ))}
      </div>
      {labelVisible ? <p className={styles.label}>{label}</p> : null}
    </div>
  );
}
