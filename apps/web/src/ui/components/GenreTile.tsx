import { ko } from '@geulbang/core/copy';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './GenreTile.module.css';

export type GenreTileKind = 'story' | 'poem' | 'lyrics' | 'news' | 'essay' | 'other';

export const GENRE_TILE_ICONS: Record<GenreTileKind, IconName> = {
  story: 'genreStory',
  poem: 'genrePoem',
  lyrics: 'genreLyrics',
  news: 'genreNews',
  essay: 'genreEssay',
  other: 'genreOther',
};

function resolveGenreTileIcon(
  icon: IconName | undefined,
  genre: GenreTileKind | undefined,
  label: ReactNode,
): IconName {
  if (icon) return icon;
  if (genre) return GENRE_TILE_ICONS[genre];
  if (label === ko.student.genreStoryLabel) return 'genreStory';
  if (label === ko.student.genrePoemLabel) return 'genrePoem';
  if (label === ko.student.genreLyricsLabel) return 'genreLyrics';
  if (label === ko.student.genreNewsLabel) return 'genreNews';
  if (label === ko.student.genreEssayLabel) return 'genreEssay';
  if (label === ko.student.genreOtherLabel) return 'genreOther';
  return 'genreStory';
}

export interface GenreTileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** 글 종류 큰 이름(예: 이야기, 시, 노래 가사, 기사, 생활글, 기타 문구). */
  readonly label: ReactNode;
  /** 타일 안에 바로 보이는 하위 종류 작은 글씨(PRD F-05 `[고정]`). */
  readonly subtitle: ReactNode;
  readonly genre?: GenreTileKind | undefined;
  readonly selected?: boolean | undefined;
  readonly icon?: IconName | undefined;
}

/**
 * 글 종류 고르기 타일 부품(PRD F-05, 8.4, PLAN §9.2).
 * - 눌러 보지 않아도 무엇이 들어 있는지 알 수 있도록 하위 종류 글자(`subtitle`)를 타일 안에 함께 보여 준다.
 * - 선택되면 버터 바탕(`--butter`)과 체크 아이콘으로 색과 모양을 함께 바꾼다.
 */
export const GenreTile = forwardRef<HTMLButtonElement, GenreTileProps>(function GenreTile(
  { label, subtitle, genre, selected = false, icon, type = 'button', className, ...rest },
  ref,
) {
  const resolvedIcon = resolveGenreTileIcon(icon, genre, label);
  const classes = [styles.tile, selected ? styles.selected : '', className ?? ''].filter(Boolean).join(' ');

  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      data-selected={selected ? 'true' : 'false'}
      data-genre={genre}
      className={classes}
      {...rest}
    >
      <div className={styles.topRow}>
        <span className={styles.iconWrap} data-icon={resolvedIcon}>
          <Icon name={resolvedIcon} size={20} />
        </span>
        {selected ? (
          <span className={styles.checkBadge} data-testid="genre-tile-check">
            <Icon name="check" size={16} />
          </span>
        ) : null}
      </div>
      <span className={styles.label}>{label}</span>
      <span className={styles.subtitle} data-testid="genre-tile-subtitle">
        {subtitle}
      </span>
    </button>
  );
});
