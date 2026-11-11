import {
  SONG_MOOD_IDS,
  SONG_MOODS,
  SONG_TEMPO_IDS,
  SONG_TEMPOS,
  type SongMoodId,
  type SongTempoId,
} from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { useCallback, useEffect, useId, useRef } from 'react';
import { Button, Chip, MemoField, PaperCard, TextField } from '../../../components/index.ts';
import styles from './HelpCard.module.css';
import type { HelpQuestionView, SongChipsView } from './types.ts';

export interface HelpCardProps {
  readonly questions: readonly HelpQuestionView[];
  /** 지금 보이는 카드 순번. 노래 가사면 0번이 분위기·빠르기 카드다. */
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  readonly onClose: () => void;
  /**
   * 메모 칸이 붙고 떨어질 때 부른다(`binding.bindMemo(id, el)`, PLAN §6.3 메모 칸).
   * 칸은 질문마다 따로 만들어지고(`key`), 화면은 값·선택·초점을 만지지 않는다.
   */
  readonly memoRef?: ((questionId: string, el: HTMLTextAreaElement | null) => void) | undefined;
  /** 노래 가사만: 분위기·빠르기 칩(PRD F-07, 첫 장). */
  readonly song?: SongChipsView | undefined;
  readonly onMoodChange?: ((mood: SongMoodId) => void) | undefined;
  readonly onMoodCustomChange?: ((text: string) => void) | undefined;
  readonly onTempoChange?: ((tempo: SongTempoId) => void) | undefined;
  readonly readOnly?: boolean | undefined;
}

/**
 * 도움 질문 카드(PRD F-07): 카드 한 장에 질문 하나, `이전`·`다음`, 아래에 짧은 메모 칸.
 * 메모는 본문에 자동으로 들어가지 않는다 `[고정]`. 머리에는 바로 위 `도움 질문` 칩 이름을 되풀이하지 않고 몇째 장인지만 둔다.
 */
export function HelpCard({
  questions,
  index,
  onIndexChange,
  onClose,
  memoRef,
  song,
  onMoodChange,
  onMoodCustomChange,
  onTempoChange,
  readOnly = false,
}: HelpCardProps) {
  const songCard = song !== undefined;
  const total = questions.length + (songCard ? 1 : 0);
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, total - 1));
  const question = songCard ? (safeIndex === 0 ? null : questions[safeIndex - 1]) : questions[safeIndex];

  return (
    <PaperCard
      as="section"
      className={styles.card}
      aria-label={ko.student.helpQuestionsButton}
      title={
        <span className={styles.counter}>
          <span className="tabular">
            {safeIndex + 1}/{total}
          </span>
        </span>
      }
      headerAction={
        <Button variant="ghost" icon="close" aria-label={ko.common.close} onClick={onClose}>
          {null}
        </Button>
      }
    >
      {song && question === null ? (
        <SongChips
          song={song}
          readOnly={readOnly}
          onMoodChange={onMoodChange}
          onMoodCustomChange={onMoodCustomChange}
          onTempoChange={onTempoChange}
        />
      ) : question ? (
        <MemoSlot key={question.id} question={question} memoRef={memoRef} />
      ) : null}

      <div className={styles.nav}>
        <Button
          variant="secondary"
          disabled={safeIndex <= 0}
          onMouseDown={event => event.preventDefault()}
          onClick={() => onIndexChange(safeIndex - 1)}
        >
          {ko.common.prev}
        </Button>
        <Button
          variant="secondary"
          disabled={safeIndex >= total - 1}
          onMouseDown={event => event.preventDefault()}
          onClick={() => onIndexChange(safeIndex + 1)}
        >
          {ko.common.next}
        </Button>
      </div>
    </PaperCard>
  );
}

/** 질문 하나의 메모 칸. ref 콜백을 질문 ID마다 고정해 다시 그릴 때마다 붙였다 떼지 않게 한다. */
function MemoSlot({
  question,
  memoRef,
}: {
  readonly question: HelpQuestionView;
  readonly memoRef?: ((questionId: string, el: HTMLTextAreaElement | null) => void) | undefined;
}) {
  const latest = useRef(memoRef);
  useEffect(() => {
    latest.current = memoRef;
  }, [memoRef]);
  const id = question.id;
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      latest.current?.(id, el);
    },
    [id],
  );

  return (
    <MemoField
      ref={setRef}
      question={question.prompt}
      placeholder={ko.student.helpMemoPlaceholder}
      hint={ko.student.helpMemoHint}
      rows={3}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-memo-id={id}
      className={styles.memo}
    />
  );
}

function SongChips({
  song,
  readOnly,
  onMoodChange,
  onMoodCustomChange,
  onTempoChange,
}: {
  readonly song: SongChipsView;
  readonly readOnly: boolean;
  readonly onMoodChange?: ((mood: SongMoodId) => void) | undefined;
  readonly onMoodCustomChange?: ((text: string) => void) | undefined;
  readonly onTempoChange?: ((tempo: SongTempoId) => void) | undefined;
}) {
  const moodLabelId = useId();
  const tempoLabelId = useId();
  return (
    <div className={styles.song}>
      <div className={styles.songGroup}>
        <p id={moodLabelId} className={styles.songLabel}>
          {ko.student.songMoodLabel}
        </p>
        <div className={styles.chips} role="group" aria-labelledby={moodLabelId}>
          {SONG_MOOD_IDS.map(id => (
            <Chip key={id} selected={song.mood === id} disabled={readOnly} onClick={() => onMoodChange?.(id)}>
              {ko.student[SONG_MOODS[id].labelKey]}
            </Chip>
          ))}
        </div>
        {song.mood === 'custom' ? (
          <TextField
            aria-label={ko.student.songMoodCustom}
            placeholder={ko.student.songMoodCustomPlaceholder}
            value={song.moodCustom}
            onChange={event => onMoodCustomChange?.(event.target.value)}
            readOnly={readOnly}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        ) : null}
      </div>
      <div className={styles.songGroup}>
        <p id={tempoLabelId} className={styles.songLabel}>
          {ko.student.songTempoLabel}
        </p>
        <div className={styles.chips} role="group" aria-labelledby={tempoLabelId}>
          {SONG_TEMPO_IDS.map(id => (
            <Chip
              key={id}
              selected={song.tempo === id}
              disabled={readOnly}
              onClick={() => onTempoChange?.(id)}
            >
              {ko.student[SONG_TEMPOS[id].labelKey]}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}
