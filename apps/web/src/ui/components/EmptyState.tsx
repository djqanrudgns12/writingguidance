import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import {
  frameDimensions,
  getResolvedFrameEntry,
  loadLazyFrames,
  type FrameName,
} from '../art/frames/home.ts';
import { artDimensions, getResolvedArtEntry, loadLazyArt, type ArtName } from '../art/home.ts';
import { Button, type ButtonVariant } from './Button.tsx';
import styles from './EmptyState.module.css';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 한 줄 안내 문구(PRD 7.2). */
  readonly title: string;
  readonly description?: string | undefined;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  readonly actionVariant?: ButtonVariant | undefined;
  /** `ui/art`의 그림 이름(예: `'empty-desks'`, `'closed-door'`, `'waiting-letter'`, `'offline-umbrella'`). */
  readonly artName?: ArtName | undefined;
  readonly artAlt?: string | undefined;
  readonly artWidth?: number | undefined;
  readonly artPriority?: boolean | undefined;
  /** 빈 화면 그림 둘레에 손그림 테두리 SVG를 두를지 여부(PRD 8.3). */
  readonly frameSize?: 'sm' | 'md' | 'lg' | false | undefined;
  /** 직접 넣을 그림 요소(`artName`이 없을 때 쓰거나 함께 얹는다). */
  readonly children?: ReactNode | undefined;
  /**
   * 안내 글(제목·설명)이 바뀌면 보조기기에 알린다. 알림 영역은 글만 감싸고 단추는 밖에 둔다
   * (라이브 영역 안 단추는 알릴 때 이름까지 함께 읽힌다, P5-1 [하-3]).
   */
  readonly liveText?: boolean | undefined;
}

/**
 * 빈 화면·만료 화면 부품(작은 그림 + 한 줄 안내 + 단추 하나, PRD 7.2, 8.3, F-02, F-17, PLAN §9.2).
 * - `artName`을 넘기면 `ui/art`의 1x·2x WebP를 연결하고, 손그림 테두리 SVG(`empty-sm|md|lg`)를 둘레에 씌운다.
 */
export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  actionVariant = 'primary',
  artName,
  artAlt = '',
  artWidth = 180,
  artPriority = false,
  frameSize = 'md',
  liveText = false,
  className,
  children,
  ...rest
}: EmptyStateProps) {
  const classes = [styles.empty, className ?? ''].filter(Boolean).join(' ');
  const artDims = artName ? artDimensions[artName] : undefined;
  const artEntry = artName ? getResolvedArtEntry(artName) : undefined;
  const artHeight = artDims ? Math.max(1, Math.round((artWidth * artDims.height) / artDims.width)) : 0;
  const frameKey: FrameName | undefined =
    frameSize === 'sm'
      ? 'empty-sm'
      : frameSize === 'lg'
        ? 'empty-lg'
        : frameSize === 'md'
          ? 'empty-md'
          : undefined;
  const frameDims = frameKey ? frameDimensions[frameKey] : undefined;
  const frameEntry = frameKey ? getResolvedFrameEntry(frameKey) : undefined;
  const hasIllustration = Boolean(artDims || children);
  const [, setTick] = useState(0);

  useEffect(() => {
    const needArt = Boolean(artName && !getResolvedArtEntry(artName));
    const needFrame = Boolean(hasIllustration && frameKey && !getResolvedFrameEntry(frameKey));
    if (!needArt && !needFrame) return;
    let alive = true;
    void Promise.all([
      needArt ? loadLazyArt() : Promise.resolve(),
      needFrame ? loadLazyFrames() : Promise.resolve(),
    ]).then(() => {
      if (alive) setTick(t => t + 1);
    });
    return () => {
      alive = false;
    };
  }, [artName, frameKey, hasIllustration]);

  return (
    <div className={classes} {...rest}>
      {hasIllustration ? (
        <div
          className={[styles.illustration, frameDims ? styles.framedIllustration : '']
            .filter(Boolean)
            .join(' ')}
        >
          {frameDims ? (
            <img
              src={frameEntry?.src}
              width={frameDims.width}
              height={frameDims.height}
              alt=""
              aria-hidden="true"
              className={styles.frameOverlay}
            />
          ) : null}
          {artDims ? (
            <img
              src={artEntry?.src1x}
              srcSet={artEntry ? `${artEntry.src1x} 1x, ${artEntry.src2x} 2x` : undefined}
              width={artWidth}
              height={artHeight}
              loading={artPriority ? 'eager' : 'lazy'}
              fetchPriority={artPriority ? 'high' : undefined}
              decoding="async"
              alt={artAlt}
              aria-hidden={artAlt ? undefined : true}
              data-art={artName}
              className={styles.artImage}
            />
          ) : null}
          {children}
        </div>
      ) : null}
      {liveText ? (
        <div className={styles.text} role="status" aria-live="polite">
          <p className={styles.title}>{title}</p>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
      ) : (
        <>
          <p className={styles.title}>{title}</p>
          {description ? <p className={styles.description}>{description}</p> : null}
        </>
      )}
      {actionLabel && onAction ? (
        <div className={styles.action}>
          <Button variant={actionVariant} onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
