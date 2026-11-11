import { ko } from '@geulbang/core/copy';
import { type HTMLAttributes } from 'react';
import { Icon } from '../icons/Icon.tsx';
import styles from './NoticeDrop.module.css';

export interface NoticeDropProps extends HTMLAttributes<HTMLDivElement> {
  readonly message: string;
  readonly senderLabel?: string | undefined;
  readonly closeLabel?: string | undefined;
  readonly onDismiss?: (() => void) | undefined;
}

/**
 * 교사가 보낸 알림·타이머 안내가 학생 화면 위에서 종이 띠로 내려오는 부품(PRD F-19, PLAN §9.2).
 * - `aria-live="polite"`로 스크린 리더에 알리고, 기기 동작 줄이기 설정을 존중한다.
 */
export function NoticeDrop({
  message,
  senderLabel = ko.common.teacherCursorLabel,
  closeLabel = ko.common.close,
  onDismiss,
  className,
  ...rest
}: NoticeDropProps) {
  const classes = [styles.noticeDrop, className ?? ''].filter(Boolean).join(' ');

  return (
    <div role="status" aria-live="polite" className={classes} {...rest}>
      <span className={styles.senderBadge}>
        <Icon name="notice" size={16} />
        <span>{senderLabel}</span>
      </span>
      <p className={styles.message}>{message}</p>
      {onDismiss ? (
        <button type="button" aria-label={closeLabel} className={styles.dismissButton} onClick={onDismiss}>
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );
}
