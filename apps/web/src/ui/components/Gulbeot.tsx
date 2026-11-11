import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { artDimensions, getResolvedArtEntry, loadLazyArt, type ArtName } from '../art/home.ts';
import styles from './Gulbeot.module.css';

export type GulbeotMood = 'face' | 'default' | 'reading' | 'thinking' | 'welcoming' | 'resting';
export type GulbeotSize = 24 | 32 | 48 | 96 | 160;

export interface GulbeotProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'srcSet' | 'width' | 'height'
> {
  /** 글벗 표정 이름. `name`을 직접 주지 않았을 때 사용한다. */
  readonly mood?: GulbeotMood | undefined;
  /** `ui/art`의 그림 이름. 지정하면 `mood`보다 우선한다(단 48px 미만이면 기본 얼굴로 강제). */
  readonly name?: ArtName | undefined;
  /** 표시 폭(PRD 8.7: 24 · 32 · 48(기본 얼굴) · 96 · 160(표정)). 48px 미만은 기본 얼굴만 쓴다. */
  readonly size?: GulbeotSize | number | undefined;
  /** 첫 화면(홈 등)에서 지연 없이 바로 불러올 때 `true`로 둔다(기본은 `loading="lazy"`). */
  readonly priority?: boolean | undefined;
  /** 대체 글자. 비워 두면 장식 그림(`aria-hidden="true"`)으로 처리한다. */
  readonly alt?: string | undefined;
}

const MOOD_TO_ART: Record<GulbeotMood, ArtName> = {
  face: 'gulbeot-face',
  default: 'gulbeot-default',
  reading: 'gulbeot-reading',
  thinking: 'gulbeot-thinking',
  welcoming: 'gulbeot-welcoming',
  resting: 'gulbeot-resting',
};

/**
 * 48px 미만에서는 표정이 뭉개지지 않도록 언제나 기본 얼굴(`gulbeot-face`)만 돌려준다(PRD 8.7).
 */
export function resolveGulbeotArtName(size: number, name?: ArtName, mood?: GulbeotMood): ArtName {
  if (size < 48) {
    return 'gulbeot-face';
  }
  if (name) {
    return name;
  }
  if (mood) {
    return MOOD_TO_ART[mood];
  }
  return size === 48 ? 'gulbeot-face' : 'gulbeot-default';
}

/**
 * 글벗 캐릭터·장면 그림 부품(PRD 8.7, 8.8, PLAN §9.2).
 * - 48px 미만(24·32px)은 `name`이나 `mood`와 관계없이 `gulbeot-face`만 사용한다.
 * - `srcset`으로 1x·2x WebP를 함께 연결한다.
 * - 기본은 `loading="lazy"`이며, `priority`가 켜지면 `loading="eager"`로 첫 화면에서 바로 그린다.
 */
export function Gulbeot({
  mood,
  name,
  size = 48,
  priority = false,
  alt = '',
  className,
  ...rest
}: GulbeotProps) {
  const resolvedName = resolveGulbeotArtName(size, name, mood);
  const dims = artDimensions[resolvedName];
  const [, setTick] = useState(0);
  const entry = getResolvedArtEntry(resolvedName);

  useEffect(() => {
    if (getResolvedArtEntry(resolvedName)) return;
    let alive = true;
    void loadLazyArt().then(() => {
      if (alive) setTick(t => t + 1);
    });
    return () => {
      alive = false;
    };
  }, [resolvedName]);

  const displayWidth = size;
  const displayHeight = Math.max(1, Math.round((displayWidth * dims.height) / dims.width));
  const classes = [styles.gulbeot, className ?? ''].filter(Boolean).join(' ');

  return (
    <img
      src={entry?.src1x}
      srcSet={entry ? `${entry.src1x} 1x, ${entry.src2x} 2x` : undefined}
      width={displayWidth}
      height={displayHeight}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      alt={alt}
      aria-hidden={alt ? undefined : true}
      data-art={resolvedName}
      data-size={displayWidth}
      className={classes}
      {...rest}
    />
  );
}
