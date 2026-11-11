import { ko } from '@geulbang/core/copy';
import { useRef, type KeyboardEvent } from 'react';
import { Button, PaperCard, TextField } from '../../components/index.ts';
import styles from './NicknameView.module.css';

export interface NicknameViewProps {
  /** 위에 작게 보이는 수업 이름(예: "5학년 3반 · 역사 글쓰기"). */
  readonly roomLabel?: string | undefined;
  readonly nickname: string;
  readonly onNicknameChange: (nickname: string) => void;
  readonly onNext: () => void;
  /** 같은 별명이 이미 있을 때(PRD F-04). 별명을 고치면 결합하는 쪽이 `false`로 돌린다. */
  readonly taken?: boolean | undefined;
  readonly onClaimMine?: (() => void) | undefined;
  /** 칸 아래 안내(예: `ko.errors.E_NICK_INVALID`, `E_ROOM_FULL`). */
  readonly errorMessage?: string | undefined;
  readonly submitting?: boolean | undefined;
}

/**
 * S3 별명(PRD F-04, 7.1 주요 버튼 `다음`). 이 칸은 편집기 입력칸이 아니라 보통 입력칸이다(제어 값).
 * 늘 보이는 주의 문구는 막지 않고 안내만 한다. 중복이면 카드에 보조 버튼 둘, `다음`은 그대로 둔다.
 */
export function NicknameView({
  roomLabel,
  nickname,
  onNicknameChange,
  onNext,
  taken = false,
  onClaimMine,
  errorMessage,
  submitting = false,
}: NicknameViewProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canNext = nickname.trim().length > 0 && !submitting;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 한글 조합을 끝내는 Enter(조합 중 keyCode 229)는 다음으로 넘기지 않는다.
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (canNext) onNext();
  };

  const handleOtherNickname = () => {
    onNicknameChange('');
    inputRef.current?.focus();
  };

  return (
    <main className={styles.page} data-screen="S3">
      <div className={styles.column}>
        {/* 화면 제목(P5-1 [하-4]). 눈에 보이는 이름은 아래 칸 이름이 맡아 보조기기 전용으로 둔다. */}
        <h1 className="visually-hidden">{ko.student.nicknameLabel}</h1>
        {roomLabel ? <p className={styles.roomLabel}>{roomLabel}</p> : null}

        <TextField
          ref={inputRef}
          label={ko.student.nicknameLabel}
          placeholder={ko.student.nicknamePlaceholder}
          hint={ko.student.nicknameHint}
          error={errorMessage}
          value={nickname}
          onChange={event => onNicknameChange(event.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="next"
          disabled={submitting}
          className={styles.input}
        />

        {taken ? (
          <PaperCard readOnly padding="sm" className={styles.takenCard}>
            {/* 알림은 안내 글만(단추는 라이브 영역 밖, P5-1 [하-3]). */}
            <p className={styles.takenText} role="status" aria-live="polite">
              {ko.student.nicknameTakenGuide}
            </p>
            <div className={styles.takenActions}>
              {onClaimMine ? (
                <Button variant="secondary" onClick={onClaimMine} disabled={submitting}>
                  {ko.student.nicknameMineAction}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={handleOtherNickname} disabled={submitting}>
                {ko.student.nicknameChangeAction}
              </Button>
            </div>
          </PaperCard>
        ) : null}

        <Button size="lg" fullWidth disabled={!canNext} loading={submitting} onClick={onNext}>
          {ko.common.next}
        </Button>
      </div>
    </main>
  );
}
