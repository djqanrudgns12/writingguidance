import { ko } from '@geulbang/core/copy';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './Panel.module.css';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly as?: 'section' | 'aside' | 'div' | undefined;
  /** 읽기 전용 패널: 그림자 없이 옅은 선 1px만 둔다(PRD 8.4). */
  readonly readOnly?: boolean | undefined;
  /** 머리 아이콘 칩 아이콘. */
  readonly icon?: IconName | undefined;
  /** 머리 아이콘 칩 글자(예: 글벗 한마디, 맞춤법). */
  readonly badgeText?: string | undefined;
  /** 머리 캐릭터/그림 자리(예: 작은 글벗 얼굴, PRD 8.4). */
  readonly headerMedia?: ReactNode | undefined;
  readonly title?: ReactNode | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly closeLabel?: string | undefined;
  readonly footer?: ReactNode | undefined;
  readonly children?: ReactNode | undefined;
}

/**
 * 결과 패널·메모 카드·도움 질문 패널 부품(PRD 8.4, F-06, F-08, PLAN §9.2).
 * 말풍선 꼬리 없이 비대칭 종이 카드 모양을 따르며, 머리에 아이콘 칩과 닫기 단추를 둔다.
 */
export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  {
    as: Tag = 'section',
    readOnly = false,
    icon,
    badgeText,
    headerMedia,
    title,
    onClose,
    closeLabel = ko.common.close,
    footer,
    className,
    children,
    ...rest
  },
  ref,
) {
  const hasHeader = Boolean(icon || badgeText || headerMedia || title || onClose);
  const classes = [styles.panel, readOnly ? styles.readOnly : styles.elevated, className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <Tag ref={ref as never} data-readonly={readOnly ? 'true' : 'false'} className={classes} {...rest}>
      {hasHeader ? (
        <header className={styles.header}>
          <div className={styles.headerLead}>
            {headerMedia ? <span className={styles.media}>{headerMedia}</span> : null}
            <div className={styles.titles}>
              {badgeText ? (
                <span className={styles.badge}>
                  {icon ? <Icon name={icon} size={16} /> : null}
                  <span>{badgeText}</span>
                </span>
              ) : null}
              {title || (!badgeText && icon) ? (
                <div className={styles.titleRow}>
                  {!badgeText && icon ? (
                    <span className={styles.titleIcon}>
                      <Icon name={icon} size={20} />
                    </span>
                  ) : null}
                  {title ? <h3 className={styles.title}>{title}</h3> : null}
                </div>
              ) : null}
            </div>
          </div>
          {onClose ? (
            <button type="button" className={styles.closeButton} aria-label={closeLabel} onClick={onClose}>
              <Icon name="close" size={20} />
            </button>
          ) : null}
        </header>
      ) : null}
      <div className={styles.body}>{children}</div>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </Tag>
  );
});
