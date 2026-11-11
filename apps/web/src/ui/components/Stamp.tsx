import { ko } from '@geulbang/core/copy';
import { useEffect, useState, type HTMLAttributes } from 'react';
import {
  frameDimensions,
  getResolvedFrameEntry,
  loadLazyFrames,
  type FrameName,
} from '../art/frames/home.ts';
import { artDimensions, getResolvedArtEntry, loadLazyArt } from '../art/home.ts';
import styles from './Stamp.module.css';

export type StampSize = 'sm' | 'md' | 'lg';

export interface StampProps extends HTMLAttributes<HTMLDivElement> {
  /** 도장 한가운데 찍히는 문구(기본값 `ko.student.submitStampText`). */
  readonly text?: string | undefined;
  readonly size?: StampSize | undefined;
  /** 200ms 찍힘 움직임을 켤지 여부(기본 `true`, 기기 동작 줄이기 설정 시 CSS에서 즉시 표시). */
  readonly animate?: boolean | undefined;
  /** 빌드 때 만든 손그림 도장 테두리 SVG를 함께 겹칠지 여부(PRD 8.3). */
  readonly showFrame?: boolean | undefined;
}

const WIDTH_BY_SIZE: Record<StampSize, number> = {
  sm: 180,
  md: 240,
  lg: 280,
};

/**
 * 제출 순간 200ms 동안 찍히는 그림책 도장 부품(PRD F-11, 8.7, 8.8 #7, 8.9, PLAN §9.2).
 * - 빈 도장 테두리 + 옆의 작은 글벗 그림(`submit-stamp`) 위에 `text`를 글꼴로 얹는다.
 * - `prefers-reduced-motion: reduce` 환경에서는 움직임 없이 바로 표시한다.
 */
export function Stamp({
  text = ko.student.submitStampText,
  size = 'md',
  animate = true,
  showFrame = true,
  className,
  ...rest
}: StampProps) {
  const dims = artDimensions['submit-stamp'];
  const entry = getResolvedArtEntry('submit-stamp');
  const width = WIDTH_BY_SIZE[size];
  const height = Math.round((width * dims.height) / dims.width);
  const frameKey: FrameName = size === 'sm' ? 'stamp-sm' : 'stamp-md';
  const frameDims = frameDimensions[frameKey];
  const frameEntry = getResolvedFrameEntry(frameKey);
  const [, setTick] = useState(0);

  useEffect(() => {
    const needArt = !getResolvedArtEntry('submit-stamp');
    const needFrame = showFrame && !getResolvedFrameEntry(frameKey);
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
  }, [frameKey, showFrame]);

  const classes = [styles.stamp, styles[size], animate ? styles.animated : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      role="status"
      aria-live="polite"
      data-size={size}
      data-animated={animate ? 'true' : 'false'}
      className={classes}
      style={{ width: `${width}px`, height: `${height}px` }}
      {...rest}
    >
      <img
        src={entry?.src1x}
        srcSet={entry ? `${entry.src1x} 1x, ${entry.src2x} 2x` : undefined}
        width={width}
        height={height}
        loading="eager"
        decoding="async"
        alt=""
        aria-hidden="true"
        className={styles.image}
      />
      <div className={styles.sealArea}>
        {showFrame ? (
          <img
            src={frameEntry?.src}
            width={frameDims.width}
            height={frameDims.height}
            alt=""
            aria-hidden="true"
            className={styles.frameSvg}
          />
        ) : null}
        <span className={styles.text} data-testid="stamp-text">
          {text}
        </span>
      </div>
    </div>
  );
}
