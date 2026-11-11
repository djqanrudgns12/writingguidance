import { type HTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './MemoCard.module.css';

export type MemoCardTone = 'default' | 'praise' | 'improve' | 'note';

export interface MemoCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly heading?: ReactNode | undefined;
  readonly badge?: ReactNode | undefined;
  readonly icon?: IconName | undefined;
  readonly tone?: MemoCardTone | undefined;
  /** 눌리는 카드 변형: 기본 읽기 전용 메모는 그림자 없이 옅은 선으로 두고, 눌리는 카드에만 그림자를 준다(PRD 8.4). */
  readonly interactive?: boolean | undefined;
  readonly footer?: ReactNode | undefined;
  readonly children?: ReactNode | undefined;
}

/**
 * 글벗 한마디·다음 방향 결과용 메모 카드 부품(PRD 8.4, 8.10, PLAN §9.2).
 * - 챗봇처럼 보이는 말풍선 꼬리를 절대 두지 않고 단정한 종이 메모 모양으로 그린다.
 * - 기본(읽기 전용)은 그림자 없는 옅은 선이며, `interactive` 변형에만 그림자를 둔다.
 */
export function MemoCard({
  heading,
  badge,
  icon,
  tone = 'default',
  interactive = false,
  footer,
  className,
  children,
  ...rest
}: MemoCardProps) {
  const hasHeader = Boolean(heading || badge || icon);
  const classes = [styles.card, styles[tone], interactive ? styles.interactive : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <article data-tone={tone} data-interactive={interactive ? 'true' : 'false'} className={classes} {...rest}>
      {hasHeader ? (
        <header className={styles.header}>
          <div className={styles.headingGroup}>
            {icon ? <Icon name={icon} size={16} className={styles.icon ?? ''} /> : null}
            {heading ? <strong className={styles.heading}>{heading}</strong> : null}
          </div>
          {badge ? <span className={styles.badge}>{badge}</span> : null}
        </header>
      ) : null}
      <div className={styles.body}>{children}</div>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </article>
  );
}
