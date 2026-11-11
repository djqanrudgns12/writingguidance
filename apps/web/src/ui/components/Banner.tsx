import { ko } from '@geulbang/core/copy';
import { type HTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './Banner.module.css';

export type BannerTone = 'warning' | 'info' | 'notice' | 'danger';
export type BannerKind = 'offline' | 'closed' | 'unsent' | 'custom';

export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
  readonly kind?: BannerKind | undefined;
  readonly tone?: BannerTone | undefined;
  readonly icon?: IconName | undefined;
  readonly message?: string | undefined;
  readonly action?: ReactNode | undefined;
  readonly onDismiss?: (() => void) | undefined;
  readonly dismissLabel?: string | undefined;
  /**
   * 행동 단추를 글 옆 같은 줄에 붙잡아 둔다(좁으면 글만 줄을 바꾼다). 기본은 글이 200px보다 좁아지면 단추가 아래 줄로 내려간다.
   * 띠가 여러 개 쌓이는 교사 대시보드에서 띠 높이를 줄이려고 쓴다(P5-4 시각 검토 2번).
   */
  readonly inlineAction?: boolean | undefined;
  readonly children?: ReactNode | undefined;
}

const DEFAULT_TONE_BY_KIND: Record<BannerKind, BannerTone> = {
  offline: 'warning',
  closed: 'info',
  unsent: 'warning',
  custom: 'notice',
};

const DEFAULT_ICON_BY_KIND: Record<BannerKind, IconName> = {
  offline: 'offline',
  closed: 'locked',
  unsent: 'localOnly',
  custom: 'notice',
};

const DEFAULT_ICON_BY_TONE: Record<BannerTone, IconName> = {
  warning: 'offline',
  info: 'locked',
  notice: 'notice',
  danger: 'warning',
};

/**
 * 상단 얇은 상태·안내 띠 부품(오프라인·닫힘·이어 쓰기 요청·만료 경고·교사 알림, PRD 7.2, F-02, F-09, PLAN §9.2).
 * 색만으로 구분하지 않도록 아이콘과 글자를 늘 함께 그린다.
 */
export function Banner({
  kind = 'custom',
  tone,
  icon,
  message,
  action,
  onDismiss,
  dismissLabel = ko.common.close,
  inlineAction = false,
  className,
  children,
  ...rest
}: BannerProps) {
  const resolvedTone = tone ?? DEFAULT_TONE_BY_KIND[kind];
  const resolvedIcon =
    icon ?? (kind !== 'custom' ? DEFAULT_ICON_BY_KIND[kind] : DEFAULT_ICON_BY_TONE[resolvedTone]);

  const defaultMessage =
    kind === 'offline'
      ? ko.student.offlineBanner
      : kind === 'closed'
        ? ko.student.closedBanner
        : kind === 'unsent'
          ? ko.student.unsentBanner
          : undefined;

  const content = children ?? message ?? defaultMessage;

  const classes = [
    styles.banner,
    styles[resolvedTone],
    inlineAction ? styles.inlineAction : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      role="status"
      aria-live="polite"
      data-kind={kind}
      data-tone={resolvedTone}
      className={classes}
      {...rest}
    >
      <div className={styles.lead}>
        <Icon name={resolvedIcon} size={20} className={styles.icon ?? ''} />
        <div className={styles.text}>{content}</div>
      </div>
      {action || onDismiss ? (
        <div className={styles.actions}>
          {action}
          {onDismiss ? (
            <button
              type="button"
              className={styles.dismissButton}
              aria-label={dismissLabel}
              onClick={onDismiss}
            >
              <Icon name="close" size={16} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
