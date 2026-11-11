import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { homeFrames, type HomeFrameName } from '../art/frames/home.ts';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './PaperCard.module.css';

export type PaperCardFrameSize = 'sm' | 'md' | 'lg';

export interface PaperCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly as?: 'div' | 'section' | 'article' | 'aside' | undefined;
  /** 읽기 전용 카드: 그림자 없이 옅은 선 1px만 둔다(PRD 8.4). */
  readonly readOnly?: boolean | undefined;
  /** 홈 수업 카드 등 화면당 핵심 카드 1개에 빌드 때 만든 손그림 테두리 SVG를 씌운다(PRD 8.3, PLAN §9.2). */
  readonly handDrawnFrame?: boolean | PaperCardFrameSize | undefined;
  /** 머리 아이콘 칩 아이콘. */
  readonly headerIcon?: IconName | undefined;
  /** 머리 아이콘 칩 글자. */
  readonly headerLabel?: string | undefined;
  readonly title?: ReactNode | undefined;
  readonly headerAction?: ReactNode | undefined;
  readonly padding?: 'sm' | 'md' | 'lg' | undefined;
  readonly children?: ReactNode | undefined;
}

/**
 * 비대칭 둥근 모서리(`--r-card`) 종이 카드 부품(PRD 8.3, 8.4, PLAN §9.2).
 * - 기본: 코코아 잉크 실선 1.5px + 종이 그림자(`--shadow-paper`)
 * - 읽기 전용(`readOnly`): 그림자 없이 옅은 선 1px(`--line`)
 * - 손그림 테두리판(`handDrawnFrame`): 고정 씨앗값 흔들림 선 SVG(`home-card-sm|md|lg`)를 테두리로 얹는다.
 */
export const PaperCard = forwardRef<HTMLElement, PaperCardProps>(function PaperCard(
  {
    as: Tag = 'div',
    readOnly = false,
    handDrawnFrame = false,
    headerIcon,
    headerLabel,
    title,
    headerAction,
    padding = 'md',
    className,
    children,
    ...rest
  },
  ref,
) {
  const hasHeader = Boolean(headerIcon || headerLabel || title || headerAction);
  const frameKey: HomeFrameName | undefined =
    handDrawnFrame === 'sm'
      ? 'home-card-sm'
      : handDrawnFrame === 'lg'
        ? 'home-card-lg'
        : handDrawnFrame
          ? 'home-card-md'
          : undefined;
  const frameEntry = frameKey ? homeFrames[frameKey] : undefined;

  const classes = [
    styles.card,
    readOnly ? styles.readOnly : frameEntry ? styles.handDrawnPaper : styles.interactivePaper,
    styles[`pad_${padding}`],
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag
      ref={ref as never}
      data-readonly={readOnly ? 'true' : 'false'}
      data-hand-drawn={frameEntry ? frameKey : undefined}
      className={classes}
      {...rest}
    >
      {frameEntry ? (
        <img
          src={frameEntry.src}
          width={frameEntry.width}
          height={frameEntry.height}
          alt=""
          aria-hidden="true"
          className={styles.frameOverlay}
        />
      ) : null}
      {hasHeader ? (
        <header className={styles.header}>
          <div className={styles.headerMain}>
            {headerIcon || headerLabel ? (
              <span className={styles.headerChip}>
                {headerIcon ? <Icon name={headerIcon} size={16} /> : null}
                {headerLabel ? <span>{headerLabel}</span> : null}
              </span>
            ) : null}
            {title ? <div className={styles.title}>{title}</div> : null}
          </div>
          {headerAction ? <div className={styles.headerAction}>{headerAction}</div> : null}
        </header>
      ) : null}
      <div className={styles.body}>{children}</div>
    </Tag>
  );
});
