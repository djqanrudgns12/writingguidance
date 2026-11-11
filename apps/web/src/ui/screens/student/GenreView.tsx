import {
  GENRE_CATALOG,
  type GenreId,
  type GenreSelection,
  type PurposeId,
  type SubtypeId,
} from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { useId } from 'react';
import { Button, Chip, GenreTile, PaperCard, TextField } from '../../components/index.ts';
import type { IconName } from '../../icons/Icon.tsx';
import { cx } from '../common/cx.ts';
import styles from './GenreView.module.css';

export interface GenreViewProps {
  /** 교사가 수업방에서 켠 글 종류만(PRD F-05). 하나뿐이고 `other`가 아니면 결합하는 쪽이 이 화면을 건너뛴다. */
  readonly enabledGenres: readonly GenreId[];
  readonly selectedGenre: GenreId | null;
  readonly selectedSubtype: SubtypeId | null;
  readonly selectedPurpose: PurposeId | null;
  readonly purposeCustom: string;
  readonly onSelectGenre: (genre: GenreId) => void;
  readonly onSelectSubtype: (subtype: SubtypeId) => void;
  readonly onSelectPurpose: (purpose: PurposeId) => void;
  readonly onPurposeCustomChange: (text: string) => void;
  /** 바로 쓰기 타일(시·노래 가사·기사)은 누르자마자, 펼침 타일은 `쓰기 시작`에서 부른다. */
  readonly onStart: (selection: GenreSelection) => void;
  readonly starting?: boolean | undefined;
}

/** 글 종류별 아이콘(P3-7c) */
const GENRE_ICON: Record<GenreId, IconName> = {
  story: 'genreStory',
  poem: 'genrePoem',
  lyrics: 'genreLyrics',
  news: 'genreNews',
  essay: 'genreEssay',
  other: 'genreOther',
};

/**
 * S4 글 종류 고르기(PRD F-05 `[고정: 하위 종류가 타일에 바로 보이게]`, 7.1 주요 버튼 `쓰기 시작`).
 * 폰 2열×3줄, 태블릿·PC 3열×2줄. 하위 칩과 용도 카드는 새 화면이 아니라 같은 화면에서 펼친다.
 */
export function GenreView({
  enabledGenres,
  selectedGenre,
  selectedSubtype,
  selectedPurpose,
  purposeCustom,
  onSelectGenre,
  onSelectSubtype,
  onSelectPurpose,
  onPurposeCustomChange,
  onStart,
  starting = false,
}: GenreViewProps) {
  const headingId = useId();
  const onlyOther = enabledGenres.length === 1 && enabledGenres[0] === 'other';
  const activeGenre: GenreId | null = onlyOther ? 'other' : selectedGenre;
  const activeDef = activeGenre ? GENRE_CATALOG[activeGenre] : null;

  const handleTile = (genre: GenreId) => {
    const def = GENRE_CATALOG[genre];
    onSelectGenre(genre);
    if (def.expandsOnPick === 'none') {
      onStart({ genre, subtype: def.defaultSubtype });
    }
  };

  const subtypeValue = activeDef ? (selectedSubtype ?? activeDef.defaultSubtype) : null;
  const purposeValue = activeDef ? (selectedPurpose ?? activeDef.defaultPurpose) : null;
  const purposeDef = activeDef?.purposes.find(p => p.id === purposeValue);
  const needsCustom = purposeDef?.allowsCustomText === true;
  const canStart = !starting && (!needsCustom || purposeCustom.trim().length > 0);

  const handleStart = () => {
    if (!activeDef || !canStart) return;
    if (activeDef.expandsOnPick === 'purposes') {
      onStart({
        genre: activeDef.id,
        purpose: purposeValue,
        purposeCustom: needsCustom ? purposeCustom.trim() : null,
      });
    } else {
      onStart({ genre: activeDef.id, subtype: subtypeValue });
    }
  };

  const expanded = activeDef !== null && activeDef.expandsOnPick !== 'none';

  return (
    <main className={styles.page} data-screen="S4">
      <div className={styles.column}>
        <h1 id={headingId} className={styles.heading}>
          {onlyOther ? ko.student.otherPurposeTitle : ko.student.genreHeading}
        </h1>

        {onlyOther ? null : (
          <div className={styles.tiles} role="group" aria-labelledby={headingId}>
            {enabledGenres.map(genre => {
              const def = GENRE_CATALOG[genre];
              return (
                <GenreTile
                  key={genre}
                  label={ko.student[def.labelKey]}
                  subtitle={ko.student[def.subtitleKey]}
                  icon={GENRE_ICON[genre]}
                  selected={selectedGenre === genre}
                  disabled={starting}
                  onClick={() => handleTile(genre)}
                />
              );
            })}
          </div>
        )}

        {expanded && activeDef.expandsOnPick === 'subtypes' ? (
          <div
            className={styles.expand}
            role="group"
            aria-label={ko.student[activeDef.labelKey]}
            data-expand="subtypes"
          >
            <div className={styles.chips}>
              {activeDef.subtypes.map(sub => (
                <Chip
                  key={sub.id}
                  selected={subtypeValue === sub.id}
                  disabled={starting}
                  onClick={() => onSelectSubtype(sub.id)}
                >
                  {ko.student[sub.labelKey]}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}

        {expanded && activeDef.expandsOnPick === 'purposes' ? (
          <PaperCard
            as="section"
            className={cx(styles.expand, styles.purposeCard)}
            title={onlyOther ? undefined : ko.student.otherPurposeTitle}
            data-expand="purposes"
          >
            <div className={styles.chips} role="group" aria-label={ko.student.otherPurposeTitle}>
              {activeDef.purposes.map(purpose => (
                <Chip
                  key={purpose.id}
                  selected={purposeValue === purpose.id}
                  disabled={starting}
                  onClick={() => onSelectPurpose(purpose.id)}
                >
                  {ko.student[purpose.labelKey]}
                </Chip>
              ))}
            </div>
            {needsCustom ? (
              <TextField
                aria-label={ko.student.purposeCustom}
                placeholder={ko.student.otherPurposeCustomPlaceholder}
                value={purposeCustom}
                onChange={event => onPurposeCustomChange(event.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={starting}
              />
            ) : null}
          </PaperCard>
        ) : null}

        {expanded ? (
          <Button
            size="lg"
            icon="write"
            fullWidth
            disabled={!canStart}
            loading={starting}
            onClick={handleStart}
          >
            {ko.student.genreStartAction}
          </Button>
        ) : null}
      </div>
    </main>
  );
}
