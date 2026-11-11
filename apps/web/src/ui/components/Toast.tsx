import { ko } from '@geulbang/core/copy';
import { type HTMLAttributes } from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './Toast.module.css';

export type ToastTone = 'default' | 'warning' | 'danger';

export interface ToastProps extends HTMLAttributes<HTMLDivElement> {
  readonly message: string;
  readonly tone?: ToastTone | undefined;
  readonly icon?: IconName | undefined;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  readonly onDismiss?: (() => void) | undefined;
  readonly dismissLabel?: string | undefined;
}

const DEFAULT_ICON: Record<ToastTone, IconName> = {
  default: 'notice',
  warning: 'undo',
  danger: 'warning',
};

/**
 * 하단 종이 토스트 한 줄 부품(오류·되살리기·선생님 함께 고침 안내, PRD 7.2, F-06, PLAN §9.2).
 */
export function Toast({
  message,
  tone = 'default',
  icon,
  actionLabel,
  onAction,
  onDismiss,
  dismissLabel = ko.common.close,
  className,
  ...rest
}: ToastProps) {
  const resolvedIcon = icon ?? DEFAULT_ICON[tone];
  const classes = [styles.toast, styles[tone], className ?? ''].filter(Boolean).join(' ');

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
      data-tone={tone}
      className={classes}
      {...rest}
    >
      <div className={styles.lead}>
        <Icon name={resolvedIcon} size={20} className={styles.icon ?? ''} />
        <span className={styles.message}>{message}</span>
      </div>
      {actionLabel && onAction ? (
        <button type="button" className={styles.actionButton} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
      {onDismiss ? (
        <button type="button" className={styles.dismissButton} aria-label={dismissLabel} onClick={onDismiss}>
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );
}
