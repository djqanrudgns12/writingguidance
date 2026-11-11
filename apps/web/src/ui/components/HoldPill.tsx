import { ko } from '@geulbang/core/copy';
import { type HTMLAttributes } from 'react';
import { Icon } from '../icons/Icon.tsx';
import styles from './HoldPill.module.css';

export interface HoldPillProps extends HTMLAttributes<HTMLDivElement> {
  readonly visible?: boolean | undefined;
  readonly label?: string | undefined;
}

/**
 * 한글 입력 중 원격 변경이 3초 넘게 보류될 때 띄우는 라벤더 알약(PRD 9.3 6번, PLAN §9.2).
 * 기본 문구: "선생님이 고친 곳은 잠시 뒤 보여요" (`ko.student.holdNotice`).
 */
export function HoldPill({
  visible = true,
  label = ko.student.holdNotice,
  className,
  ...rest
}: HoldPillProps) {
  if (!visible) return null;

  const classes = [styles.pill, className ?? ''].filter(Boolean).join(' ');

  return (
    <div role="status" aria-live="polite" className={classes} {...rest}>
      <Icon name="write" size={16} className={styles.icon ?? ''} />
      <span className={styles.text}>{label}</span>
    </div>
  );
}
